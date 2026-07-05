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
import { PresenceService, PresenceStatus } from '../presence/presence.service';
import { PresenceConnectionRegistry } from '../presence/presence-connection.registry';
import { WsJwtGuard } from './guards/ws-jwt.guard';

interface AuthenticatedSocket extends Socket {
  data: { userId: string; email: string };
}

@WebSocketGateway({
  cors: { origin: '*', credentials: true },
  namespace: '/realtime',
  transports: ['websocket', 'polling'],
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
  ) {}

  onModuleInit() {
    this.conversationPublisher.setEmitter((conversationId) =>
      this.broadcastConversationUpdated(conversationId),
    );
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

      const payload = await this.jwtService.verifyAsync<{ sub: string; email: string }>(
        token,
        { secret: this.config.get<string>('JWT_ACCESS_SECRET') },
      );

      client.data = { userId: payload.sub, email: payload.email };

      const connectionCount = this.presenceConnections.register(payload.sub);

      await client.join(`user:${payload.sub}`);
      await this.presenceService.setOnline(payload.sub, client.id);

      if (connectionCount === 1) {
        await this.broadcastPresenceUpdate(payload.sub, 'online');
      }

      await this.sendPresenceSnapshot(client, payload.sub);

      this.logger.log(`Client connected: ${client.id} (user: ${payload.sub})`);
    } catch {
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: AuthenticatedSocket) {
    const userId = client.data?.userId;
    if (!userId) return;

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

  @UseGuards(WsJwtGuard)
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

    this.server.to(`conversation:${data.conversationId}`).emit('message:receive', message);

    const memberIds = await this.conversationsService.getMemberUserIds(data.conversationId);
    for (const memberId of memberIds) {
      await this.conversationsService.unhideConversation(data.conversationId, memberId);
      if (memberId !== client.data.userId) {
        this.server.to(`user:${memberId}`).emit('message:receive', message);
      }
    }

    return { success: true, ...ackPayload };
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

  @UseGuards(WsJwtGuard)
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

    for (const memberId of memberIds) {
      this.server.to(`user:${memberId}`).emit('message:reaction', result);
    }
  }

  private async broadcastConversationUpdated(conversationId: string) {
    const data = await this.conversationsService.getChannelUpdatePayload(conversationId);
    if (!data) return;

    const { memberUserIds, ...payload } = data;

    this.server
      .to(`conversation:${conversationId}`)
      .emit('conversation:updated', payload);

    for (const memberId of memberUserIds) {
      this.server.to(`user:${memberId}`).emit('conversation:updated', payload);
    }
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

    for (const memberId of memberIds) {
      this.server.to(`user:${memberId}`).emit('message:updated', message);
    }
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

      for (const memberId of memberIds) {
        if (memberId !== client.data.userId) {
          this.server.to(`user:${memberId}`).emit('conversation:messages_deleted', payload);
        }
      }
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
