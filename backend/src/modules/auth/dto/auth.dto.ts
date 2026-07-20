import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SessionClientInfoDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  clientType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  platform?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  appName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceLabel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  userAgent?: string;
}

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(64)
  @Matches(/^[a-zA-Z0-9_]+$/)
  username!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(128)
  displayName!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => SessionClientInfoDto)
  clientInfo?: SessionClientInfoDto;
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => SessionClientInfoDto)
  clientInfo?: SessionClientInfoDto;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  captchaToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  captchaAnswer?: string;
}

export class RefreshTokenDto {
  @IsString()
  refreshToken!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => SessionClientInfoDto)
  clientInfo?: SessionClientInfoDto;
}
