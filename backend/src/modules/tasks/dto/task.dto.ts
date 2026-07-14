import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateTaskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @IsUUID()
  assignedTo?: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @IsOptional()
  @IsUUID()
  conversationId?: string;
}

export class CreateTaskFromMessageDto {
  @IsUUID()
  messageId!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @IsUUID()
  assignedTo?: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;
}

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(4000)
  description?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  dueAt?: string | null;

  @IsOptional()
  @IsBoolean()
  completed?: boolean;
}

export class AssignTaskDto {
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  assigneeId!: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  version?: number;
}

export class AcceptRejectTaskDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  version?: number;
}

export class ListTasksQueryDto {
  @IsOptional()
  @IsIn(['open', 'completed', 'all', 'pending'])
  status?: 'open' | 'completed' | 'all' | 'pending';

  @IsOptional()
  @IsUUID()
  conversationId?: string;
}
