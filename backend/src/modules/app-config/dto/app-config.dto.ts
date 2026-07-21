import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateAppFeaturesDto {
  @IsOptional()
  @IsBoolean()
  voiceCallsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  videoCallsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  screenSharingEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  screenSharingDirectEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  screenSharingGroupsEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  screenMaxResolution?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  screenMaxFps?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  screenMaxConcurrentSessions?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(64)
  @Max(50000)
  screenBandwidthLimitKbps?: number | null;
}
