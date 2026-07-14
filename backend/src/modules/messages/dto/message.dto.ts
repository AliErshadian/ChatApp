import {
  IsString,
  IsUUID,
  IsOptional,
  MaxLength,
  MinLength,
  IsIn,
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  IsBoolean,
} from 'class-validator';

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

export class CreatePollDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  question!: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(200, { each: true })
  options!: string[];

  @IsOptional()
  @IsBoolean()
  anonymous?: boolean;

  @IsOptional()
  @IsBoolean()
  allowsMultiple?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientMessageId?: string;
}

export class VotePollDto {
  @IsUUID()
  optionId!: string;
}
