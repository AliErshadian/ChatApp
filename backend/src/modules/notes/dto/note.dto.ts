import {
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

export class CreateNoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50000)
  body?: string;
}

export class UpdateNoteDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(50000)
  body?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}

export class ListNotesQueryDto {
  @IsOptional()
  @IsIn(['all', 'mine', 'shared'])
  scope?: 'all' | 'mine' | 'shared';
}

export class AddNoteMemberDto {
  @IsUUID()
  userId!: string;

  @IsIn(['reader', 'contributor'])
  role!: 'reader' | 'contributor';
}

export class UpdateNoteMemberDto {
  @IsIn(['reader', 'contributor'])
  role!: 'reader' | 'contributor';
}
