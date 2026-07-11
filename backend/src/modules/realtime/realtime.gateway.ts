import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseGuards, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { MessagesService } from '../messages/messages.service';
import { ConversationsService } from '../conversations/conversations.service';
import { ConversationRealtimePublisher } from '../conversations/conversation-realtime.publisher';
import { MessageRealtimePublisher } from '../messages/message-realtime.publisher';
import { SessionRealtimePublisher } from '../auth/session-realtime.publisher';
import { AuthService } from '../auth/auth.service';
import { PresenceService, PresenceStatus } from '../presence/presence.service';
import { PresenceConnectionRegistry } from '../presence/presence-connection.registry';
import { WsJwtGuard } from './guards/ws-jwt.guard';
import {
  wsConnectionsGauge,
  wsMessageBroadcastCounter,
  wsMessageSendCounter,
} from '../../observability/metrics';
import { WsRateLimit } from '../../observability/ws-rate-limit.decorator';
import { WsRateLimitGuard } from '../../observability/ws-rate-limit.guard';

interface AuthenticatedSocket extends Socket {
  data: { userId: string; email: string; sessionId: string };
}

@WebSocketGateway({
  namespace: '/realtime',
  // Internal/controlled environments: websocket-only avoids HTTP long-polling
  // load and removes sticky-session requirements at the load balancer.
  transports: ['websocket'],
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly messagesService: MessagesService,
    private readonly conversationsService: ConversationsService,
    private readonly presenceService: PresenceService,
    private readonly presenceConnections: PresenceConnectionRegistry,
    private readonly conversationPublisher: ConversationRealtimePublisher,
    private readonly messagePublisher: MessageRealtimePublisher,
    private readonly sessionPublisher: SessionRealtimePublisher,
    private readonly authService: AuthService,
  ) {}

  onModuleInit() {
    this.conversationPublisher.setEmitter((conversationId) =>
      this.broadcastConversationUpdated(conversationId),
    );
    this.conversationPublisher.setCreatedEmitter((conversationId) =>
      this.broadcastConversationCreated(conversationId),
    );
    this.conversationPublisher.setMemberRemovedEmitter((conversationId, removedUserId) =>
      this.broadcastMemberRemoved(conversationId, removedUserId),
    );
    this.messagePublisher.setNewMessageEmitter((message, senderId) =>
      this.broadcastNewMessage(message, senderId),
    );
    this.sessionPublisher.setTerminatedEmitter((sessionId) =>
      this.broadcastSessionTerminated(sessionId),
    );
    this.sessionPublisher.setCreatedEmitter((userId, payload, exceptSessionId) =>
      this.broadcastSessionCreated(userId, payload, exceptSessionId),
    );
  }

  private broadcastSessionCreated(
    userId: string,
    payload: {
      sessionId: string;
      deviceLabel: string;
      appName: string;
      platform: string | null;
      ipAddress: string | null;
    },
    exceptSessionId: string,
  ): Promise<void> {
    this.server
      .to(`user:${userId}`)
      .except(`session:${exceptSessionId}`)
      .emit('session:created', payload);
    return Promise.resolve();
  }

  private async broadcastSessionTerminated(sessionId: string) {
    const room = `session:${sessionId}`;
    this.server.to(room).emit('session:terminated', { sessionId });
    await this.server.in(room).disconnectSockets(true);
  }

  async handleConnection(client: AuthenticatedSocket) {
    try {
      const token =
        client.handshake.auth?.token ??
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        client.disconnect(true);
        return;
      }

      const payload = await this.jwtService.verifyAsync<{ sub: string; email: string; sid?: string }>(
        token,
        { secret: this.config.get<string>('JWT_ACCESS_SECRET') },
      );

      await this.authService.validateAccessToken(payload);

      if (!payload.sid) {
        client.disconnect(true);
        return;
      }

      client.data = {
        userId: payload.sub,
        email: payload.email,
        sessionId: payload.sid,
      };

      const connectionCount = this.presenceConnections.register(payload.sub);

      await client.join(`user:${payload.sub}`);
      await client.join(`session:${payload.sid}`);
      await this.presenceService.setOnline(payload.sub, client.id);

      if (connectionCount === 1) {
        await this.broadcastPresenceUpdate(payload.sub, 'online');
      }

      await this.sendPresenceSnapshot(client, payload.sub);

      wsConnectionsGauge.inc(1);
      this.logger.log(`Client connected: ${client.id} (user: ${payload.sub})`);
    } catch {
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: AuthenticatedSocket) {
    const userId = client.data?.userId;
    if (!userId) return;

    wsConnectionsGauge.dec(1);
    const remainingConnections = this.presenceConnections.unregister(userId);
    if (remainingConnections === 0) {
      await this.presenceService.setOffline(userId);
      await this.broadcastPresenceUpdate(userId, 'offline');
    }
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('conversation:join')
  async joinConversation(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string },
  ) {
    await this.conversationsService.assertMember(data.conversationId, client.data.userId);
    await client.join(`conversation:${data.conversationId}`);
    return { success: true, conversationId: data.conversationId };
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('conversation:leave')
  async leaveConversation(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string },
  ) {
    await client.leave(`conversation:${data.conversationId}`);
    return { success: true };
  }

  @UseGuards(WsJwtGuard, WsRateLimitGuard)
  @WsRateLimit({
    action: 'message_send',
    capacity: 15,
    refillPerSec: 0.5, // ~30/min
  })
  @SubscribeMessage('message:send')
  async handleMessageSend(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody()
    data: {
      conversationId: string;
      content: string;
      clientMessageId?: string;
      replyToMessageId?: string;
    },
  ) {
    wsMessageSendCounter.inc(1);
    const message = await this.messagesService.send(client.data.userId, {
      conversationId: data.conversationId,
      content: data.content,
      clientMessageId: data.clientMessageId,
      replyToMessageId: data.replyToMessageId,
    });

    const ackPayload = {
      clientMessageId: data.clientMessageId,
      message: { ...message, status: 'sent' as const },
    };

    // Direct ack to sender (callback + event for reliability)
    client.emit('message:ack', ackPayload);

    await this.broadcastNewMessage(message, client.data.userId);

    return { success: true, ...ackPayload };
  }

  private async broadcastNewMessage(
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
    
    // 1) Primary delivery: one room emit for all active viewers.
    this.server.to(`conversation:${message.conversationId}`).emit('message:receive', message);
    wsMessageBroadcastCounter.inc(1);
    // 2) Minimal per-user side effects (no full message fanout).
    // - unhide conversation for members (single query)
    // - optional "activity" ping to update conversation lists / badges for users
    await this.conversationsService.unhideConversationForConversation(message.conversationId);
    const memberIds = await this.conversationsService.getMemberUserIds(message.conversationId);
    const recipientRooms = memberIds
      .filter((id) => id !== senderId)
      .map((id) => `user:${id}`);
    if (recipientRooms.length > 0) {
      this.server.to(recipientRooms).emit('message:receive', message);
      wsMessageBroadcastCounter.inc(recipientRooms.length);
      this.server.to(recipientRooms).emit('conversation:activity', {
        conversationId: message.conversationId,
        messageId: message.id,
        senderId: message.senderId,
        sequence: message.sequence,
        createdAt: message.createdAt,
      });
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('message:delivered')
  async handleDelivered(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { messageId: string },
  ) {
    const result = await this.messagesService.markDelivered(client.data.userId, data.messageId);
    this.server.to(`user:${result.senderId}`).emit('message:status', result);
    return { success: true };
  }

  @UseGuards(WsJwtGuard, WsRateLimitGuard)
  @WsRateLimit({
    action: 'typing',
    capacity: 6,
    refillPerSec: 1.5, // bursty but capped
    keySuffixFromBody: (body) => body?.conversationId,
  })
  @SubscribeMessage('user:typing')
  async handleTyping(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string; isTyping: boolean },
  ) {
    await this.conversationsService.assertMember(data.conversationId, client.data.userId);
    await this.presenceService.setTyping(
      data.conversationId,
      client.data.userId,
      data.isTyping,
    );

    client.to(`conversation:${data.conversationId}`).emit('user:typing', {
      conversationId: data.conversationId,
      userId: client.data.userId,
      isTyping: data.isTyping,
    });
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('message:read')
  async handleRead(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { messageId: string },
  ) {
    const receipt = await this.messagesService.markRead(client.data.userId, data.messageId);
    this.server.to(`user:${receipt.senderId}`).emit('message:status', receipt);
    this.server
      .to(`conversation:${receipt.conversationId}`)
      .emit('message:read', receipt);
    return { success: true };
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('message:edit')
  async handleEdit(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { messageId: string; content: string },
  ) {
    const message = await this.messagesService.edit(
      client.data.userId,
      data.messageId,
      data.content,
    );
    await this.broadcastMessageUpdate(message);
    return { success: true, message };
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('message:delete')
  async handleDelete(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { messageId: string; scope: 'me' | 'everyone' },
  ) {
    const result = await this.messagesService.delete(
      client.data.userId,
      data.messageId,
      data.scope,
    );

    if (result.scope === 'me') {
      client.emit('message:hidden', { messageId: result.messageId });
      return { success: true, ...result };
    }

    if (result.message) {
      await this.broadcastMessageUpdate(result.message);
    }
    return { success: true, ...result };
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('message:reaction')
  async handleReaction(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { messageId: string; emoji: string },
  ) {
    const result = await this.messagesService.toggleReaction(
      client.data.userId,
      data.messageId,
      data.emoji,
    );
    await this.broadcastReactionUpdate(result);
    return { success: true, ...result };
  }

  private async broadcastReactionUpdate(result: {
    messageId: string;
    conversationId: string;
    reactions: unknown[];
  }) {
    const memberIds = await this.conversationsService.getMemberUserIds(
      result.conversationId,
    );

    this.server
      .to(`conversation:${result.conversationId}`)
      .emit('message:reaction', result);

    const rooms = memberIds.map((id) => `user:${id}`);
    if (rooms.length > 0) this.server.to(rooms).emit('message:reaction', result);
  }

  private async broadcastConversationUpdated(conversationId: string) {
    const data = await this.conversationsService.getConversationUpdatePayload(conversationId);
    if (!data) return;

    const { memberUserIds, ...payload } = data;

    this.server
      .to(`conversation:${conversationId}`)
      .emit('conversation:updated', payload);

    const rooms = memberUserIds.map((id) => `user:${id}`);
    if (rooms.length > 0) this.server.to(rooms).emit('conversation:updated', payload);
  }

  private async broadcastConversationCreated(conversationId: string) {
    const memberIds = await this.conversationsService.getMemberUserIds(conversationId);

    for (const memberId of memberIds) {
      const summary = await this.conversationsService.getById(conversationId, memberId);
      this.server.to(`user:${memberId}`).emit('conversation:created', summary);
    }
  }

  private async broadcastMemberRemoved(conversationId: string, removedUserId: string) {
    this.server
      .to(`user:${removedUserId}`)
      .emit('conversation:hidden', { conversationId });
    await this.broadcastConversationUpdated(conversationId);
  }

  private async broadcastMessageUpdate(message: {
    id: string;
    conversationId: string;
    senderId: string;
  }) {
    const memberIds = await this.conversationsService.getMemberUserIds(
      message.conversationId,
    );

    this.server
      .to(`conversation:${message.conversationId}`)
      .emit('message:updated', message);

    const rooms = memberIds.map((id) => `user:${id}`);
    if (rooms.length > 0) this.server.to(rooms).emit('message:updated', message);
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('conversation:delete')
  async handleConversationDelete(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string; scope: 'me' | 'everyone' },
  ) {
    const result = await this.conversationsService.delete(
      client.data.userId,
      data.conversationId,
      data.scope,
    );

    client.emit('conversation:hidden', { conversationId: result.conversationId });

    if (result.scope === 'everyone' && result.deletedMessageIds.length > 0) {
      const payload = {
        conversationId: result.conversationId,
        messageIds: result.deletedMessageIds,
      };
      const memberIds = await this.conversationsService.getMemberUserIds(
        result.conversationId,
      );

      this.server
        .to(`conversation:${result.conversationId}`)
        .emit('conversation:messages_deleted', payload);

      const rooms = memberIds
        .filter((id) => id !== client.data.userId)
        .map((id) => `user:${id}`);
      if (rooms.length > 0) this.server.to(rooms).emit('conversation:messages_deleted', payload);
    }

    return { success: true, ...result };
  }

  private async sendPresenceSnapshot(client: AuthenticatedSocket, userId: string) {
    const relatedUserIds = await this.conversationsService.getRelatedUserIds(userId);
    const onlineUserIds = this.presenceConnections.getOnlineUserIds(relatedUserIds);
    if (onlineUserIds.length === 0) return;

    client.emit(
      'presence:sync',
      onlineUserIds.map((id) => ({
        userId: id,
        status: 'online' as PresenceStatus,
        lastSeen: new Date().toISOString(),
      })),
    );
  }

  private async broadcastPresenceUpdate(userId: string, status: PresenceStatus) {
    const payload = {
      userId,
      status,
      lastSeen: new Date().toISOString(),
    };

    this.server.emit('user:presence', payload);

    const relatedUserIds = await this.conversationsService.getRelatedUserIds(userId);
    for (const relatedUserId of relatedUserIds) {
      this.server.to(`user:${relatedUserId}`).emit('user:presence', payload);
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('presence:heartbeat')
  async heartbeat(@ConnectedSocket() client: AuthenticatedSocket) {
    await this.presenceService.heartbeat(client.data.userId);
    return { success: true };
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('presence:query')
  async queryPresence(
    @MessageBody() data: { userIds: string[] },
  ) {
    const presence = await this.presenceService.getPresence(data.userIds);
    return { event: 'presence:batch', data: presence };
  }
}
