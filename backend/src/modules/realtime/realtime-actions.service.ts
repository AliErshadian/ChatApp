import { Injectable } from '@nestjs/common';
import { MessagesService } from '../messages/messages.service';
import { ConversationsService } from '../conversations/conversations.service';
import { PresenceService } from '../presence/presence.service';
import { SendMessageDto } from '../messages/dto/message.dto';
import { RealtimeBroadcastService } from './realtime-broadcast.service';

@Injectable()
export class RealtimeActionsService {
  constructor(
    private readonly messagesService: MessagesService,
    private readonly conversationsService: ConversationsService,
    private readonly presenceService: PresenceService,
    private readonly broadcast: RealtimeBroadcastService,
  ) {}

  async sendMessage(userId: string, sessionId: string, dto: SendMessageDto) {
    const message = await this.messagesService.send(userId, dto);
    const ackPayload = {
      clientMessageId: dto.clientMessageId,
      message: { ...message, status: 'sent' as const },
    };

    await this.broadcast.emitToSession(sessionId, 'message:ack', ackPayload);
    await this.broadcast.broadcastNewMessage(message, userId);

    return { success: true, ...ackPayload };
  }

  async markDelivered(userId: string, messageId: string) {
    const result = await this.messagesService.markDelivered(userId, messageId);
    await this.broadcast.emitToUser(result.senderId, 'message:status', result);
    return { success: true, ...result };
  }

  async markRead(userId: string, messageId: string) {
    const receipt = await this.messagesService.markRead(userId, messageId);
    await this.broadcast.emitToUser(receipt.senderId, 'message:status', receipt);
    await this.broadcast.emitToConversation(receipt.conversationId, 'message:read', receipt);
    return { success: true, ...receipt };
  }

  async setTyping(userId: string, conversationId: string, isTyping: boolean) {
    await this.conversationsService.assertMember(conversationId, userId);
    await this.presenceService.setTyping(conversationId, userId, isTyping);

    const payload = { conversationId, userId, isTyping };
    await this.broadcast.emitToConversation(conversationId, 'user:typing', payload);
    return { success: true };
  }

  async editMessage(userId: string, messageId: string, content: string) {
    const message = await this.messagesService.edit(userId, messageId, content);
    await this.broadcast.broadcastMessageUpdate(message);
    return { success: true, message };
  }

  async deleteMessage(userId: string, sessionId: string, messageId: string, scope: 'me' | 'everyone') {
    const result = await this.messagesService.delete(userId, messageId, scope);

    if (result.scope === 'me') {
      await this.broadcast.emitToSession(sessionId, 'message:hidden', { messageId: result.messageId });
      return { success: true, ...result };
    }

    if (result.message) {
      await this.broadcast.broadcastMessageUpdate(result.message);
    }
    return { success: true, ...result };
  }

  async toggleReaction(userId: string, messageId: string, emoji: string) {
    const result = await this.messagesService.toggleReaction(userId, messageId, emoji);
    await this.broadcast.broadcastReactionUpdate(result);
    return { success: true, ...result };
  }

  async deleteConversation(
    userId: string,
    sessionId: string,
    conversationId: string,
    scope: 'me' | 'everyone',
  ) {
    const result = await this.conversationsService.delete(userId, conversationId, scope);

    await this.broadcast.emitToSession(sessionId, 'conversation:hidden', {
      conversationId: result.conversationId,
    });

    if (result.scope === 'everyone' && result.deletedMessageIds.length > 0) {
      await this.broadcast.broadcastConversationMessagesDeleted(
        result.conversationId,
        result.deletedMessageIds,
        userId,
      );
    }

    return { success: true, ...result };
  }

  async heartbeat(userId: string) {
    await this.presenceService.heartbeat(userId);
    return { success: true };
  }

  async queryPresence(userIds: string[]) {
    const presence = await this.presenceService.getPresence(userIds);
    return { event: 'presence:batch', data: presence };
  }
}
