import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateAdminUserDto {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isAdmin?: boolean;
}

export class AdminUsersQueryDto {
  @IsOptional()
  page?: string;

  @IsOptional()
  limit?: string;

  @IsOptional()
  q?: string;

  @IsOptional()
  isActive?: string;
}
