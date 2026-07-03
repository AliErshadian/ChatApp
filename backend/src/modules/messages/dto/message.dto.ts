import { IsString, IsUUID, IsOptional, MaxLength, MinLength, IsIn } from 'class-validator';

export class SendMessageDto {
  @IsUUID()
  conversationId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  content!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientMessageId?: string;
}

export class MarkReadDto {
  @IsUUID()
  messageId!: string;
}

export class EditMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  content!: string;
}

export class DeleteMessageDto {
  @IsIn(['me', 'everyone'])
  scope!: 'me' | 'everyone';
}

export class ToggleReactionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  emoji!: string;
}
