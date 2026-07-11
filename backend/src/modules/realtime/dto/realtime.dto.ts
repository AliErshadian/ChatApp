import { IsBoolean, IsUUID, IsArray, ArrayNotEmpty } from 'class-validator';
import { SendMessageDto, EditMessageDto, DeleteMessageDto, ToggleReactionDto } from '../../messages/dto/message.dto';
import { DeleteConversationDto } from '../../conversations/dto/conversation.dto';

export class RealtimeTypingDto {
  @IsUUID()
  conversationId!: string;

  @IsBoolean()
  isTyping!: boolean;
}

export class RealtimeDeliveredDto {
  @IsUUID()
  messageId!: string;
}

export class RealtimeReadDto {
  @IsUUID()
  messageId!: string;
}

export class RealtimePresenceQueryDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  userIds!: string[];
}

export class RealtimeEditMessageDto extends EditMessageDto {
  @IsUUID()
  messageId!: string;
}

export class RealtimeDeleteMessageDto extends DeleteMessageDto {
  @IsUUID()
  messageId!: string;
}

export class RealtimeToggleReactionDto extends ToggleReactionDto {
  @IsUUID()
  messageId!: string;
}

export { SendMessageDto, DeleteConversationDto };
