import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { AuthenticationProviderId } from '../../auth/providers/auth-provider.types';

export type DirectoryTlsMode = 'none' | 'ldaps' | 'starttls';
export type DirectorySyncInterval = 'manual' | 'hourly' | 'daily' | 'weekly';

@Entity('directory_configurations')
export class DirectoryConfiguration {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'local_login_enabled', default: true })
  localLoginEnabled!: boolean;

  @Column({ name: 'local_registration_enabled', default: true })
  localRegistrationEnabled!: boolean;

  @Column({ name: 'active_directory_login_enabled', default: false })
  activeDirectoryLoginEnabled!: boolean;

  @Column({
    name: 'default_provider',
    type: 'enum',
    enum: ['local', 'active_directory'],
    enumName: 'authentication_provider',
    default: 'local',
  })
  defaultProvider!: AuthenticationProviderId;

  @Column({ name: 'allow_local_fallback', default: true })
  allowLocalFallback!: boolean;

  @Column({ name: 'auto_create_users', default: true })
  autoCreateUsers!: boolean;

  @Column({ name: 'auto_sync_profile', default: true })
  autoSyncProfile!: boolean;

  @Column({ name: 'auto_sync_department', default: true })
  autoSyncDepartment!: boolean;

  @Column({ name: 'auto_sync_display_name', default: true })
  autoSyncDisplayName!: boolean;

  @Column({ name: 'auto_sync_email', default: true })
  autoSyncEmail!: boolean;

  @Column({ name: 'auto_sync_group_membership', default: true })
  autoSyncGroupMembership!: boolean;

  @Column({ name: 'require_account_enabled', default: true })
  requireAccountEnabled!: boolean;

  @Column({ name: 'reject_locked_accounts', default: true })
  rejectLockedAccounts!: boolean;

  @Column({ name: 'reject_expired_passwords', default: true })
  rejectExpiredPasswords!: boolean;

  @Column({ name: 'reject_expired_accounts', default: true })
  rejectExpiredAccounts!: boolean;

  @Column({ name: 'require_approved_group', default: false })
  requireApprovedGroup!: boolean;

  @Column({ name: 'ldap_host', nullable: true, type: 'varchar' })
  ldapHost?: string | null;

  @Column({ name: 'ldap_port', default: 389 })
  ldapPort!: number;

  @Column({
    name: 'tls_mode',
    type: 'enum',
    enum: ['none', 'ldaps', 'starttls'],
    enumName: 'directory_tls_mode',
    default: 'none',
  })
  tlsMode!: DirectoryTlsMode;

  @Column({ name: 'validate_tls_certificate', default: true })
  validateTlsCertificate!: boolean;

  @Column({ name: 'domain_name', nullable: true, type: 'varchar' })
  domainName?: string | null;

  @Column({ name: 'base_dn', nullable: true, type: 'varchar' })
  baseDn?: string | null;

  @Column({ name: 'bind_dn', nullable: true, type: 'varchar' })
  bindDn?: string | null;

  @Column({ name: 'bind_password_encrypted', nullable: true, type: 'text' })
  bindPasswordEncrypted?: string | null;

  @Column({ name: 'user_search_base', nullable: true, type: 'varchar' })
  userSearchBase?: string | null;

  @Column({ name: 'group_search_base', nullable: true, type: 'varchar' })
  groupSearchBase?: string | null;

  @Column({
    name: 'user_filter',
    default: '(&(objectCategory=person)(objectClass=user)(sAMAccountName={username}))',
  })
  userFilter!: string;

  @Column({ name: 'group_filter', default: '(objectClass=group)' })
  groupFilter!: string;

  @Column({ name: 'connection_timeout_ms', default: 5000 })
  connectionTimeoutMs!: number;

  @Column({ name: 'read_timeout_ms', default: 10000 })
  readTimeoutMs!: number;

  @Column({
    name: 'sync_interval',
    type: 'enum',
    enum: ['manual', 'hourly', 'daily', 'weekly'],
    enumName: 'directory_sync_interval',
    default: 'manual',
  })
  syncInterval!: DirectorySyncInterval;

  @Column({ name: 'last_connection_test_at', type: 'timestamptz', nullable: true })
  lastConnectionTestAt?: Date | null;

  @Column({ name: 'last_connection_test_ok', nullable: true, type: 'boolean' })
  lastConnectionTestOk?: boolean | null;

  @Column({ name: 'last_connection_test_message', nullable: true, type: 'text' })
  lastConnectionTestMessage?: string | null;

  @Column({ name: 'health_status', default: 'unknown' })
  healthStatus!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
