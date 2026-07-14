import { io, Socket } from 'socket.io-client';
import { api } from './api';
import { createClientMessageId } from '../utils/uuid';
import type { Message, MessageReaction, MessageStatus, Conversation, ConversationUpdatedEvent } from './api';

type MessageHandler = (message: Message) => void;
type TypingHandler = (data: { conversationId: string; userId: string; isTyping: boolean }) => void;
export interface PresenceInfo {
  userId: string;
  status: string;
  lastSeen: string;
}

type ConnectHandler = () => void;
type PresenceChangeHandler = () => void;
type TransportMode = 'websocket' | 'sse';

interface PendingPresenceQuery {
  userIds: string[];
  resolve: (data: PresenceInfo[]) => void;
  reject: (error: Error) => void;
}

export type AvatarPresence = 'online' | 'offline';

function normalizePresenceStatus(status: string): AvatarPresence {
  return status === 'online' ? 'online' : 'offline';
}

type PresenceHandler = (data: PresenceInfo) => void;
type StatusHandler = (data: { messageId: string; conversationId: string; status: MessageStatus }) => void;
type AckHandler = (data: { clientMessageId?: string; message: Message }) => void;
type MessageUpdateHandler = (message: Message) => void;
type MessageHiddenHandler = (data: { messageId: string }) => void;
type ReactionHandler = (data: {
  messageId: string;
  conversationId: string;
  reactions: MessageReaction[];
}) => void;
type ConversationHiddenHandler = (data: { conversationId: string }) => void;
type ConversationMessagesDeletedHandler = (data: {
  conversationId: string;
  messageIds: string[];
}) => void;
type ConversationUpdatedHandler = (data: ConversationUpdatedEvent) => void;
type ConversationCreatedHandler = (conversation: Conversation) => void;
type SessionTerminatedHandler = (data: { sessionId: string }) => void;
type SessionCreatedHandler = (data: {
  sessionId: string;
  deviceLabel: string;
  appName: string;
  platform: string | null;
  ipAddress: string | null;
}) => void;

type CallIncomingHandler = (data: {
  callId: string;
  conversationId: string;
  caller: { id: string; displayName: string; username: string };
}) => void;

type CallAcceptedHandler = (data: {
  callId: string;
  conversationId: string;
  acceptedBy: string;
}) => void;

type CallEndedHandler = (data: {
  callId: string;
  conversationId: string;
  reason: string;
  endedBy?: string;
}) => void;

type CallSignalHandler = (data: {
  callId: string;
  type: 'offer' | 'answer' | 'ice';
  payload: unknown;
  fromUserId: string;
}) => void;

interface PendingSend {
  resolve: (message: Message) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const SSE_EVENTS = [
  'message:receive',
  'message:ack',
  'message:status',
  'message:updated',
  'message:hidden',
  'message:reaction',
  'message:read',
  'conversation:hidden',
  'conversation:messages_deleted',
  'conversation:updated',
  'conversation:created',
  'conversation:activity',
  'session:terminated',
  'session:created',
  'user:typing',
  'user:presence',
  'presence:sync',
] as const;

const WS_CONNECT_TIMEOUT_MS = 8_000;

function parseSendAck(ack: unknown): Message | null {
  if (!ack || typeof ack !== 'object') return null;
  const payload = ack as Record<string, unknown>;

  if (payload.message && typeof payload.message === 'object') {
    return payload.message as Message;
  }

  if (payload.data && typeof payload.data === 'object') {
    const data = payload.data as Record<string, unknown>;
    if (data.message && typeof data.message === 'object') {
      return data.message as Message;
    }
  }

  return null;
}

function parseWsAckMessage(ack: unknown, fallback: string): string {
  if (!ack || typeof ack !== 'object') return fallback;
  const payload = ack as Record<string, unknown>;
  if (typeof payload.message === 'string') return payload.message;
  if (typeof payload.error === 'string') return payload.error;
  if (payload.status === 'error' && typeof payload.message === 'string') return payload.message;
  return fallback;
}

class RealtimeClient {
  private socket: Socket | null = null;
  private eventSource: EventSource | null = null;
  private transport: TransportMode | null = null;
  private connectPromise: Promise<void> | null = null;
  private messageHandlers = new Set<MessageHandler>();
  private typingHandlers = new Set<TypingHandler>();
  private presenceHandlers = new Set<PresenceHandler>();
  private statusHandlers = new Set<StatusHandler>();
  private ackHandlers = new Set<AckHandler>();
  private messageUpdateHandlers = new Set<MessageUpdateHandler>();
  private messageHiddenHandlers = new Set<MessageHiddenHandler>();
  private reactionHandlers = new Set<ReactionHandler>();
  private conversationHiddenHandlers = new Set<ConversationHiddenHandler>();
  private conversationMessagesDeletedHandlers = new Set<ConversationMessagesDeletedHandler>();
  private conversationUpdatedHandlers = new Set<ConversationUpdatedHandler>();
  private conversationCreatedHandlers = new Set<ConversationCreatedHandler>();
  private sessionTerminatedHandlers = new Set<SessionTerminatedHandler>();
  private sessionCreatedHandlers = new Set<SessionCreatedHandler>();
  private callIncomingHandlers = new Set<CallIncomingHandler>();
  private callAcceptedHandlers = new Set<CallAcceptedHandler>();
  private callEndedHandlers = new Set<CallEndedHandler>();
  private callSignalHandlers = new Set<CallSignalHandler>();
  private connectHandlers = new Set<ConnectHandler>();
  private presenceChangeHandlers = new Set<PresenceChangeHandler>();
  private pendingSends = new Map<string, PendingSend>();
  private pendingPresenceQueries: PendingPresenceQuery[] = [];
  private presenceByUserId: Record<string, AvatarPresence> = {};
  private lastSeenByUserId: Record<string, string> = {};
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  connect() {
    const token = api.getAccessToken();
    if (!token) throw new Error('Not authenticated');
    if (this.isConnected()) return;

    if (!this.connectPromise) {
      this.connectPromise = this.connectWithFallback().finally(() => {
        this.connectPromise = null;
      });
    }

    return this.connectPromise;
  }

  getTransport(): TransportMode | null {
    return this.transport;
  }

  private async connectWithFallback() {
    try {
      await this.connectWebSocket();
      this.transport = 'websocket';
    } catch {
      this.disconnectSocketOnly();
      await this.connectSse();
      this.transport = 'sse';
    }
  }

  private connectWebSocket(): Promise<void> {
    const token = api.getAccessToken();
    if (!token) return Promise.reject(new Error('Not authenticated'));

    return new Promise((resolve, reject) => {
      const socket = io(`${api.getWsUrl()}/realtime`, {
        auth: { token },
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        timeout: WS_CONNECT_TIMEOUT_MS,
      });

      const timer = window.setTimeout(() => {
        socket.disconnect();
        reject(new Error('WebSocket connection timeout'));
      }, WS_CONNECT_TIMEOUT_MS);

      const cleanup = () => {
        window.clearTimeout(timer);
        socket.off('connect', onConnect);
        socket.off('connect_error', onError);
      };

      const onConnect = () => {
        cleanup();
        this.socket = socket;
        this.attachSocketListeners();
        resolve();
      };

      const onError = (error: Error) => {
        cleanup();
        socket.disconnect();
        reject(error);
      };

      socket.on('connect', onConnect);
      socket.on('connect_error', onError);
    });
  }

  private connectSse(): Promise<void> {
    const token = api.getAccessToken();
    if (!token) return Promise.reject(new Error('Not authenticated'));

    return new Promise((resolve, reject) => {
      const url = `${api.getApiBase()}/realtime/stream?access_token=${encodeURIComponent(token)}`;
      const eventSource = new EventSource(url);

      const timer = window.setTimeout(() => {
        eventSource.close();
        reject(new Error('SSE connection timeout'));
      }, WS_CONNECT_TIMEOUT_MS);

      eventSource.onopen = () => {
        window.clearTimeout(timer);
        this.eventSource = eventSource;
        this.attachSseListeners(eventSource);
        this.startHeartbeat();
        this.flushPendingPresenceQueries();
        this.connectHandlers.forEach((handler) => handler());
        resolve();
      };

      eventSource.onerror = () => {
        if (this.eventSource) return;
        window.clearTimeout(timer);
        eventSource.close();
        reject(new Error('SSE connection failed'));
      };
    });
  }

  private attachSocketListeners() {
    if (!this.socket) return;

    this.socket.on('message:receive', (message: Message) => {
      this.dispatchMessageReceive(message);
    });

    this.socket.on('message:ack', (data: { clientMessageId?: string; message?: Message }) => {
      this.dispatchMessageAck(data);
    });

    this.socket.on('message:status', (data: {
      messageId: string;
      conversationId: string;
      status: MessageStatus;
    }) => {
      this.statusHandlers.forEach((handler) => handler(data));
    });

    this.socket.on('message:updated', (message: Message) => {
      this.messageUpdateHandlers.forEach((handler) => handler(message));
    });

    this.socket.on('message:hidden', (data: { messageId: string }) => {
      this.messageHiddenHandlers.forEach((handler) => handler(data));
    });

    this.socket.on('message:reaction', (data: {
      messageId: string;
      conversationId: string;
      reactions: MessageReaction[];
    }) => {
      this.reactionHandlers.forEach((handler) => handler(data));
    });

    this.socket.on('conversation:hidden', (data: { conversationId: string }) => {
      this.conversationHiddenHandlers.forEach((handler) => handler(data));
    });

    this.socket.on('conversation:messages_deleted', (data: {
      conversationId: string;
      messageIds: string[];
    }) => {
      this.conversationMessagesDeletedHandlers.forEach((handler) => handler(data));
    });

    this.socket.on('conversation:updated', (data: ConversationUpdatedEvent) => {
      this.conversationUpdatedHandlers.forEach((handler) => handler(data));
    });

    this.socket.on('conversation:created', (data: Conversation) => {
      this.conversationCreatedHandlers.forEach((handler) => handler(data));
    });

    this.socket.on('session:terminated', (data: { sessionId: string }) => {
      this.dispatchSessionTerminated(data);
    });

    this.socket.on(
      'session:created',
      (data: {
        sessionId: string;
        deviceLabel: string;
        appName: string;
        platform: string | null;
        ipAddress: string | null;
      }) => {
        this.dispatchSessionCreated(data);
      },
    );

    this.socket.on('user:typing', (data) => {
      this.typingHandlers.forEach((handler) => handler(data));
    });

    this.socket.on('user:presence', (data: PresenceInfo) => {
      this.dispatchPresence(data);
    });

    this.socket.on('presence:sync', (data: PresenceInfo[]) => {
      this.dispatchPresenceBatch(data);
    });

    this.socket.on('call:incoming', (data) => {
      this.callIncomingHandlers.forEach((handler) => handler(data));
    });

    this.socket.on('call:accepted', (data) => {
      this.callAcceptedHandlers.forEach((handler) => handler(data));
    });

    this.socket.on('call:ended', (data) => {
      this.callEndedHandlers.forEach((handler) => handler(data));
    });

    this.socket.on('call:signal', (data) => {
      this.callSignalHandlers.forEach((handler) => handler(data));
    });

    this.socket.on('connect', () => {
      this.startHeartbeat();
      this.flushPendingPresenceQueries();
      this.connectHandlers.forEach((handler) => handler());
    });

    this.socket.on('disconnect', () => {
      this.stopHeartbeat();
    });
  }

  private attachSseListeners(eventSource: EventSource) {
    for (const eventName of SSE_EVENTS) {
      eventSource.addEventListener(eventName, (event) => {
        const messageEvent = event as MessageEvent<string>;
        let data: unknown;
        try {
          data = JSON.parse(messageEvent.data);
        } catch {
          return;
        }
        this.dispatchSseEvent(eventName, data);
      });
    }
  }

  private dispatchSseEvent(eventName: string, data: unknown) {
    switch (eventName) {
      case 'message:receive':
        this.dispatchMessageReceive(data as Message);
        break;
      case 'message:ack':
        this.dispatchMessageAck(data as { clientMessageId?: string; message?: Message });
        break;
      case 'message:status':
        this.statusHandlers.forEach((handler) =>
          handler(data as { messageId: string; conversationId: string; status: MessageStatus }),
        );
        break;
      case 'message:updated':
        this.messageUpdateHandlers.forEach((handler) => handler(data as Message));
        break;
      case 'message:hidden':
        this.messageHiddenHandlers.forEach((handler) => handler(data as { messageId: string }));
        break;
      case 'message:reaction':
        this.reactionHandlers.forEach((handler) =>
          handler(
            data as {
              messageId: string;
              conversationId: string;
              reactions: MessageReaction[];
            },
          ),
        );
        break;
      case 'conversation:hidden':
        this.conversationHiddenHandlers.forEach((handler) =>
          handler(data as { conversationId: string }),
        );
        break;
      case 'conversation:messages_deleted':
        this.conversationMessagesDeletedHandlers.forEach((handler) =>
          handler(data as { conversationId: string; messageIds: string[] }),
        );
        break;
      case 'conversation:updated':
        this.conversationUpdatedHandlers.forEach((handler) =>
          handler(data as ConversationUpdatedEvent),
        );
        break;
      case 'conversation:created':
        this.conversationCreatedHandlers.forEach((handler) => handler(data as Conversation));
        break;
      case 'session:terminated':
        this.dispatchSessionTerminated(data as { sessionId: string });
        break;
      case 'session:created':
        this.dispatchSessionCreated(
          data as {
            sessionId: string;
            deviceLabel: string;
            appName: string;
            platform: string | null;
            ipAddress: string | null;
          },
        );
        break;
      case 'user:typing':
        this.typingHandlers.forEach((handler) =>
          handler(data as { conversationId: string; userId: string; isTyping: boolean }),
        );
        break;
      case 'user:presence':
        this.dispatchPresence(data as PresenceInfo);
        break;
      case 'presence:sync':
        this.dispatchPresenceBatch(data as PresenceInfo[]);
        break;
      default:
        break;
    }
  }

  private dispatchMessageReceive(message: Message) {
    this.messageHandlers.forEach((handler) => handler(message));
  }

  private dispatchMessageAck(data: { clientMessageId?: string; message?: Message }) {
    if (!data?.message) return;
    this.resolvePendingSend(data.clientMessageId ?? data.message.clientMessageId, data.message);
    this.ackHandlers.forEach((handler) =>
      handler({ clientMessageId: data.clientMessageId, message: data.message! }),
    );
  }

  private dispatchSessionTerminated(data: { sessionId: string }) {
    if (!data?.sessionId) return;
    this.sessionTerminatedHandlers.forEach((handler) => handler(data));
  }

  private dispatchSessionCreated(data: {
    sessionId: string;
    deviceLabel: string;
    appName: string;
    platform: string | null;
    ipAddress: string | null;
  }) {
    if (!data?.sessionId) return;
    this.sessionCreatedHandlers.forEach((handler) => handler(data));
  }

  private dispatchPresence(data: PresenceInfo) {
    this.applyPresenceUpdate(data.userId, data.status, data.lastSeen);
    this.presenceHandlers.forEach((handler) => handler(data));
  }

  private dispatchPresenceBatch(data: PresenceInfo[]) {
    if (!Array.isArray(data)) return;
    this.applyPresenceBatch(data);
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.transport === 'sse') {
        void api.realtimeHeartbeat().catch(() => undefined);
        return;
      }
      this.socket?.emit('presence:heartbeat');
    }, 25000);
  }

  private stopHeartbeat() {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private applyPresenceUpdate(userId: string, status: string, lastSeen?: string) {
    if (!userId) return;
    const next = normalizePresenceStatus(status);
    const statusChanged = this.presenceByUserId[userId] !== next;
    const lastSeenChanged = Boolean(lastSeen && this.lastSeenByUserId[userId] !== lastSeen);
    if (!statusChanged && !lastSeenChanged) return;

    if (statusChanged) {
      this.presenceByUserId = { ...this.presenceByUserId, [userId]: next };
    }
    if (lastSeen) {
      this.lastSeenByUserId = { ...this.lastSeenByUserId, [userId]: lastSeen };
    }
    this.presenceChangeHandlers.forEach((handler) => handler());
  }

  private applyPresenceBatch(entries: PresenceInfo[]) {
    let changed = false;
    const nextPresence = { ...this.presenceByUserId };
    const nextLastSeen = { ...this.lastSeenByUserId };

    for (const entry of entries) {
      const status = normalizePresenceStatus(entry.status);
      if (nextPresence[entry.userId] !== status) {
        nextPresence[entry.userId] = status;
        changed = true;
      }
      if (entry.lastSeen && nextLastSeen[entry.userId] !== entry.lastSeen) {
        nextLastSeen[entry.userId] = entry.lastSeen;
        changed = true;
      }
    }

    if (!changed) return;
    this.presenceByUserId = nextPresence;
    this.lastSeenByUserId = nextLastSeen;
    this.presenceChangeHandlers.forEach((handler) => handler());
  }

  private emitPresenceQuery(userIds: string[]) {
    if (this.transport === 'sse') {
      return api.queryRealtimePresence(userIds).then((result) => result.data);
    }

    return new Promise<PresenceInfo[]>((resolve, reject) => {
      if (!this.socket?.connected) {
        reject(new Error('Not connected to server'));
        return;
      }

      this.socket.emit('presence:query', { userIds }, (ack: unknown) => {
        const payload = ack as { data?: PresenceInfo[] };
        if (Array.isArray(payload?.data)) {
          resolve(payload.data);
          return;
        }
        reject(new Error('Failed to query presence'));
      });
    });
  }

  private flushPendingPresenceQueries() {
    if (!this.isConnected() || this.pendingPresenceQueries.length === 0) return;

    const pending = [...this.pendingPresenceQueries];
    this.pendingPresenceQueries = [];

    for (const query of pending) {
      this.emitPresenceQuery(query.userIds)
        .then((data) => {
          this.applyPresenceBatch(data);
          query.resolve(data);
        })
        .catch((error) => {
          query.reject(error instanceof Error ? error : new Error('Failed to query presence'));
        });
    }
  }

  private resolvePendingSend(clientMessageId: string | undefined, message: Message) {
    if (!clientMessageId) return;
    const pending = this.pendingSends.get(clientMessageId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingSends.delete(clientMessageId);
    pending.resolve(message);
  }

  private disconnectSocketOnly() {
    this.socket?.disconnect();
    this.socket = null;
  }

  disconnect() {
    this.stopHeartbeat();
    this.pendingSends.forEach((pending) => {
      clearTimeout(pending.timer);
      pending.reject(new Error('Disconnected'));
    });
    this.pendingSends.clear();
    this.pendingPresenceQueries.forEach((query) => {
      query.reject(new Error('Disconnected'));
    });
    this.pendingPresenceQueries = [];
    this.disconnectSocketOnly();
    this.eventSource?.close();
    this.eventSource = null;
    this.transport = null;
  }

  isConnected() {
    if (this.transport === 'sse') {
      return Boolean(this.eventSource && this.eventSource.readyState === EventSource.OPEN);
    }
    return Boolean(this.socket?.connected);
  }

  getPresenceStatus(userId: string | undefined): AvatarPresence | undefined {
    if (!userId) return undefined;
    return this.presenceByUserId[userId];
  }

  getLastSeen(userId: string | undefined): string | undefined {
    if (!userId) return undefined;
    return this.lastSeenByUserId[userId];
  }

  joinConversation(conversationId: string) {
    if (this.transport === 'sse') {
      void api.joinRealtimeConversation(conversationId).catch(() => undefined);
      return;
    }
    this.socket?.emit('conversation:join', { conversationId });
  }

  leaveConversation(conversationId: string) {
    if (this.transport === 'sse') {
      void api.leaveRealtimeConversation(conversationId).catch(() => undefined);
      return;
    }
    this.socket?.emit('conversation:leave', { conversationId });
  }

  sendMessage(
    conversationId: string,
    content: string,
    clientMessageId?: string,
    replyToMessageId?: string,
    threadRootId?: string,
  ) {
    const msgId = clientMessageId ?? createClientMessageId();

    if (this.transport === 'sse') {
      return api
        .sendRealtimeMessage(conversationId, content, msgId, replyToMessageId, threadRootId)
        .then((result) => result.message);
    }

    return new Promise<Message>((resolve, reject) => {
      if (!this.socket?.connected) {
        reject(new Error('Not connected to server'));
        return;
      }

      const timer = setTimeout(() => {
        this.pendingSends.delete(msgId);
        reject(new Error('Send timeout'));
      }, 15000);

      this.pendingSends.set(msgId, { resolve, reject, timer });

      this.socket!.emit(
        'message:send',
        {
          conversationId,
          content,
          clientMessageId: msgId,
          replyToMessageId,
          threadRootId,
        },
        (ack: unknown) => {
          const message = parseSendAck(ack);
          if (message) {
            this.resolvePendingSend(msgId, message);
          }
        },
      );
    });
  }

  setTyping(conversationId: string, isTyping: boolean) {
    if (this.transport === 'sse') {
      void api.sendRealtimeTyping(conversationId, isTyping).catch(() => undefined);
      return;
    }
    this.socket?.emit('user:typing', { conversationId, isTyping });
  }

  queryPresence(userIds: string[]) {
    const unique = [...new Set(userIds)].filter(Boolean);
    if (unique.length === 0) {
      return Promise.resolve<PresenceInfo[]>([]);
    }

    if (this.isConnected()) {
      return this.emitPresenceQuery(unique).then((data) => {
        this.applyPresenceBatch(data);
        return data;
      });
    }

    if (!this.socket && !this.eventSource) {
      return Promise.reject(new Error('Not connected to server'));
    }

    return new Promise<PresenceInfo[]>((resolve, reject) => {
      this.pendingPresenceQueries.push({ userIds: unique, resolve, reject });
    });
  }

  markDelivered(messageId: string) {
    if (this.transport === 'sse') {
      void api.markRealtimeDelivered(messageId).catch(() => undefined);
      return;
    }
    this.socket?.emit('message:delivered', { messageId });
  }

  markRead(messageId: string) {
    if (this.transport === 'sse') {
      void api.markRealtimeRead(messageId).catch(() => undefined);
      return;
    }
    this.socket?.emit('message:read', { messageId });
  }

  editMessage(messageId: string, content: string) {
    if (this.transport === 'sse') {
      return api.realtimeEditMessage(messageId, content).then((result) => result.message);
    }

    return new Promise<Message>((resolve, reject) => {
      if (!this.socket?.connected) {
        reject(new Error('Not connected to server'));
        return;
      }
      this.socket.emit('message:edit', { messageId, content }, (ack: unknown) => {
        const payload = ack as { success?: boolean; message?: Message };
        if (payload?.success && payload.message) {
          resolve(payload.message);
          return;
        }
        reject(new Error('Failed to edit message'));
      });
    });
  }

  deleteMessage(messageId: string, scope: 'me' | 'everyone') {
    if (this.transport === 'sse') {
      return api.realtimeDeleteMessage(messageId, scope).then((result) => ({
        messageId: result.messageId,
        scope: result.scope,
        message: result.message,
      }));
    }

    return new Promise<{ message?: Message; messageId: string; scope: 'me' | 'everyone' }>(
      (resolve, reject) => {
        if (!this.socket?.connected) {
          reject(new Error('Not connected to server'));
          return;
        }
        this.socket.emit(
          'message:delete',
          { messageId, scope },
          (ack: { success?: boolean; message?: Message; messageId?: string; scope?: 'me' | 'everyone' }) => {
            if (ack?.success) {
              resolve({
                messageId: ack.messageId ?? messageId,
                scope: ack.scope ?? scope,
                message: ack.message,
              });
              return;
            }
            reject(new Error('Failed to delete message'));
          },
        );
      },
    );
  }

  toggleReaction(messageId: string, emoji: string) {
    if (this.transport === 'sse') {
      return api.realtimeToggleReaction(messageId, emoji);
    }

    return new Promise<{
      messageId: string;
      conversationId: string;
      reactions: MessageReaction[];
    }>((resolve, reject) => {
      if (!this.socket?.connected) {
        reject(new Error('Not connected to server'));
        return;
      }
      this.socket.emit(
        'message:reaction',
        { messageId, emoji },
        (ack: {
          success?: boolean;
          messageId?: string;
          conversationId?: string;
          reactions?: MessageReaction[];
        }) => {
          if (ack?.success && ack.messageId && ack.conversationId && ack.reactions) {
            resolve({
              messageId: ack.messageId,
              conversationId: ack.conversationId,
              reactions: ack.reactions,
            });
            return;
          }
          reject(new Error('Failed to toggle reaction'));
        },
      );
    });
  }

  deleteConversation(conversationId: string, scope: 'me' | 'everyone') {
    if (this.transport === 'sse') {
      return api.realtimeDeleteConversation(conversationId, scope);
    }

    return new Promise<{
      conversationId: string;
      scope: 'me' | 'everyone';
      deletedMessageIds: string[];
    }>((resolve, reject) => {
      if (!this.socket?.connected) {
        reject(new Error('Not connected to server'));
        return;
      }
      this.socket.emit(
        'conversation:delete',
        { conversationId, scope },
        (ack: {
          success?: boolean;
          conversationId?: string;
          scope?: 'me' | 'everyone';
          deletedMessageIds?: string[];
        }) => {
          if (ack?.success && ack.conversationId && ack.scope) {
            resolve({
              conversationId: ack.conversationId,
              scope: ack.scope,
              deletedMessageIds: ack.deletedMessageIds ?? [],
            });
            return;
          }
          reject(new Error('Failed to delete conversation'));
        },
      );
    });
  }

  private requireWebSocket() {
    if (this.transport !== 'websocket' || !this.socket?.connected) {
      throw new Error('Voice calls require a live WebSocket connection');
    }
    return this.socket;
  }

  inviteCall(conversationId: string, options?: { video?: boolean }) {
    const socket = this.requireWebSocket();
    return new Promise<{ callId: string; conversationId: string; calleeId: string }>(
      (resolve, reject) => {
        socket.emit(
          'call:invite',
          { conversationId, mediaType: options?.video ? 'video' : 'audio' },
          (ack: unknown) => {
          const payload = ack as {
            success?: boolean;
            callId?: string;
            conversationId?: string;
            calleeId?: string;
            message?: string;
          };
          if (payload?.success && payload.callId) {
            resolve({
              callId: payload.callId,
              conversationId: payload.conversationId ?? conversationId,
              calleeId: payload.calleeId ?? '',
            });
            return;
          }
          reject(new Error(parseWsAckMessage(ack, 'Failed to start call')));
        });
      },
    );
  }

  acceptCall(callId: string) {
    const socket = this.requireWebSocket();
    return new Promise<{ callId: string; conversationId: string; acceptedBy: string }>(
      (resolve, reject) => {
        socket.emit('call:accept', { callId }, (ack: unknown) => {
          const payload = ack as {
            success?: boolean;
            callId?: string;
            conversationId?: string;
            acceptedBy?: string;
            message?: string;
          };
          if (payload?.success && payload.callId) {
            resolve({
              callId: payload.callId,
              conversationId: payload.conversationId ?? '',
              acceptedBy: payload.acceptedBy ?? '',
            });
            return;
          }
          reject(new Error(parseWsAckMessage(ack, 'Failed to accept call')));
        });
      },
    );
  }

  rejectCall(callId: string) {
    const socket = this.requireWebSocket();
    return new Promise<void>((resolve, reject) => {
      socket.emit('call:reject', { callId }, (ack: { success?: boolean; message?: string }) => {
        if (ack?.success) {
          resolve();
          return;
        }
        reject(new Error(ack?.message ?? 'Failed to reject call'));
      });
    });
  }

  endCall(callId: string) {
    const socket = this.requireWebSocket();
    return new Promise<void>((resolve, reject) => {
      socket.emit('call:end', { callId }, (ack: { success?: boolean; message?: string }) => {
        if (ack?.success) {
          resolve();
          return;
        }
        reject(new Error(ack?.message ?? 'Failed to end call'));
      });
    });
  }

  sendCallSignal(callId: string, type: 'offer' | 'answer' | 'ice', payload: unknown) {
    const socket = this.requireWebSocket();
    return new Promise<void>((resolve, reject) => {
      socket.emit(
        'call:signal',
        { callId, type, payload },
        (ack: { success?: boolean; message?: string }) => {
          if (ack?.success) {
            resolve();
            return;
          }
          reject(new Error(ack?.message ?? 'Failed to send call signal'));
        },
      );
    });
  }

  onCallIncoming(handler: CallIncomingHandler) {
    this.callIncomingHandlers.add(handler);
    return () => this.callIncomingHandlers.delete(handler);
  }

  onCallAccepted(handler: CallAcceptedHandler) {
    this.callAcceptedHandlers.add(handler);
    return () => this.callAcceptedHandlers.delete(handler);
  }

  onCallEnded(handler: CallEndedHandler) {
    this.callEndedHandlers.add(handler);
    return () => this.callEndedHandlers.delete(handler);
  }

  onCallSignal(handler: CallSignalHandler) {
    this.callSignalHandlers.add(handler);
    return () => this.callSignalHandlers.delete(handler);
  }

  onMessage(handler: MessageHandler) {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onAck(handler: AckHandler) {
    this.ackHandlers.add(handler);
    return () => this.ackHandlers.delete(handler);
  }

  onStatus(handler: StatusHandler) {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  onMessageUpdated(handler: MessageUpdateHandler) {
    this.messageUpdateHandlers.add(handler);
    return () => this.messageUpdateHandlers.delete(handler);
  }

  onMessageHidden(handler: MessageHiddenHandler) {
    this.messageHiddenHandlers.add(handler);
    return () => this.messageHiddenHandlers.delete(handler);
  }

  onReaction(handler: ReactionHandler) {
    this.reactionHandlers.add(handler);
    return () => this.reactionHandlers.delete(handler);
  }

  onConversationHidden(handler: ConversationHiddenHandler) {
    this.conversationHiddenHandlers.add(handler);
    return () => this.conversationHiddenHandlers.delete(handler);
  }

  onConversationMessagesDeleted(handler: ConversationMessagesDeletedHandler) {
    this.conversationMessagesDeletedHandlers.add(handler);
    return () => this.conversationMessagesDeletedHandlers.delete(handler);
  }

  onConversationUpdated(handler: ConversationUpdatedHandler) {
    this.conversationUpdatedHandlers.add(handler);
    return () => this.conversationUpdatedHandlers.delete(handler);
  }

  onConversationCreated(handler: ConversationCreatedHandler) {
    this.conversationCreatedHandlers.add(handler);
    return () => this.conversationCreatedHandlers.delete(handler);
  }

  onTyping(handler: TypingHandler) {
    this.typingHandlers.add(handler);
    return () => this.typingHandlers.delete(handler);
  }

  onPresence(handler: PresenceHandler) {
    this.presenceHandlers.add(handler);
    return () => this.presenceHandlers.delete(handler);
  }

  onPresenceChange(handler: PresenceChangeHandler) {
    this.presenceChangeHandlers.add(handler);
    return () => this.presenceChangeHandlers.delete(handler);
  }

  onConnect(handler: ConnectHandler) {
    this.connectHandlers.add(handler);
    if (this.isConnected()) {
      handler();
    }
    return () => this.connectHandlers.delete(handler);
  }

  onSessionTerminated(handler: SessionTerminatedHandler) {
    this.sessionTerminatedHandlers.add(handler);
    return () => this.sessionTerminatedHandlers.delete(handler);
  }

  onSessionCreated(handler: SessionCreatedHandler) {
    this.sessionCreatedHandlers.add(handler);
    return () => this.sessionCreatedHandlers.delete(handler);
  }
}

export const realtime = new RealtimeClient();
