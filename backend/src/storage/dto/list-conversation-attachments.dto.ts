import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export const ATTACHMENT_LIST_KINDS = [
  'all',
  'mine',
  'shared',
  'image',
  'video',
  'audio',
  'voice',
  'document',
] as const;

export type AttachmentListKind = (typeof ATTACHMENT_LIST_KINDS)[number];

export class ListConversationAttachmentsDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsIn(ATTACHMENT_LIST_KINDS)
  kind?: AttachmentListKind;
}
