import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateAppFeaturesDto {
  @IsOptional()
  @IsBoolean()
  voiceCallsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  videoCallsEnabled?: boolean;
}
