import { IsString, IsUUID, IsOptional, MaxLength, MinLength, IsIn, IsArray, ArrayMinSize } from 'class-validator';

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

  @IsOptional()
  @IsUUID()
  replyToMessageId?: string;

  /** Slack-style thread: replies attach under this root and stay out of the main feed. */
  @IsOptional()
  @IsUUID()
  threadRootId?: string;
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

export class ForwardMessageDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  targetConversationIds!: string[];
}
