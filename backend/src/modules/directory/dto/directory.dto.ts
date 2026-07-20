import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { AuthenticationProviderId } from '../../auth/providers/auth-provider.types';
import { SessionClientInfoDto } from '../../auth/dto/auth.dto';

export class ProviderLoginDto {
  @IsOptional()
  @IsEnum(['local', 'active_directory'])
  provider?: AuthenticationProviderId;

  /**
   * Email for local auth, or AD username / UPN / DOMAIN\\user for Active Directory.
   * Kept for backward compatibility: if `email` is sent without `username`, it is used as identifier.
   */
  @ValidateIf((o: ProviderLoginDto) => !o.username)
  @IsEmail()
  email?: string;

  @ValidateIf((o: ProviderLoginDto) => !o.email)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  username?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => SessionClientInfoDto)
  clientInfo?: SessionClientInfoDto;
}

export class UpdateDirectorySettingsDto {
  @IsOptional()
  @IsBoolean()
  localLoginEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  activeDirectoryLoginEnabled?: boolean;

  @IsOptional()
  @IsEnum(['local', 'active_directory'])
  defaultProvider?: AuthenticationProviderId;

  @IsOptional()
  @IsBoolean()
  allowLocalFallback?: boolean;

  @IsOptional()
  @IsBoolean()
  autoCreateUsers?: boolean;

  @IsOptional()
  @IsBoolean()
  autoSyncProfile?: boolean;

  @IsOptional()
  @IsBoolean()
  autoSyncDepartment?: boolean;

  @IsOptional()
  @IsBoolean()
  autoSyncDisplayName?: boolean;

  @IsOptional()
  @IsBoolean()
  autoSyncEmail?: boolean;

  @IsOptional()
  @IsBoolean()
  autoSyncGroupMembership?: boolean;

  @IsOptional()
  @IsBoolean()
  requireAccountEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  rejectLockedAccounts?: boolean;

  @IsOptional()
  @IsBoolean()
  rejectExpiredPasswords?: boolean;

  @IsOptional()
  @IsBoolean()
  rejectExpiredAccounts?: boolean;

  @IsOptional()
  @IsBoolean()
  requireApprovedGroup?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  ldapHost?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  ldapPort?: number;

  @IsOptional()
  @IsEnum(['none', 'ldaps', 'starttls'])
  tlsMode?: 'none' | 'ldaps' | 'starttls';

  @IsOptional()
  @IsBoolean()
  validateTlsCertificate?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  domainName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  baseDn?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  bindDn?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  bindPassword?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  userSearchBase?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  groupSearchBase?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  userFilter?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  groupFilter?: string;

  @IsOptional()
  @IsInt()
  @Min(500)
  @Max(120000)
  connectionTimeoutMs?: number;

  @IsOptional()
  @IsInt()
  @Min(500)
  @Max(120000)
  readTimeoutMs?: number;

  @IsOptional()
  @IsEnum(['manual', 'hourly', 'daily', 'weekly'])
  syncInterval?: 'manual' | 'hourly' | 'daily' | 'weekly';
}

export class UpsertGroupMappingDto {
  @IsString()
  @MinLength(3)
  @MaxLength(1024)
  adGroupDn!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  adGroupName!: string;

  @IsOptional()
  @IsEnum(['system_admin', 'none'])
  chatRole?: 'system_admin' | 'none';

  @IsOptional()
  @IsBoolean()
  allowLogin?: boolean;

  @IsOptional()
  @IsBoolean()
  isApprovedSecurityGroup?: boolean;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateGroupMappingDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(1024)
  adGroupDn?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  adGroupName?: string;

  @IsOptional()
  @IsEnum(['system_admin', 'none'])
  chatRole?: 'system_admin' | 'none';

  @IsOptional()
  @IsBoolean()
  allowLogin?: boolean;

  @IsOptional()
  @IsBoolean()
  isApprovedSecurityGroup?: boolean;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class GroupMappingIdParamDto {
  @IsUUID()
  id!: string;
}
