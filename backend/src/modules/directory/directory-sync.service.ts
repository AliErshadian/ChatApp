import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { DirectoryConfigService } from './directory-config.service';
import { LdapClientService } from './ldap/ldap-client.service';
import { DirectoryUserProvisioningService } from './directory-user-provisioning.service';
import {
  DirectorySyncHistory,
  type DirectorySyncStatus,
} from './entities/directory-sync-history.entity';
import {
  AuthAuditEvent,
  AuthenticationAuditService,
} from './authentication-audit.service';
import { AUTH_PROVIDER_IDS } from '../auth/providers/auth-provider.types';

@Injectable()
export class DirectorySyncService {
  private readonly logger = new Logger(DirectorySyncService.name);
  private running = false;

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(DirectorySyncHistory)
    private readonly historyRepo: Repository<DirectorySyncHistory>,
    private readonly directoryConfig: DirectoryConfigService,
    private readonly ldap: LdapClientService,
    private readonly provisioning: DirectoryUserProvisioningService,
    private readonly authAudit: AuthenticationAuditService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleHourlyCron() {
    const config = await this.directoryConfig.getConfig();
    if (config.syncInterval !== 'hourly') return;
    if (!config.activeDirectoryLoginEnabled) return;
    await this.runSync('schedule');
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async handleDailyCron() {
    const config = await this.directoryConfig.getConfig();
    if (config.syncInterval !== 'daily') return;
    if (!config.activeDirectoryLoginEnabled) return;
    await this.runSync('schedule');
  }

  @Cron(CronExpression.EVERY_WEEK)
  async handleWeeklyCron() {
    const config = await this.directoryConfig.getConfig();
    if (config.syncInterval !== 'weekly') return;
    if (!config.activeDirectoryLoginEnabled) return;
    await this.runSync('schedule');
  }

  async runSync(
    triggeredBy: 'manual' | 'schedule' = 'manual',
    triggeredByUserId?: string,
  ) {
    if (this.running) {
      return { accepted: false, message: 'Synchronization already in progress' };
    }

    this.running = true;
    const history = await this.historyRepo.save(
      this.historyRepo.create({
        triggeredBy,
        triggeredByUserId: triggeredByUserId ?? null,
        status: 'running',
      }),
    );

    this.authAudit.record({
      provider: AUTH_PROVIDER_IDS.ACTIVE_DIRECTORY,
      eventType: AuthAuditEvent.SYNC_STARTED,
      success: true,
      userId: triggeredByUserId,
      metadata: { historyId: history.id, triggeredBy },
    });

    try {
      const result = await this.executeSync(history.id);
      this.authAudit.record({
        provider: AUTH_PROVIDER_IDS.ACTIVE_DIRECTORY,
        eventType: AuthAuditEvent.SYNC_COMPLETED,
        success: result.status === 'success' || result.status === 'partial',
        userId: triggeredByUserId,
        metadata: { historyId: history.id, ...result },
      });
      return { accepted: true, historyId: history.id, ...result };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sync failed';
      await this.finishHistory(history.id, {
        status: 'failed',
        errorMessage: message,
      });
      this.authAudit.record({
        provider: AUTH_PROVIDER_IDS.ACTIVE_DIRECTORY,
        eventType: AuthAuditEvent.SYNC_FAILED,
        success: false,
        userId: triggeredByUserId,
        message,
        metadata: { historyId: history.id },
      });
      throw err;
    } finally {
      this.running = false;
    }
  }

  private async executeSync(historyId: string) {
    const config = await this.directoryConfig.getConfig(true);
    const bindPassword = this.directoryConfig.getBindPassword(config);
    if (!config.ldapHost || !bindPassword) {
      throw new Error('Directory is not fully configured');
    }

    const adUsers = await this.userRepo.find({
      where: { authenticationProvider: AUTH_PROVIDER_IDS.ACTIVE_DIRECTORY },
    });

    let usersExamined = 0;
    let usersUpdated = 0;
    let usersDisabled = 0;
    const errors: string[] = [];

    await this.ldap.withServiceBind(config, bindPassword, async (client) => {
      for (const user of adUsers) {
        usersExamined += 1;
        const lookupKey = user.username;
        try {
          const profile = await this.ldap.searchUser(client, config, lookupKey);
          if (!profile) {
            if (user.directoryEnabled) {
              user.directoryEnabled = false;
              user.isActive = false;
              await this.userRepo.save(user);
              usersDisabled += 1;
            }
            continue;
          }

          const before = JSON.stringify({
            displayName: user.displayName,
            email: user.email,
            department: user.department,
            groups: user.directoryGroups,
          });
          await this.provisioning.syncProfile(user, profile, config);
          const after = JSON.stringify({
            displayName: user.displayName,
            email: user.email,
            department: user.department,
            groups: user.directoryGroups,
          });
          if (before !== after) usersUpdated += 1;

          if (!profile.accountEnabled && user.isActive) {
            user.isActive = false;
            await this.userRepo.save(user);
            usersDisabled += 1;
          }
        } catch (err) {
          errors.push(
            `${lookupKey}: ${err instanceof Error ? err.message : String(err)}`,
          );
          this.logger.warn(`Sync error for ${lookupKey}: ${errors[errors.length - 1]}`);
        }
      }
    });

    const status: DirectorySyncStatus =
      errors.length === 0 ? 'success' : usersUpdated > 0 || usersExamined > 0 ? 'partial' : 'failed';

    await this.finishHistory(historyId, {
      status,
      usersExamined,
      usersUpdated,
      usersDisabled,
      errorMessage: errors.length ? errors.slice(0, 20).join('; ') : null,
      details: { errorCount: errors.length },
    });

    return {
      status,
      usersExamined,
      usersUpdated,
      usersCreated: 0,
      usersDisabled,
      groupsExamined: 0,
    };
  }

  private async finishHistory(
    id: string,
    patch: {
      status?: DirectorySyncStatus;
      usersExamined?: number;
      usersUpdated?: number;
      usersCreated?: number;
      usersDisabled?: number;
      groupsExamined?: number;
      errorMessage?: string | null;
      details?: Record<string, unknown>;
    },
  ) {
    await this.historyRepo.update(
      { id },
      {
        status: patch.status,
        usersExamined: patch.usersExamined,
        usersUpdated: patch.usersUpdated,
        usersCreated: patch.usersCreated,
        usersDisabled: patch.usersDisabled,
        groupsExamined: patch.groupsExamined,
        errorMessage: patch.errorMessage,
        details: patch.details as never,
        finishedAt: new Date(),
      },
    );
  }

  async listHistory(page = 1, limit = 20) {
    const take = Math.min(50, Math.max(1, limit));
    const skip = (Math.max(1, page) - 1) * take;
    const [items, total] = await this.historyRepo.findAndCount({
      order: { startedAt: 'DESC' },
      skip,
      take,
    });
    return {
      items: items.map((h) => ({
        id: h.id,
        triggeredBy: h.triggeredBy,
        triggeredByUserId: h.triggeredByUserId,
        status: h.status,
        usersExamined: h.usersExamined,
        usersUpdated: h.usersUpdated,
        usersCreated: h.usersCreated,
        usersDisabled: h.usersDisabled,
        groupsExamined: h.groupsExamined,
        errorMessage: h.errorMessage,
        details: h.details,
        startedAt: h.startedAt.toISOString(),
        finishedAt: h.finishedAt?.toISOString() ?? null,
      })),
      total,
      page: Math.max(1, page),
      limit: take,
    };
  }
}
