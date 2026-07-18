import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ReplyStoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  content!: string;
}

export class CreateStoryCaptionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  caption?: string;
}
