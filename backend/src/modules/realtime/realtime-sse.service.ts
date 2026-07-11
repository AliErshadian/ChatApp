import { Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ConversationsService } from '../conversations/conversations.service';
import { PresenceService } from '../presence/presence.service';
import { PresenceConnectionRegistry } from '../presence/presence-connection.registry';
import { RealtimeEventBusService } from './realtime-event-bus.service';
import { RealtimeBroadcastService } from './realtime-broadcast.service';
import { RealtimeEventEnvelope } from './realtime.types';
import {
  REALTIME_CONVERSATION_CHANNEL,
  REALTIME_GLOBAL_CHANNEL,
  REALTIME_SESSION_CHANNEL,
  REALTIME_USER_CHANNEL,
} from '../../infrastructure/redis/redis.constants';

interface SseConnection {
  userId: string;
  sessionId: string;
  response: Response;
  conversationIds: Set<string>;
  eventId: number;
  unsubscribe: (() => Promise<void>) | null;
}

function formatSseEvent(event: string, data: unknown, id?: number): string {
  const lines: string[] = [];
  if (id !== undefined) lines.push(`id: ${id}`);
  lines.push(`event: ${event}`);
  lines.push(`data: ${JSON.stringify(data)}`);
  lines.push('', '');
  return lines.join('\n');
}

@Injectable()
export class RealtimeSseService {
  private readonly logger = new Logger(RealtimeSseService.name);
  private readonly connections = new Map<string, SseConnection>();

  constructor(
    private readonly eventBus: RealtimeEventBusService,
    private readonly conversationsService: ConversationsService,
    private readonly presenceService: PresenceService,
    private readonly presenceConnections: PresenceConnectionRegistry,
    private readonly broadcast: RealtimeBroadcastService,
  ) {}

  async openStream(userId: string, sessionId: string, response: Response): Promise<() => Promise<void>> {
    const connectionId = `${userId}:${sessionId}:${Date.now()}`;
    const conversationIds = new Set(
      await this.conversationsService.getConversationIdsForUser(userId),
    );

    const connection: SseConnection = {
      userId,
      sessionId,
      response,
      conversationIds,
      eventId: 0,
      unsubscribe: null,
    };
    this.connections.set(connectionId, connection);

    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders?.();

    const channels = this.channelsForConnection(conversationIds, userId, sessionId);
    connection.unsubscribe = await this.eventBus.subscribe(channels, (envelope) => {
      this.deliver(connection, envelope);
    });

    const connectionCount = this.presenceConnections.register(userId);
    await this.presenceService.setOnline(userId, `sse:${connectionId}`);
    if (connectionCount === 1) {
      await this.broadcast.broadcastPresenceUpdate(userId, 'online');
    }

    await this.broadcast.sendPresenceSnapshot(userId, (event, data) => {
      this.write(connection, event, data);
    });

    this.write(connection, 'connected', { transport: 'sse', sessionId });

    const keepAlive = setInterval(() => {
      if (response.writableEnded) return;
      response.write(': keepalive\n\n');
    }, 25000);

    const close = async () => {
      clearInterval(keepAlive);
      this.connections.delete(connectionId);
      if (connection.unsubscribe) {
        await connection.unsubscribe();
      }

      const remaining = this.presenceConnections.unregister(userId);
      if (remaining === 0) {
        await this.presenceService.setOffline(userId);
        await this.broadcast.broadcastPresenceUpdate(userId, 'offline');
      }

      if (!response.writableEnded) {
        response.end();
      }
    };

    response.on('close', () => {
      void close();
    });

    return close;
  }

  async joinConversation(userId: string, sessionId: string, conversationId: string) {
    await this.conversationsService.assertMember(conversationId, userId);
    const connection = this.findConnection(userId, sessionId);
    if (!connection || connection.conversationIds.has(conversationId)) return;

    connection.conversationIds.add(conversationId);
    if (connection.unsubscribe) {
      await connection.unsubscribe();
    }
    const channels = this.channelsForConnection(
      connection.conversationIds,
      userId,
      sessionId,
    );
    connection.unsubscribe = await this.eventBus.subscribe(channels, (envelope) => {
      this.deliver(connection, envelope);
    });
  }

  async leaveConversation(userId: string, sessionId: string, conversationId: string) {
    const connection = this.findConnection(userId, sessionId);
    if (!connection || !connection.conversationIds.has(conversationId)) return;

    connection.conversationIds.delete(conversationId);
    if (connection.unsubscribe) {
      await connection.unsubscribe();
    }
    const channels = this.channelsForConnection(
      connection.conversationIds,
      userId,
      sessionId,
    );
    connection.unsubscribe = await this.eventBus.subscribe(channels, (envelope) => {
      this.deliver(connection, envelope);
    });
  }

  private findConnection(userId: string, sessionId: string) {
    for (const connection of this.connections.values()) {
      if (connection.userId === userId && connection.sessionId === sessionId) {
        return connection;
      }
    }
    return null;
  }

  private channelsForConnection(
    conversationIds: Set<string>,
    userId: string,
    sessionId: string,
  ) {
    return [
      REALTIME_USER_CHANNEL(userId),
      REALTIME_SESSION_CHANNEL(sessionId),
      REALTIME_GLOBAL_CHANNEL,
      ...[...conversationIds].map((id) => REALTIME_CONVERSATION_CHANNEL(id)),
    ];
  }

  private deliver(connection: SseConnection, envelope: RealtimeEventEnvelope) {
    if (
      envelope.excludeSessionId &&
      envelope.excludeSessionId === connection.sessionId
    ) {
      return;
    }
    this.write(connection, envelope.event, envelope.data);
  }

  private write(connection: SseConnection, event: string, data: unknown) {
    if (connection.response.writableEnded) return;
    connection.eventId += 1;
    try {
      connection.response.write(
        formatSseEvent(event, data, connection.eventId),
      );
    } catch (error) {
      this.logger.warn(`Failed to write SSE event ${event}: ${String(error)}`);
    }
  }
}
