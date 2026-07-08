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

interface PendingSend {
  resolve: (message: Message) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

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

class RealtimeClient {
  private socket: Socket | null = null;
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

    if (this.socket?.connected) return;

    if (!this.socket) {
      this.socket = io(`${api.getWsUrl()}/realtime`, {
        auth: { token },
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
      });
      this.attachSocketListeners();
    } else {
      this.socket.auth = { token };
      this.socket.connect();
    }
  }

  private attachSocketListeners() {
    if (!this.socket) return;

    this.socket.on('message:receive', (message: Message) => {
      this.messageHandlers.forEach((h) => h(message));
    });

    this.socket.on('message:ack', (data: { clientMessageId?: string; message?: Message }) => {
      if (!data?.message) return;
      this.resolvePendingSend(data.clientMessageId ?? data.message.clientMessageId, data.message);
      this.ackHandlers.forEach((h) => h({ clientMessageId: data.clientMessageId, message: data.message! }));
    });

    this.socket.on('message:status', (data: {
      messageId: string;
      conversationId: string;
      status: MessageStatus;
    }) => {
      this.statusHandlers.forEach((h) => h(data));
    });

    this.socket.on('message:updated', (message: Message) => {
      this.messageUpdateHandlers.forEach((h) => h(message));
    });

    this.socket.on('message:hidden', (data: { messageId: string }) => {
      this.messageHiddenHandlers.forEach((h) => h(data));
    });

    this.socket.on('message:reaction', (data: {
      messageId: string;
      conversationId: string;
      reactions: MessageReaction[];
    }) => {
      this.reactionHandlers.forEach((h) => h(data));
    });

    this.socket.on('conversation:hidden', (data: { conversationId: string }) => {
      this.conversationHiddenHandlers.forEach((h) => h(data));
    });

    this.socket.on('conversation:messages_deleted', (data: {
      conversationId: string;
      messageIds: string[];
    }) => {
      this.conversationMessagesDeletedHandlers.forEach((h) => h(data));
    });

    this.socket.on('conversation:updated', (data: ConversationUpdatedEvent) => {
      this.conversationUpdatedHandlers.forEach((h) => h(data));
    });

    this.socket.on('conversation:created', (data: Conversation) => {
      this.conversationCreatedHandlers.forEach((h) => h(data));
    });

    this.socket.on('user:typing', (data) => {
      this.typingHandlers.forEach((h) => h(data));
    });

    this.socket.on('user:presence', (data: PresenceInfo) => {
      this.applyPresenceUpdate(data.userId, data.status, data.lastSeen);
      this.presenceHandlers.forEach((h) => h(data));
    });

    this.socket.on('presence:sync', (data: PresenceInfo[]) => {
      if (!Array.isArray(data)) return;
      this.applyPresenceBatch(data);
    });

    this.socket.on('connect', () => {
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = setInterval(() => {
        this.socket?.emit('presence:heartbeat');
      }, 25000);
      this.flushPendingPresenceQueries();
      this.connectHandlers.forEach((h) => h());
    });

    this.socket.on('disconnect', () => {
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
    });
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
    this.presenceChangeHandlers.forEach((h) => h());
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
    this.presenceChangeHandlers.forEach((h) => h());
  }

  private emitPresenceQuery(userIds: string[]) {
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
    if (!this.socket?.connected || this.pendingPresenceQueries.length === 0) return;

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

  disconnect() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.pendingSends.forEach((p) => {
      clearTimeout(p.timer);
      p.reject(new Error('Disconnected'));
    });
    this.pendingSends.clear();
    this.pendingPresenceQueries.forEach((query) => {
      query.reject(new Error('Disconnected'));
    });
    this.pendingPresenceQueries = [];
    this.socket?.disconnect();
    this.socket = null;
  }

  isConnected() {
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
    this.socket?.emit('conversation:join', { conversationId });
  }

  leaveConversation(conversationId: string) {
    this.socket?.emit('conversation:leave', { conversationId });
  }

  sendMessage(
    conversationId: string,
    content: string,
    clientMessageId?: string,
    replyToMessageId?: string,
  ) {
    const msgId = clientMessageId ?? createClientMessageId();

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
        { conversationId, content, clientMessageId: msgId, replyToMessageId },
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
    this.socket?.emit('user:typing', { conversationId, isTyping });
  }

  queryPresence(userIds: string[]) {
    const unique = [...new Set(userIds)].filter(Boolean);
    if (unique.length === 0) {
      return Promise.resolve<PresenceInfo[]>([]);
    }

    if (this.socket?.connected) {
      return this.emitPresenceQuery(unique).then((data) => {
        this.applyPresenceBatch(data);
        return data;
      });
    }

    if (!this.socket) {
      return Promise.reject(new Error('Not connected to server'));
    }

    return new Promise<PresenceInfo[]>((resolve, reject) => {
      this.pendingPresenceQueries.push({ userIds: unique, resolve, reject });
    });
  }

  markDelivered(messageId: string) {
    this.socket?.emit('message:delivered', { messageId });
  }

  markRead(messageId: string) {
    this.socket?.emit('message:read', { messageId });
  }

  editMessage(messageId: string, content: string) {
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
    if (this.socket?.connected) {
      handler();
    }
    return () => this.connectHandlers.delete(handler);
  }
}

export const realtime = new RealtimeClient();
