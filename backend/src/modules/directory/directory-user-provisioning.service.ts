import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { DirectoryConfigService } from './directory-config.service';
import { DirectoryGroupMapping } from './entities/directory-group-mapping.entity';
import type { DirectoryUserProfile } from '../auth/providers/auth-provider.types';
import { AUTH_PROVIDER_IDS } from '../auth/providers/auth-provider.types';

@Injectable()
export class DirectoryUserProvisioningService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(DirectoryGroupMapping)
    private readonly mappingRepo: Repository<DirectoryGroupMapping>,
    private readonly directoryConfig: DirectoryConfigService,
  ) {}

  /**
   * Enforce AD account policy + group allow-lists before provisioning.
   */
  async assertLoginAllowed(profile: DirectoryUserProfile): Promise<void> {
    const config = await this.directoryConfig.getConfig();

    if (config.requireAccountEnabled && !profile.accountEnabled) {
      throw new ForbiddenException('Active Directory account is disabled');
    }
    if (config.rejectLockedAccounts && profile.accountLocked) {
      throw new ForbiddenException('Active Directory account is locked');
    }
    if (config.rejectExpiredPasswords && profile.passwordExpired) {
      throw new ForbiddenException('Active Directory password has expired');
    }
    if (config.rejectExpiredAccounts && profile.accountExpired) {
      throw new ForbiddenException('Active Directory account has expired');
    }

    const mappings = await this.mappingRepo.find({ where: { enabled: true } });
    if (mappings.length === 0) {
      if (config.requireApprovedGroup) {
        throw new ForbiddenException(
          'Login requires membership in an approved security group',
        );
      }
      return;
    }

    const memberSet = new Set(
      profile.memberOf.map((dn) => dn.toLowerCase()),
    );
    const matched = mappings.filter(
      (m) =>
        memberSet.has(m.adGroupDn.toLowerCase()) ||
        profile.memberOf.some(
          (dn) =>
            dn.toLowerCase().includes(`cn=${m.adGroupName.toLowerCase()},`),
        ),
    );

    const denyLogin = matched.some((m) => !m.allowLogin);
    if (denyLogin) {
      throw new ForbiddenException('Login denied by directory group policy');
    }

    if (config.requireApprovedGroup) {
      const approved = matched.some((m) => m.isApprovedSecurityGroup);
      if (!approved) {
        throw new ForbiddenException(
          'Login requires membership in an approved security group',
        );
      }
    }
  }

  async findOrProvision(
    profile: DirectoryUserProfile,
  ): Promise<{ user: User; created: boolean }> {
    const config = await this.directoryConfig.getConfig();

    let user =
      (profile.adGuid
        ? await this.userRepo.findOne({ where: { adGuid: profile.adGuid } })
        : null) ??
      (profile.adSid
        ? await this.userRepo.findOne({ where: { adSid: profile.adSid } })
        : null) ??
      (await this.userRepo.findOne({
        where: { email: profile.email.toLowerCase() },
      })) ??
      (await this.userRepo.findOne({
        where: { username: this.sanitizeUsername(profile.username) },
      }));

    if (!user) {
      if (!config.autoCreateUsers) {
        throw new UnauthorizedException(
          'No local account exists for this directory user',
        );
      }
      user = await this.createFromProfile(profile);
      await this.applyGroupRoles(user, profile);
      return { user, created: true };
    }

    await this.syncProfile(user, profile, config);
    await this.applyGroupRoles(user, profile);
    return { user, created: false };
  }

  async syncProfile(
    user: User,
    profile: DirectoryUserProfile,
    config?: Awaited<ReturnType<DirectoryConfigService['getConfig']>>,
  ) {
    const cfg = config ?? (await this.directoryConfig.getConfig());

    if (user.authenticationProvider !== AUTH_PROVIDER_IDS.ACTIVE_DIRECTORY) {
      user.authenticationProvider = AUTH_PROVIDER_IDS.ACTIVE_DIRECTORY;
      user.passwordHash = null;
    }

    if (!user.adGuid && profile.adGuid) {
      user.adGuid = profile.adGuid;
    }
    if (!user.adSid && profile.adSid) {
      user.adSid = profile.adSid;
    }

    if (cfg.autoSyncDisplayName && profile.displayName && user.displayName !== profile.displayName) {
      user.displayName = profile.displayName.slice(0, 128);
    }
    if (cfg.autoSyncEmail && profile.email && user.email !== profile.email.toLowerCase()) {
      const conflict = await this.userRepo.findOne({
        where: { email: profile.email.toLowerCase() },
      });
      if (!conflict || conflict.id === user.id) {
        user.email = profile.email.toLowerCase();
      }
    }
    if (cfg.autoSyncDepartment) {
      if (user.department !== (profile.department ?? null)) {
        user.department = profile.department ?? null;
      }
    }
    if (cfg.autoSyncProfile) {
      if (user.jobTitle !== (profile.jobTitle ?? null)) {
        user.jobTitle = profile.jobTitle ?? null;
      }
      if (user.company !== (profile.company ?? null)) {
        user.company = profile.company ?? null;
      }
      if (user.phone !== (profile.phone ?? null)) {
        user.phone = profile.phone ?? null;
      }
      if (user.manager !== (profile.manager ?? null)) {
        user.manager = profile.manager ?? null;
      }
    }
    if (cfg.autoSyncGroupMembership) {
      user.directoryGroups = profile.memberOf;
    }

    user.directoryEnabled = profile.accountEnabled;
    user.lastDirectorySync = new Date();
    await this.userRepo.save(user);
  }

  private async createFromProfile(profile: DirectoryUserProfile): Promise<User> {
    const username = await this.uniqueUsername(profile.username);
    const email = await this.uniqueEmail(profile.email, username);

    const user = this.userRepo.create({
      email,
      username,
      displayName: profile.displayName.slice(0, 128),
      passwordHash: null,
      authenticationProvider: AUTH_PROVIDER_IDS.ACTIVE_DIRECTORY,
      adGuid: profile.adGuid || null,
      adSid: profile.adSid || null,
      department: profile.department ?? null,
      jobTitle: profile.jobTitle ?? null,
      company: profile.company ?? null,
      phone: profile.phone ?? null,
      manager: profile.manager ?? null,
      directoryGroups: profile.memberOf,
      directoryEnabled: profile.accountEnabled,
      lastDirectorySync: new Date(),
      isActive: true,
      isAdmin: false,
    });

    return this.userRepo.save(user);
  }

  private async applyGroupRoles(user: User, profile: DirectoryUserProfile) {
    const mappings = await this.mappingRepo.find({ where: { enabled: true } });
    if (!mappings.length) return;

    const memberSet = new Set(profile.memberOf.map((d) => d.toLowerCase()));
    const isSystemAdmin = mappings.some(
      (m) =>
        m.chatRole === 'system_admin' &&
        (memberSet.has(m.adGroupDn.toLowerCase()) ||
          profile.memberOf.some((dn) =>
            dn.toLowerCase().includes(`cn=${m.adGroupName.toLowerCase()},`),
          )),
    );

    if (isSystemAdmin && !user.isAdmin) {
      user.isAdmin = true;
      await this.userRepo.save(user);
    }
  }

  private sanitizeUsername(raw: string): string {
    const base = raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 64);
    return base || 'aduser';
  }

  private async uniqueUsername(raw: string): Promise<string> {
    let candidate = this.sanitizeUsername(raw);
    let suffix = 0;
    while (await this.userRepo.exist({ where: { username: candidate } })) {
      suffix += 1;
      const base = this.sanitizeUsername(raw).slice(0, 60);
      candidate = `${base}${suffix}`;
    }
    return candidate;
  }

  private async uniqueEmail(email: string, username: string): Promise<string> {
    let candidate = email.toLowerCase().slice(0, 255);
    if (!(await this.userRepo.exist({ where: { email: candidate } }))) {
      return candidate;
    }
    candidate = `${username}@ad.local`;
    let suffix = 0;
    while (await this.userRepo.exist({ where: { email: candidate } })) {
      suffix += 1;
      candidate = `${username}${suffix}@ad.local`;
    }
    return candidate;
  }
}
