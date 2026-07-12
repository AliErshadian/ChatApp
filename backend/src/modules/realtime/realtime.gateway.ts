import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseGuards, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ConversationsService } from '../conversations/conversations.service';
import { ConversationRealtimePublisher } from '../conversations/conversation-realtime.publisher';
import { MessageRealtimePublisher } from '../messages/message-realtime.publisher';
import { SessionRealtimePublisher } from '../auth/session-realtime.publisher';
import { AuthService } from '../auth/auth.service';
import { listAccessJwtSecrets, verifyAccessJwtPayload } from '../../config/jwt-secrets';
import { PresenceService } from '../presence/presence.service';
import { PresenceConnectionRegistry } from '../presence/presence-connection.registry';
import { WsJwtGuard } from './guards/ws-jwt.guard';
import {
  wsConnectionsGauge,
  wsMessageSendCounter,
} from '../../observability/metrics';
import { WsRateLimit } from '../../observability/ws-rate-limit.decorator';
import { WsRateLimitGuard } from '../../observability/ws-rate-limit.guard';
import { RealtimeBroadcastService } from './realtime-broadcast.service';
import { RealtimeActionsService } from './realtime-actions.service';
import { CallSignalingService } from '../calls/call-signaling.service';

interface AuthenticatedSocket extends Socket {
  data: { userId: string; email: string; sessionId: string };
}

@WebSocketGateway({
  namespace: '/realtime',
  transports: ['websocket'],
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, OnModuleInit
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly conversationsService: ConversationsService,
    private readonly presenceService: PresenceService,
    private readonly presenceConnections: PresenceConnectionRegistry,
    private readonly conversationPublisher: ConversationRealtimePublisher,
    private readonly messagePublisher: MessageRealtimePublisher,
    private readonly sessionPublisher: SessionRealtimePublisher,
    private readonly authService: AuthService,
    private readonly broadcast: RealtimeBroadcastService,
    private readonly actions: RealtimeActionsService,
    private readonly callSignaling: CallSignalingService,
  ) {}

  onModuleInit() {
    this.conversationPublisher.setEmitter((conversationId) =>
      this.broadcast.broadcastConversationUpdated(conversationId),
    );
    this.conversationPublisher.setCreatedEmitter((conversationId) =>
      this.broadcast.broadcastConversationCreated(conversationId),
    );
    this.conversationPublisher.setMemberRemovedEmitter((conversationId, removedUserId) =>
      this.broadcast.broadcastMemberRemoved(conversationId, removedUserId),
    );
    this.messagePublisher.setNewMessageEmitter((message, senderId) =>
      this.broadcast.broadcastNewMessage(message, senderId),
    );
    this.sessionPublisher.setTerminatedEmitter((sessionId) =>
      this.broadcast.broadcastSessionTerminated(sessionId),
    );
    this.sessionPublisher.setCreatedEmitter((userId, payload, exceptSessionId) =>
      this.broadcast.broadcastSessionCreated(userId, payload, exceptSessionId),
    );
  }

  afterInit() {
    this.broadcast.setServer(this.server);
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

      const payload = await verifyAccessJwtPayload(
        this.jwtService,
        token,
        listAccessJwtSecrets(this.config),
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
        await this.broadcast.broadcastPresenceUpdate(payload.sub, 'online');
      }

      await this.broadcast.sendPresenceSnapshot(payload.sub, (event, data) => {
        client.emit(event, data);
      });

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
      await this.broadcast.broadcastPresenceUpdate(userId, 'offline');
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
    refillPerSec: 0.5,
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
    return this.actions.sendMessage(client.data.userId, client.data.sessionId, data);
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('message:delivered')
  async handleDelivered(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { messageId: string },
  ) {
    return this.actions.markDelivered(client.data.userId, data.messageId);
  }

  @UseGuards(WsJwtGuard, WsRateLimitGuard)
  @WsRateLimit({
    action: 'typing',
    capacity: 6,
    refillPerSec: 1.5,
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

    await this.broadcast.emitToConversation(data.conversationId, 'user:typing', {
      conversationId: data.conversationId,
      userId: client.data.userId,
      isTyping: data.isTyping,
    });

    return { success: true };
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('message:read')
  async handleRead(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { messageId: string },
  ) {
    return this.actions.markRead(client.data.userId, data.messageId);
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('message:edit')
  async handleEdit(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { messageId: string; content: string },
  ) {
    return this.actions.editMessage(client.data.userId, data.messageId, data.content);
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('message:delete')
  async handleDelete(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { messageId: string; scope: 'me' | 'everyone' },
  ) {
    return this.actions.deleteMessage(
      client.data.userId,
      client.data.sessionId,
      data.messageId,
      data.scope,
    );
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('message:reaction')
  async handleReaction(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { messageId: string; emoji: string },
  ) {
    return this.actions.toggleReaction(client.data.userId, data.messageId, data.emoji);
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('conversation:delete')
  async handleConversationDelete(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string; scope: 'me' | 'everyone' },
  ) {
    return this.actions.deleteConversation(
      client.data.userId,
      client.data.sessionId,
      data.conversationId,
      data.scope,
    );
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('presence:heartbeat')
  async heartbeat(@ConnectedSocket() client: AuthenticatedSocket) {
    return this.actions.heartbeat(client.data.userId);
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('presence:query')
  async queryPresence(@MessageBody() data: { userIds: string[] }) {
    return this.actions.queryPresence(data.userIds);
  }

  @UseGuards(WsJwtGuard, WsRateLimitGuard)
  @WsRateLimit({
    action: 'call_invite',
    capacity: 3,
    refillPerSec: 0.1,
  })
  @SubscribeMessage('call:invite')
  async handleCallInvite(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string },
  ) {
    const result = await this.callSignaling.invite(
      client.data.userId,
      client.data.sessionId,
      data.conversationId,
    );
    return { success: true, ...result };
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('call:accept')
  async handleCallAccept(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { callId: string },
  ) {
    const result = await this.callSignaling.accept(
      client.data.userId,
      client.data.sessionId,
      data.callId,
    );
    return { success: true, ...result };
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('call:reject')
  async handleCallReject(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { callId: string },
  ) {
    const result = await this.callSignaling.reject(
      client.data.userId,
      client.data.sessionId,
      data.callId,
    );
    return { success: true, ...result };
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('call:end')
  async handleCallEnd(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { callId: string },
  ) {
    const result = await this.callSignaling.end(
      client.data.userId,
      client.data.sessionId,
      data.callId,
    );
    return { success: true, ...result };
  }

  @UseGuards(WsJwtGuard, WsRateLimitGuard)
  @WsRateLimit({
    action: 'call_signal',
    capacity: 120,
    refillPerSec: 30,
    keySuffixFromBody: (body) => body?.callId,
  })
  @SubscribeMessage('call:signal')
  async handleCallSignal(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody()
    data: { callId: string; type: 'offer' | 'answer' | 'ice'; payload: unknown },
  ) {
    return this.callSignaling.forwardSignal(
      client.data.userId,
      client.data.sessionId,
      data.callId,
      data.type,
      data.payload,
    );
  }
}
