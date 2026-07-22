import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  DirectoryConfiguration,
  type DirectorySyncInterval,
  type DirectoryTlsMode,
} from './entities/directory-configuration.entity';
import { SecretEncryptionService } from '../../common/services/secret-encryption.service';
import type { AuthenticationProviderId } from '../auth/providers/auth-provider.types';

export interface DirectorySettingsUpdate {
  localLoginEnabled?: boolean;
  localRegistrationEnabled?: boolean;
  activeDirectoryLoginEnabled?: boolean;
  defaultProvider?: AuthenticationProviderId;
  allowLocalFallback?: boolean;
  autoCreateUsers?: boolean;
  autoSyncProfile?: boolean;
  autoSyncDepartment?: boolean;
  autoSyncDisplayName?: boolean;
  autoSyncEmail?: boolean;
  autoSyncGroupMembership?: boolean;
  requireAccountEnabled?: boolean;
  rejectLockedAccounts?: boolean;
  rejectExpiredPasswords?: boolean;
  rejectExpiredAccounts?: boolean;
  requireApprovedGroup?: boolean;
  ldapHost?: string | null;
  ldapPort?: number;
  tlsMode?: DirectoryTlsMode;
  validateTlsCertificate?: boolean;
  domainName?: string | null;
  baseDn?: string | null;
  bindDn?: string | null;
  /** Plaintext bind password — encrypted before persist. Omit or empty to keep existing. */
  bindPassword?: string | null;
  userSearchBase?: string | null;
  groupSearchBase?: string | null;
  userFilter?: string;
  groupFilter?: string;
  connectionTimeoutMs?: number;
  readTimeoutMs?: number;
  syncInterval?: DirectorySyncInterval;
}

export interface PublicDirectorySettings {
  localLoginEnabled: boolean;
  localRegistrationEnabled: boolean;
  activeDirectoryLoginEnabled: boolean;
  defaultProvider: AuthenticationProviderId;
  allowLocalFallback: boolean;
  autoCreateUsers: boolean;
  autoSyncProfile: boolean;
  autoSyncDepartment: boolean;
  autoSyncDisplayName: boolean;
  autoSyncEmail: boolean;
  autoSyncGroupMembership: boolean;
  requireAccountEnabled: boolean;
  rejectLockedAccounts: boolean;
  rejectExpiredPasswords: boolean;
  rejectExpiredAccounts: boolean;
  requireApprovedGroup: boolean;
  ldapHost: string | null;
  ldapPort: number;
  tlsMode: DirectoryTlsMode;
  validateTlsCertificate: boolean;
  domainName: string | null;
  baseDn: string | null;
  bindDn: string | null;
  bindPasswordSet: boolean;
  userSearchBase: string | null;
  groupSearchBase: string | null;
  userFilter: string;
  groupFilter: string;
  connectionTimeoutMs: number;
  readTimeoutMs: number;
  syncInterval: DirectorySyncInterval;
  lastConnectionTestAt: string | null;
  lastConnectionTestOk: boolean | null;
  lastConnectionTestMessage: string | null;
  healthStatus: string;
  updatedAt: string;
}

/**
 * Hot-reloadable directory / auth settings. Cached in memory; invalidated on update.
 */
@Injectable()
export class DirectoryConfigService implements OnModuleInit {
  private readonly logger = new Logger(DirectoryConfigService.name);
  private cache: DirectoryConfiguration | null = null;
  private cacheLoadedAt = 0;
  private readonly cacheTtlMs = 5_000;

  constructor(
    @InjectRepository(DirectoryConfiguration)
    private readonly configRepo: Repository<DirectoryConfiguration>,
    private readonly encryption: SecretEncryptionService,
  ) {}

  async onModuleInit() {
    await this.getConfig();
  }

  async getConfig(forceRefresh = false): Promise<DirectoryConfiguration> {
    const now = Date.now();
    if (
      !forceRefresh &&
      this.cache &&
      now - this.cacheLoadedAt < this.cacheTtlMs
    ) {
      return this.cache;
    }

    let config = await this.configRepo.find({
      order: { createdAt: 'ASC' },
      take: 1,
    }).then((rows) => rows[0] ?? null);

    if (!config) {
      config = await this.configRepo.save(this.configRepo.create({}));
      this.logger.log('Created default directory configuration');
    }

    this.cache = config;
    this.cacheLoadedAt = now;
    return config;
  }

  invalidateCache() {
    this.cache = null;
    this.cacheLoadedAt = 0;
  }

  async getPublicSettings(): Promise<PublicDirectorySettings> {
    const c = await this.getConfig();
    return this.toPublic(c);
  }

  async updateSettings(input: DirectorySettingsUpdate): Promise<PublicDirectorySettings> {
    const config = await this.getConfig(true);

    const assignable: Array<keyof DirectorySettingsUpdate> = [
      'localLoginEnabled',
      'localRegistrationEnabled',
      'activeDirectoryLoginEnabled',
      'defaultProvider',
      'allowLocalFallback',
      'autoCreateUsers',
      'autoSyncProfile',
      'autoSyncDepartment',
      'autoSyncDisplayName',
      'autoSyncEmail',
      'autoSyncGroupMembership',
      'requireAccountEnabled',
      'rejectLockedAccounts',
      'rejectExpiredPasswords',
      'rejectExpiredAccounts',
      'requireApprovedGroup',
      'ldapHost',
      'ldapPort',
      'tlsMode',
      'validateTlsCertificate',
      'domainName',
      'baseDn',
      'bindDn',
      'userSearchBase',
      'groupSearchBase',
      'userFilter',
      'groupFilter',
      'connectionTimeoutMs',
      'readTimeoutMs',
      'syncInterval',
    ];

    for (const key of assignable) {
      if (input[key] !== undefined) {
        (config as unknown as Record<string, unknown>)[key] = input[key];
      }
    }

    if (input.bindPassword !== undefined && input.bindPassword !== null && input.bindPassword !== '') {
      config.bindPasswordEncrypted = this.encryption.encrypt(input.bindPassword);
    }

    // Safety: at least one login method must remain enabled
    if (!config.localLoginEnabled && !config.activeDirectoryLoginEnabled) {
      config.localLoginEnabled = true;
    }

    if (
      config.defaultProvider === 'active_directory' &&
      !config.activeDirectoryLoginEnabled
    ) {
      config.defaultProvider = 'local';
    }
    if (config.defaultProvider === 'local' && !config.localLoginEnabled) {
      config.defaultProvider = 'active_directory';
    }

    const saved = await this.configRepo.save(config);
    this.invalidateCache();
    this.cache = saved;
    this.cacheLoadedAt = Date.now();
    return this.toPublic(saved);
  }

  getBindPassword(config: DirectoryConfiguration): string {
    if (!config.bindPasswordEncrypted) return '';
    return this.encryption.decrypt(config.bindPasswordEncrypted);
  }

  async recordConnectionTest(ok: boolean, message: string) {
    const config = await this.getConfig(true);
    config.lastConnectionTestAt = new Date();
    config.lastConnectionTestOk = ok;
    config.lastConnectionTestMessage = message.slice(0, 1000);
    config.healthStatus = ok ? 'healthy' : 'unhealthy';
    await this.configRepo.save(config);
    this.invalidateCache();
  }

  toPublic(c: DirectoryConfiguration): PublicDirectorySettings {
    return {
      localLoginEnabled: c.localLoginEnabled,
      localRegistrationEnabled: c.localRegistrationEnabled,
      activeDirectoryLoginEnabled: c.activeDirectoryLoginEnabled,
      defaultProvider: c.defaultProvider,
      allowLocalFallback: c.allowLocalFallback,
      autoCreateUsers: c.autoCreateUsers,
      autoSyncProfile: c.autoSyncProfile,
      autoSyncDepartment: c.autoSyncDepartment,
      autoSyncDisplayName: c.autoSyncDisplayName,
      autoSyncEmail: c.autoSyncEmail,
      autoSyncGroupMembership: c.autoSyncGroupMembership,
      requireAccountEnabled: c.requireAccountEnabled,
      rejectLockedAccounts: c.rejectLockedAccounts,
      rejectExpiredPasswords: c.rejectExpiredPasswords,
      rejectExpiredAccounts: c.rejectExpiredAccounts,
      requireApprovedGroup: c.requireApprovedGroup,
      ldapHost: c.ldapHost ?? null,
      ldapPort: c.ldapPort,
      tlsMode: c.tlsMode,
      validateTlsCertificate: c.validateTlsCertificate,
      domainName: c.domainName ?? null,
      baseDn: c.baseDn ?? null,
      bindDn: c.bindDn ?? null,
      bindPasswordSet: Boolean(c.bindPasswordEncrypted),
      userSearchBase: c.userSearchBase ?? null,
      groupSearchBase: c.groupSearchBase ?? null,
      userFilter: c.userFilter,
      groupFilter: c.groupFilter,
      connectionTimeoutMs: c.connectionTimeoutMs,
      readTimeoutMs: c.readTimeoutMs,
      syncInterval: c.syncInterval,
      lastConnectionTestAt: c.lastConnectionTestAt?.toISOString() ?? null,
      lastConnectionTestOk: c.lastConnectionTestOk ?? null,
      lastConnectionTestMessage: c.lastConnectionTestMessage ?? null,
      healthStatus: c.healthStatus,
      updatedAt: c.updatedAt.toISOString(),
    };
  }
}
