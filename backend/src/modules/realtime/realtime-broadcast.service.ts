import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';
import { ConversationsService } from '../conversations/conversations.service';
import { PresenceConnectionRegistry } from '../presence/presence-connection.registry';
import { PresenceStatus } from '../presence/presence.service';
import {
  wsMessageBroadcastCounter,
} from '../../observability/metrics';
import { RealtimeEventBusService } from './realtime-event-bus.service';
import { RealtimeTarget } from './realtime.types';

@Injectable()
export class RealtimeBroadcastService {
  private server: Server | null = null;

  constructor(
    private readonly eventBus: RealtimeEventBusService,
    private readonly conversationsService: ConversationsService,
    private readonly presenceConnections: PresenceConnectionRegistry,
  ) {}

  setServer(server: Server) {
    this.server = server;
  }

  private socketRoom(room: string) {
    return this.server?.to(room);
  }

  private async fanout(
    targets: RealtimeTarget[],
    event: string,
    data: unknown,
    options?: { exceptSessionId?: string },
  ) {
    const envelope = {
      event,
      data,
      excludeSessionId: options?.exceptSessionId,
    };

    const rooms = new Set<string>();
    for (const target of targets) {
      switch (target.scope) {
        case 'user':
          rooms.add(`user:${target.userId}`);
          break;
        case 'session':
          rooms.add(`session:${target.sessionId}`);
          break;
        case 'conversation':
          rooms.add(`conversation:${target.conversationId}`);
          break;
        case 'global':
          this.server?.emit(event, data);
          break;
      }
      await this.eventBus.publish(target, envelope);
    }

    for (const room of rooms) {
      const emitter = this.socketRoom(room);
      if (!emitter) continue;
      if (options?.exceptSessionId && room.startsWith('user:')) {
        emitter.except(`session:${options.exceptSessionId}`).emit(event, data);
      } else {
        emitter.emit(event, data);
      }
    }
  }

  async emitToSession(sessionId: string, event: string, data: unknown) {
    await this.fanout([{ scope: 'session', sessionId }], event, data);
  }

  async emitToUser(userId: string, event: string, data: unknown) {
    await this.fanout([{ scope: 'user', userId }], event, data);
  }

  async emitToUsers(userIds: string[], event: string, data: unknown) {
    if (userIds.length === 0) return;
    const rooms = userIds.map((id) => `user:${id}`);
    this.server?.to(rooms).emit(event, data);
    wsMessageBroadcastCounter.inc(rooms.length);
    await Promise.all(
      userIds.map((userId) =>
        this.eventBus.publish({ scope: 'user', userId }, { event, data }),
      ),
    );
  }

  async emitToUserExceptSession(
    userId: string,
    exceptSessionId: string,
    event: string,
    data: unknown,
  ) {
    this.server
      ?.to(`user:${userId}`)
      .except(`session:${exceptSessionId}`)
      .emit(event, data);
    await this.eventBus.publish(
      { scope: 'user', userId, exceptSessionId },
      { event, data, excludeSessionId: exceptSessionId },
    );
  }

  async emitToConversation(conversationId: string, event: string, data: unknown) {
    await this.fanout([{ scope: 'conversation', conversationId }], event, data);
  }

  async emitGlobal(event: string, data: unknown) {
    await this.fanout([{ scope: 'global' }], event, data);
  }

  async broadcastSessionCreated(
    userId: string,
    payload: {
      sessionId: string;
      deviceLabel: string;
      appName: string;
      platform: string | null;
      ipAddress: string | null;
    },
    exceptSessionId: string,
  ) {
    this.server
      ?.to(`user:${userId}`)
      .except(`session:${exceptSessionId}`)
      .emit('session:created', payload);
    await this.eventBus.publish(
      { scope: 'user', userId, exceptSessionId },
      {
        event: 'session:created',
        data: payload,
        excludeSessionId: exceptSessionId,
      },
    );
  }

  async broadcastSessionTerminated(sessionId: string) {
    const payload = { sessionId };
    await this.emitToSession(sessionId, 'session:terminated', payload);
    await this.server?.in(`session:${sessionId}`).disconnectSockets(true);
  }

  async broadcastNewMessage(
    message: {
      id: string;
      conversationId: string;
      senderId: string;
      content: string;
      contentType: string;
      fileName?: string;
      fileSize?: string;
      caption?: string;
      clientMessageId?: string;
      sequence: string;
      createdAt: Date;
      editedAt?: Date;
      deletedForEveryone?: boolean;
      status?: string;
      reactions?: unknown[];
      replyTo?: unknown;
      sender?: unknown;
    },
    senderId: string,
  ) {
    this.server?.to(`conversation:${message.conversationId}`).emit('message:receive', message);
    wsMessageBroadcastCounter.inc(1);
    await this.eventBus.publish(
      { scope: 'conversation', conversationId: message.conversationId },
      { event: 'message:receive', data: message },
    );

    await this.conversationsService.unhideConversationForConversation(message.conversationId);
    const memberIds = await this.conversationsService.getMemberUserIds(message.conversationId);
    const recipientIds = memberIds.filter((id) => id !== senderId);

    if (recipientIds.length > 0) {
      const rooms = recipientIds.map((id) => `user:${id}`);
      this.server?.to(rooms).emit('message:receive', message);
      wsMessageBroadcastCounter.inc(rooms.length);
      await Promise.all(
        recipientIds.map((userId) =>
          this.eventBus.publish(
            { scope: 'user', userId },
            { event: 'message:receive', data: message },
          ),
        ),
      );

      const activity = {
        conversationId: message.conversationId,
        messageId: message.id,
        senderId: message.senderId,
        sequence: message.sequence,
        createdAt: message.createdAt,
      };
      this.server?.to(rooms).emit('conversation:activity', activity);
      await Promise.all(
        recipientIds.map((userId) =>
          this.eventBus.publish(
            { scope: 'user', userId },
            { event: 'conversation:activity', data: activity },
          ),
        ),
      );
    }
  }

  async broadcastReactionUpdate(result: {
    messageId: string;
    conversationId: string;
    reactions: unknown[];
  }) {
    const memberIds = await this.conversationsService.getMemberUserIds(result.conversationId);
    await this.emitToConversation(result.conversationId, 'message:reaction', result);
    await this.emitToUsers(memberIds, 'message:reaction', result);
  }

  async broadcastConversationUpdated(conversationId: string) {
    const data = await this.conversationsService.getConversationUpdatePayload(conversationId);
    if (!data) return;

    const { memberUserIds, ...payload } = data;
    await this.emitToConversation(conversationId, 'conversation:updated', payload);
    await this.emitToUsers(memberUserIds, 'conversation:updated', payload);
  }

  async broadcastConversationCreated(conversationId: string) {
    const memberIds = await this.conversationsService.getMemberUserIds(conversationId);
    for (const memberId of memberIds) {
      const summary = await this.conversationsService.getById(conversationId, memberId);
      await this.emitToUser(memberId, 'conversation:created', summary);
    }
  }

  async broadcastMemberRemoved(conversationId: string, removedUserId: string) {
    await this.emitToUser(removedUserId, 'conversation:hidden', { conversationId });
    await this.broadcastConversationUpdated(conversationId);
  }

  async broadcastMessageUpdate(message: {
    id: string;
    conversationId: string;
    senderId: string;
  }) {
    const memberIds = await this.conversationsService.getMemberUserIds(message.conversationId);
    await this.emitToConversation(message.conversationId, 'message:updated', message);
    await this.emitToUsers(memberIds, 'message:updated', message);
  }

  async broadcastConversationMessagesDeleted(
    conversationId: string,
    messageIds: string[],
    exceptUserId?: string,
  ) {
    const payload = { conversationId, messageIds };
    await this.emitToConversation(conversationId, 'conversation:messages_deleted', payload);

    const memberIds = await this.conversationsService.getMemberUserIds(conversationId);
    const recipientIds = exceptUserId
      ? memberIds.filter((id) => id !== exceptUserId)
      : memberIds;
    await this.emitToUsers(recipientIds, 'conversation:messages_deleted', payload);
  }

  async broadcastPresenceUpdate(userId: string, status: PresenceStatus) {
    const payload = {
      userId,
      status,
      lastSeen: new Date().toISOString(),
    };

    await this.emitGlobal('user:presence', payload);

    const relatedUserIds = await this.conversationsService.getRelatedUserIds(userId);
    await this.emitToUsers(relatedUserIds, 'user:presence', payload);
  }

  async sendPresenceSnapshot(
    userId: string,
    emit: (event: string, data: unknown) => void,
  ) {
    const relatedUserIds = await this.conversationsService.getRelatedUserIds(userId);
    const onlineUserIds = this.presenceConnections.getOnlineUserIds(relatedUserIds);
    if (onlineUserIds.length === 0) return;

    emit(
      'presence:sync',
      onlineUserIds.map((id) => ({
        userId: id,
        status: 'online' as PresenceStatus,
        lastSeen: new Date().toISOString(),
      })),
    );
  }
}
