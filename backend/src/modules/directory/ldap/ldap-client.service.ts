import { Injectable, Logger } from '@nestjs/common';
import { Client, type Entry, type SearchOptions } from 'ldapts';
import type { DirectoryConfiguration, DirectoryTlsMode } from '../entities/directory-configuration.entity';
import type { DirectoryUserProfile } from '../../auth/providers/auth-provider.types';

export interface LdapConnectionOptions {
  host: string;
  port: number;
  tlsMode: DirectoryTlsMode;
  validateTlsCertificate: boolean;
  bindDn: string;
  bindPassword: string;
  connectionTimeoutMs: number;
  readTimeoutMs: number;
}

export interface LdapPreviewUser {
  dn: string;
  username: string;
  displayName: string;
  email: string;
  department?: string;
  enabled: boolean;
}

export interface LdapPreviewGroup {
  dn: string;
  name: string;
  description?: string;
}

const ADS_UF_ACCOUNTDISABLE = 0x0002;
const ADS_UF_LOCKOUT = 0x0010;
const ADS_UF_PASSWORD_EXPIRED = 0x800000;

@Injectable()
export class LdapClientService {
  private readonly logger = new Logger(LdapClientService.name);

  buildOptions(
    config: DirectoryConfiguration,
    bindPassword: string,
  ): LdapConnectionOptions {
    if (!config.ldapHost?.trim()) {
      throw new Error('LDAP host is not configured');
    }
    if (!config.bindDn?.trim()) {
      throw new Error('Bind DN is not configured');
    }
    return {
      host: config.ldapHost.trim(),
      port: config.ldapPort || (config.tlsMode === 'ldaps' ? 636 : 389),
      tlsMode: config.tlsMode,
      validateTlsCertificate: config.validateTlsCertificate,
      bindDn: config.bindDn.trim(),
      bindPassword,
      connectionTimeoutMs: config.connectionTimeoutMs || 5000,
      readTimeoutMs: config.readTimeoutMs || 10000,
    };
  }

  private createClient(options: LdapConnectionOptions): Client {
    const useTls = options.tlsMode === 'ldaps';
    const protocol = useTls ? 'ldaps' : 'ldap';
    const url = `${protocol}://${options.host}:${options.port}`;

    return new Client({
      url,
      timeout: options.connectionTimeoutMs,
      connectTimeout: options.connectionTimeoutMs,
      tlsOptions:
        options.tlsMode !== 'none'
          ? {
              rejectUnauthorized: options.validateTlsCertificate,
            }
          : undefined,
    });
  }

  private async prepareClient(client: Client, options: LdapConnectionOptions) {
    if (options.tlsMode === 'starttls') {
      await client.startTLS({
        rejectUnauthorized: options.validateTlsCertificate,
      });
    }
  }

  async testConnection(options: LdapConnectionOptions): Promise<{ ok: true; message: string }> {
    const client = this.createClient(options);
    try {
      await this.prepareClient(client, options);
      await client.bind(options.bindDn, options.bindPassword);
      await client.unbind();
      return { ok: true, message: 'LDAP bind succeeded' };
    } catch (err) {
      await this.safeUnbind(client);
      throw this.sanitizeError(err);
    }
  }

  /**
   * Authenticate a user by searching with service bind, then binding as the user.
   */
  async authenticateUser(
    config: DirectoryConfiguration,
    serviceBindPassword: string,
    username: string,
    password: string,
  ): Promise<DirectoryUserProfile> {
    if (!password) {
      throw new Error('Password is required');
    }

    const serviceOptions = this.buildOptions(config, serviceBindPassword);
    const serviceClient = this.createClient(serviceOptions);

    try {
      await this.prepareClient(serviceClient, serviceOptions);
      await serviceClient.bind(serviceOptions.bindDn, serviceOptions.bindPassword);

      const profile = await this.searchUser(serviceClient, config, username);
      if (!profile) {
        throw new Error('User not found in directory');
      }

      await serviceClient.unbind();

      // User bind verifies credentials — never store this password
      const userClient = this.createClient(serviceOptions);
      try {
        await this.prepareClient(userClient, serviceOptions);
        await userClient.bind(profile.dn, password);
        await userClient.unbind();
      } catch (err) {
        await this.safeUnbind(userClient);
        this.logger.debug(`AD bind failed for ${username}: ${this.errorMessage(err)}`);
        throw Object.assign(new Error('Invalid credentials'), { cause: err });
      }

      return profile;
    } catch (err) {
      await this.safeUnbind(serviceClient);
      throw this.sanitizeError(err);
    }
  }

  async searchUser(
    client: Client,
    config: DirectoryConfiguration,
    username: string,
  ): Promise<DirectoryUserProfile | null> {
    const base = config.userSearchBase?.trim() || config.baseDn?.trim();
    if (!base) throw new Error('User search base / base DN is not configured');

    const filter = this.applyUsernameFilter(config.userFilter, username);
    const options: SearchOptions = {
      scope: 'sub',
      filter,
      attributes: [
        'dn',
        'sAMAccountName',
        'userPrincipalName',
        'displayName',
        'cn',
        'mail',
        'department',
        'title',
        'company',
        'telephoneNumber',
        'mobile',
        'manager',
        'memberOf',
        'objectGUID',
        'objectSid',
        'userAccountControl',
        'accountExpires',
        'lockoutTime',
        'pwdLastSet',
      ],
      sizeLimit: 5,
      timeLimit: Math.max(1, Math.floor((config.readTimeoutMs || 10000) / 1000)),
    };

    const { searchEntries } = await client.search(base, options);
    if (!searchEntries.length) return null;
    return this.mapEntryToProfile(searchEntries[0]);
  }

  async previewUsers(
    config: DirectoryConfiguration,
    bindPassword: string,
    limit = 25,
  ): Promise<LdapPreviewUser[]> {
    const options = this.buildOptions(config, bindPassword);
    const client = this.createClient(options);
    try {
      await this.prepareClient(client, options);
      await client.bind(options.bindDn, options.bindPassword);
      const base = config.userSearchBase?.trim() || config.baseDn?.trim();
      if (!base) throw new Error('User search base is not configured');

      const { searchEntries } = await client.search(base, {
        scope: 'sub',
        filter: '(&(objectCategory=person)(objectClass=user))',
        attributes: [
          'dn',
          'sAMAccountName',
          'displayName',
          'mail',
          'department',
          'userAccountControl',
        ],
        sizeLimit: limit,
        paged: { pageSize: limit },
      });
      await client.unbind();

      return searchEntries.slice(0, limit).map((entry) => {
        const uac = this.readNumber(entry, 'userAccountControl');
        return {
          dn: entry.dn,
          username: this.readString(entry, 'sAMAccountName') || '',
          displayName:
            this.readString(entry, 'displayName') ||
            this.readString(entry, 'cn') ||
            this.readString(entry, 'sAMAccountName') ||
            '',
          email: this.readString(entry, 'mail') || '',
          department: this.readString(entry, 'department') || undefined,
          enabled: uac === null ? true : (uac & ADS_UF_ACCOUNTDISABLE) === 0,
        };
      });
    } catch (err) {
      await this.safeUnbind(client);
      throw this.sanitizeError(err);
    }
  }

  async previewGroups(
    config: DirectoryConfiguration,
    bindPassword: string,
    limit = 50,
  ): Promise<LdapPreviewGroup[]> {
    const options = this.buildOptions(config, bindPassword);
    const client = this.createClient(options);
    try {
      await this.prepareClient(client, options);
      await client.bind(options.bindDn, options.bindPassword);
      const base = config.groupSearchBase?.trim() || config.baseDn?.trim();
      if (!base) throw new Error('Group search base is not configured');

      const filter = config.groupFilter?.trim() || '(objectClass=group)';
      const { searchEntries } = await client.search(base, {
        scope: 'sub',
        filter,
        attributes: ['dn', 'cn', 'name', 'description'],
        sizeLimit: limit,
        paged: { pageSize: limit },
      });
      await client.unbind();

      return searchEntries.slice(0, limit).map((entry) => ({
        dn: entry.dn,
        name:
          this.readString(entry, 'cn') ||
          this.readString(entry, 'name') ||
          entry.dn,
        description: this.readString(entry, 'description') || undefined,
      }));
    } catch (err) {
      await this.safeUnbind(client);
      throw this.sanitizeError(err);
    }
  }

  async withServiceBind<T>(
    config: DirectoryConfiguration,
    bindPassword: string,
    fn: (client: Client) => Promise<T>,
  ): Promise<T> {
    const options = this.buildOptions(config, bindPassword);
    const client = this.createClient(options);
    try {
      await this.prepareClient(client, options);
      await client.bind(options.bindDn, options.bindPassword);
      const result = await fn(client);
      await client.unbind();
      return result;
    } catch (err) {
      await this.safeUnbind(client);
      throw this.sanitizeError(err);
    }
  }

  private applyUsernameFilter(template: string, username: string): string {
    const escaped = this.escapeFilterValue(this.normalizeUsername(username));
    return template.replace(/\{username\}/gi, escaped);
  }

  private normalizeUsername(username: string): string {
    const trimmed = username.trim();
    // DOMAIN\user → user
    if (trimmed.includes('\\')) {
      return trimmed.split('\\').pop() || trimmed;
    }
    // user@domain → use sAMAccountName portion when filter expects {username}
    if (trimmed.includes('@')) {
      return trimmed.split('@')[0];
    }
    return trimmed;
  }

  private escapeFilterValue(value: string): string {
    return value
      .replace(/\\/g, '\\5c')
      .replace(/\*/g, '\\2a')
      .replace(/\(/g, '\\28')
      .replace(/\)/g, '\\29')
      .replace(/\0/g, '\\00');
  }

  private mapEntryToProfile(entry: Entry): DirectoryUserProfile {
    const uac = this.readNumber(entry, 'userAccountControl') ?? 0;
    const lockoutTime = this.readString(entry, 'lockoutTime');
    const accountExpires = this.readString(entry, 'accountExpires');
    const pwdLastSet = this.readString(entry, 'pwdLastSet');

    const memberOf = this.readStringArray(entry, 'memberOf');
    const username =
      this.readString(entry, 'sAMAccountName') ||
      this.readString(entry, 'userPrincipalName') ||
      '';
    const email =
      this.readString(entry, 'mail') ||
      this.readString(entry, 'userPrincipalName') ||
      `${username}@local`;

    return {
      dn: entry.dn,
      username,
      displayName:
        this.readString(entry, 'displayName') ||
        this.readString(entry, 'cn') ||
        username,
      email: email.toLowerCase(),
      department: this.readString(entry, 'department'),
      jobTitle: this.readString(entry, 'title'),
      company: this.readString(entry, 'company'),
      phone:
        this.readString(entry, 'telephoneNumber') ||
        this.readString(entry, 'mobile'),
      manager: this.readString(entry, 'manager'),
      memberOf,
      adGuid: this.guidToString(this.readBinary(entry, 'objectGUID')),
      adSid: this.sidToString(this.readBinary(entry, 'objectSid')),
      accountEnabled: (uac & ADS_UF_ACCOUNTDISABLE) === 0,
      accountLocked:
        (uac & ADS_UF_LOCKOUT) !== 0 ||
        Boolean(lockoutTime && lockoutTime !== '0'),
      passwordExpired:
        (uac & ADS_UF_PASSWORD_EXPIRED) !== 0 || pwdLastSet === '0',
      accountExpired: this.isAccountExpired(accountExpires),
    };
  }

  private isAccountExpired(accountExpires: string | null): boolean {
    if (!accountExpires || accountExpires === '0' || accountExpires === '9223372036854775807') {
      return false;
    }
    try {
      // Windows FILETIME (100-ns intervals since 1601-01-01)
      const filetime = BigInt(accountExpires);
      const unixMs = Number(filetime / 10000n - 11644473600000n);
      return unixMs > 0 && unixMs < Date.now();
    } catch {
      return false;
    }
  }

  private readBinary(entry: Entry, attr: string): Buffer | null {
    const value = entry[attr];
    if (Buffer.isBuffer(value)) return value;
    if (Array.isArray(value)) {
      const first = value[0];
      if (Buffer.isBuffer(first)) return first;
      if (typeof first === 'string') return Buffer.from(first, 'binary');
    }
    if (typeof value === 'string') return Buffer.from(value, 'binary');
    return null;
  }

  private readString(entry: Entry, attr: string): string | null {
    const value = entry[attr];
    if (value == null) return null;
    if (Array.isArray(value)) {
      const first = value[0];
      if (first == null) return null;
      return typeof first === 'string' ? first : Buffer.isBuffer(first) ? first.toString('utf8') : String(first);
    }
    if (typeof value === 'string') return value;
    if (Buffer.isBuffer(value)) return value.toString('utf8');
    return String(value);
  }

  private readStringArray(entry: Entry, attr: string): string[] {
    const value = entry[attr];
    if (value == null) return [];
    const list = Array.isArray(value) ? value : [value];
    return list.map((v) => (typeof v === 'string' ? v : Buffer.isBuffer(v) ? v.toString('utf8') : String(v)));
  }

  private readNumber(entry: Entry, attr: string): number | null {
    const raw = this.readString(entry, attr);
    if (raw == null) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  }

  private guidToString(buf: Buffer | null): string {
    if (!buf || buf.length !== 16) return '';
    const hex = (start: number, len: number, reverse = false) => {
      const slice = buf.subarray(start, start + len);
      const bytes = reverse ? Buffer.from(slice).reverse() : slice;
      return bytes.toString('hex');
    };
    return [
      hex(0, 4, true),
      hex(4, 2, true),
      hex(6, 2, true),
      hex(8, 2, false),
      hex(10, 6, false),
    ].join('-');
  }

  private sidToString(buf: Buffer | null): string {
    if (!buf || buf.length < 8) return '';
    const revision = buf.readUInt8(0);
    const subAuthCount = buf.readUInt8(1);
    let authority = 0;
    for (let i = 2; i <= 7; i++) {
      authority = authority * 256 + buf.readUInt8(i);
    }
    const parts = [`S-${revision}-${authority}`];
    for (let i = 0; i < subAuthCount; i++) {
      const offset = 8 + i * 4;
      if (offset + 4 > buf.length) break;
      parts.push(String(buf.readUInt32LE(offset)));
    }
    return parts.join('-');
  }

  private async safeUnbind(client: Client) {
    try {
      await client.unbind();
    } catch {
      // ignore
    }
  }

  private errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }

  private sanitizeError(err: unknown): Error {
    const message = this.errorMessage(err);
    // Avoid leaking bind DNs / internal LDAP diagnostics to clients
    if (/invalid credentials|49|data 52e|data 532|data 533|data 701|data 775/i.test(message)) {
      return new Error('Invalid credentials');
    }
    if (/timeout|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|certificate/i.test(message)) {
      return new Error('Directory server unavailable');
    }
    this.logger.warn(`LDAP error: ${message}`);
    return new Error('Directory authentication failed');
  }
}
