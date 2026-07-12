import { IsOptional, IsUUID, ValidateIf } from 'class-validator';

export class UploadFileDto {
  @ValidateIf((dto: UploadFileDto) => !dto.messageId)
  @IsUUID()
  conversationId?: string;

  @IsOptional()
  @IsUUID()
  messageId?: string;
}
