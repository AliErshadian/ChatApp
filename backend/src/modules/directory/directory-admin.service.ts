import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DirectoryConfigService, type DirectorySettingsUpdate } from './directory-config.service';
import { LdapClientService } from './ldap/ldap-client.service';
import { DirectorySyncService } from './directory-sync.service';
import {
  AuthAuditEvent,
  AuthenticationAuditService,
} from './authentication-audit.service';
import {
  DirectoryGroupMapping,
  type DirectoryChatRole,
} from './entities/directory-group-mapping.entity';
import { AUTH_PROVIDER_IDS } from '../auth/providers/auth-provider.types';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit-action';

@Injectable()
export class DirectoryAdminService {
  constructor(
    private readonly directoryConfig: DirectoryConfigService,
    private readonly ldap: LdapClientService,
    private readonly sync: DirectorySyncService,
    private readonly authAudit: AuthenticationAuditService,
    private readonly audit: AuditService,
    @InjectRepository(DirectoryGroupMapping)
    private readonly mappingRepo: Repository<DirectoryGroupMapping>,
  ) {}

  getSettings() {
    return this.directoryConfig.getPublicSettings();
  }

  async updateSettings(actorUserId: string, input: DirectorySettingsUpdate) {
    const before = await this.directoryConfig.getConfig(true);
    const previousAd = before.activeDirectoryLoginEnabled;
    const previousLocal = before.localLoginEnabled;

    const settings = await this.directoryConfig.updateSettings(input);

    this.authAudit.record({
      provider: AUTH_PROVIDER_IDS.ACTIVE_DIRECTORY,
      eventType: AuthAuditEvent.CONFIG_CHANGED,
      success: true,
      userId: actorUserId,
      metadata: { fields: Object.keys(input) },
    });

    if (previousAd !== settings.activeDirectoryLoginEnabled) {
      this.authAudit.record({
        provider: AUTH_PROVIDER_IDS.ACTIVE_DIRECTORY,
        eventType: settings.activeDirectoryLoginEnabled
          ? AuthAuditEvent.PROVIDER_ENABLED
          : AuthAuditEvent.PROVIDER_DISABLED,
        success: true,
        userId: actorUserId,
      });
    }
    if (previousLocal !== settings.localLoginEnabled) {
      this.authAudit.record({
        provider: AUTH_PROVIDER_IDS.LOCAL,
        eventType: settings.localLoginEnabled
          ? AuthAuditEvent.PROVIDER_ENABLED
          : AuthAuditEvent.PROVIDER_DISABLED,
        success: true,
        userId: actorUserId,
      });
    }

    this.audit.record({
      action: AuditAction.ADMIN_DIRECTORY_CONFIG_UPDATE,
      userId: actorUserId,
      actorUserId,
      resourceType: 'directory_configuration',
      metadata: { fields: Object.keys(input) },
    });

    return settings;
  }

  async testConnection(actorUserId: string) {
    const config = await this.directoryConfig.getConfig(true);
    const bindPassword = this.directoryConfig.getBindPassword(config);
    if (!config.ldapHost || !config.bindDn || !bindPassword) {
      throw new BadRequestException(
        'LDAP host, bind DN, and bind password are required',
      );
    }

    try {
      const options = this.ldap.buildOptions(config, bindPassword);
      const result = await this.ldap.testConnection(options);
      await this.directoryConfig.recordConnectionTest(true, result.message);
      this.authAudit.record({
        provider: AUTH_PROVIDER_IDS.ACTIVE_DIRECTORY,
        eventType: AuthAuditEvent.CONNECTION_TEST,
        success: true,
        userId: actorUserId,
        message: result.message,
      });
      return { ok: true, message: result.message };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Connection failed';
      await this.directoryConfig.recordConnectionTest(false, message);
      this.authAudit.record({
        provider: AUTH_PROVIDER_IDS.ACTIVE_DIRECTORY,
        eventType: AuthAuditEvent.CONNECTION_ERROR,
        success: false,
        userId: actorUserId,
        message,
      });
      return { ok: false, message };
    }
  }

  async previewUsers(limit = 25) {
    const config = await this.directoryConfig.getConfig(true);
    const bindPassword = this.directoryConfig.getBindPassword(config);
    if (!config.ldapHost || !bindPassword) {
      throw new BadRequestException('Directory is not fully configured');
    }
    return this.ldap.previewUsers(config, bindPassword, limit);
  }

  async previewGroups(limit = 50) {
    const config = await this.directoryConfig.getConfig(true);
    const bindPassword = this.directoryConfig.getBindPassword(config);
    if (!config.ldapHost || !bindPassword) {
      throw new BadRequestException('Directory is not fully configured');
    }
    return this.ldap.previewGroups(config, bindPassword, limit);
  }

  runManualSync(actorUserId: string) {
    return this.sync.runSync('manual', actorUserId);
  }

  listSyncHistory(page?: number, limit?: number) {
    return this.sync.listHistory(page, limit);
  }

  listAuthAudit(params: {
    page?: number;
    limit?: number;
    provider?: 'local' | 'active_directory';
    success?: boolean;
    eventType?: string;
  }) {
    return this.authAudit.list(params);
  }

  getAuthStatistics() {
    return this.authAudit.getStatistics();
  }

  async getHealth() {
    const settings = await this.directoryConfig.getPublicSettings();
    return {
      healthStatus: settings.healthStatus,
      activeDirectoryLoginEnabled: settings.activeDirectoryLoginEnabled,
      localLoginEnabled: settings.localLoginEnabled,
      lastConnectionTestAt: settings.lastConnectionTestAt,
      lastConnectionTestOk: settings.lastConnectionTestOk,
      lastConnectionTestMessage: settings.lastConnectionTestMessage,
      ldapHostConfigured: Boolean(settings.ldapHost),
      bindPasswordSet: settings.bindPasswordSet,
      syncInterval: settings.syncInterval,
    };
  }

  listGroupMappings() {
    return this.mappingRepo.find({ order: { adGroupName: 'ASC' } }).then((rows) =>
      rows.map((m) => this.toMappingDto(m)),
    );
  }

  async createGroupMapping(input: {
    adGroupDn: string;
    adGroupName: string;
    chatRole?: DirectoryChatRole;
    allowLogin?: boolean;
    isApprovedSecurityGroup?: boolean;
    enabled?: boolean;
  }) {
    const existing = await this.mappingRepo.findOne({
      where: { adGroupDn: input.adGroupDn.trim() },
    });
    if (existing) {
      throw new BadRequestException('A mapping for this group DN already exists');
    }
    const mapping = await this.mappingRepo.save(
      this.mappingRepo.create({
        adGroupDn: input.adGroupDn.trim(),
        adGroupName: input.adGroupName.trim(),
        chatRole: input.chatRole ?? 'none',
        allowLogin: input.allowLogin ?? true,
        isApprovedSecurityGroup: input.isApprovedSecurityGroup ?? false,
        enabled: input.enabled ?? true,
      }),
    );
    return this.toMappingDto(mapping);
  }

  async updateGroupMapping(
    id: string,
    input: Partial<{
      adGroupDn: string;
      adGroupName: string;
      chatRole: DirectoryChatRole;
      allowLogin: boolean;
      isApprovedSecurityGroup: boolean;
      enabled: boolean;
    }>,
  ) {
    const mapping = await this.mappingRepo.findOne({ where: { id } });
    if (!mapping) throw new NotFoundException('Group mapping not found');

    if (input.adGroupDn !== undefined) mapping.adGroupDn = input.adGroupDn.trim();
    if (input.adGroupName !== undefined) mapping.adGroupName = input.adGroupName.trim();
    if (input.chatRole !== undefined) mapping.chatRole = input.chatRole;
    if (input.allowLogin !== undefined) mapping.allowLogin = input.allowLogin;
    if (input.isApprovedSecurityGroup !== undefined) {
      mapping.isApprovedSecurityGroup = input.isApprovedSecurityGroup;
    }
    if (input.enabled !== undefined) mapping.enabled = input.enabled;

    return this.toMappingDto(await this.mappingRepo.save(mapping));
  }

  async deleteGroupMapping(id: string) {
    const result = await this.mappingRepo.delete(id);
    if (!result.affected) throw new NotFoundException('Group mapping not found');
    return { success: true };
  }

  private toMappingDto(m: DirectoryGroupMapping) {
    return {
      id: m.id,
      adGroupDn: m.adGroupDn,
      adGroupName: m.adGroupName,
      chatRole: m.chatRole,
      allowLogin: m.allowLogin,
      isApprovedSecurityGroup: m.isApprovedSecurityGroup,
      enabled: m.enabled,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    };
  }
}
