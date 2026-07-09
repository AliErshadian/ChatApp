import { getServiceUrls } from '../config/endpoints';
import { getClientSessionInfo } from '../utils/clientSession';
import { getSessionIdFromToken, isAccessTokenUsable } from '../utils/jwt';

export { getAssetBase, resolveAvatarUrl } from '../utils/avatar';

export interface User {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  createdAt?: string;
}

export interface Contact extends User {
  addedAt?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  sessionId?: string;
  /** @deprecated use sessionId */
  sessionFamilyId?: string;
}

export interface ActiveSession {
  sessionId: string;
  appName: string;
  deviceLabel: string;
  platform: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastActiveAt: string;
}

export interface Conversation {
  id: string;
  type: 'direct' | 'channel' | 'group';
  name: string;
  description?: string;
  avatarUrl?: string;
  isPublic?: boolean;
  members: Array<{
    userId: string;
    role: string;
    displayName?: string;
    username?: string;
    avatarUrl?: string;
    lastReadAt?: string;
  }>;
  createdAt: string;
  updatedAt: string;
  isPinned?: boolean;
  pinnedAt?: string;
  unreadCount?: number;
  lastMessage?: {
    id: string;
    content: string;
    contentType?: string;
    fileName?: string;
    caption?: string;
    senderId: string;
    senderName?: string;
    createdAt: string;
    deletedForEveryone?: boolean;
  };
}

export interface ConversationUpdatedEvent {
  conversationId: string;
  type?: Conversation['type'];
  isPublic?: boolean;
  name?: string;
  description?: string;
  avatarUrl?: string;
  members: Conversation['members'];
  memberCount: number;
  ownerId: string | null;
}

export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read';

export interface MessageReaction {
  emoji: string;
  count: number;
  reactedByMe: boolean;
}

export interface MessageReplyPreview {
  id: string;
  senderId: string;
  content: string;
  contentType?: string;
  fileName?: string;
  caption?: string;
  deletedForEveryone?: boolean;
  sender?: { id: string; displayName: string; username: string };
}

export interface MessageMention {
  userId: string;
  username: string;
  displayName: string;
}

export interface MessageForwardedFrom {
  messageId: string;
  senderId: string;
  sender?: { id: string; displayName: string; username: string };
}

export interface Message {
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
  createdAt: string;
  editedAt?: string;
  deletedForEveryone?: boolean;
  status?: MessageStatus;
  reactions?: MessageReaction[];
  mentions?: MessageMention[];
  replyTo?: MessageReplyPreview;
  forwardedFrom?: MessageForwardedFrom;
  sender?: { id: string; displayName: string; username: string };
}

class ApiClient {
  /** Short-lived access token kept in renderer memory only (never localStorage). */
  private accessToken: string | null = null;
  private sessionId: string | null = null;
  private refreshPromise: Promise<boolean> | null = null;

  private normalizeAuthTokens(data: AuthTokens): AuthTokens {
    const sessionId = data.sessionId ?? data.sessionFamilyId;
    return sessionId ? { ...data, sessionId } : data;
  }

  private resolveSessionId(accessToken?: string | null) {
    if (this.sessionId) return this.sessionId;
    const fromToken = getSessionIdFromToken(accessToken ?? this.accessToken);
    if (fromToken) {
      this.applySessionId(fromToken);
    }
    return this.sessionId;
  }

  private authApi() {
    return window.electronAPI?.auth;
  }

  private migrateLegacyLocalStorageTokens() {
    const accessToken = localStorage.getItem('accessToken');
    const refreshToken = localStorage.getItem('refreshToken');
    const sessionId =
      localStorage.getItem('sessionId') ??
      localStorage.getItem('sessionFamilyId') ??
      getSessionIdFromToken(accessToken);
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    if (!accessToken || !refreshToken) return null;
    return { accessToken, refreshToken, sessionId: sessionId ?? undefined };
  }

  /** Persist auth in the browser across restarts (Vite dev / web without Electron). */
  private browserStoreTokens(
    accessToken: string,
    refreshToken: string,
    sessionId?: string,
    apiBase?: string,
  ) {
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
    localStorage.setItem('authApiBase', apiBase ?? this.apiBase());
    if (sessionId) {
      localStorage.setItem('sessionId', sessionId);
    }
    localStorage.removeItem('sessionFamilyId');
    sessionStorage.removeItem('accessToken');
    sessionStorage.removeItem('refreshToken');
    sessionStorage.removeItem('sessionId');
    sessionStorage.removeItem('sessionFamilyId');
    sessionStorage.removeItem('authApiBase');
  }

  private browserLoadTokens(): {
    accessToken: string;
    refreshToken: string;
    sessionId: string | null;
  } | null {
    let accessToken = localStorage.getItem('accessToken');
    let refreshToken = localStorage.getItem('refreshToken');
    let sessionId =
      localStorage.getItem('sessionId') ?? localStorage.getItem('sessionFamilyId');
    if (!accessToken || !refreshToken) {
      accessToken = accessToken ?? sessionStorage.getItem('accessToken');
      refreshToken = refreshToken ?? sessionStorage.getItem('refreshToken');
      sessionId =
        sessionId ??
        sessionStorage.getItem('sessionId') ??
        sessionStorage.getItem('sessionFamilyId');
    }
    if (!accessToken || !refreshToken) return null;
    this.browserStoreTokens(
      accessToken,
      refreshToken,
      sessionId ?? getSessionIdFromToken(accessToken) ?? undefined,
      this.apiBase(),
    );
    return {
      accessToken,
      refreshToken,
      sessionId: sessionId ?? getSessionIdFromToken(accessToken),
    };
  }

  private browserGetRefreshToken(): string | null {
    return localStorage.getItem('refreshToken') ?? sessionStorage.getItem('refreshToken');
  }

  private browserClearTokens() {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('sessionId');
    localStorage.removeItem('sessionFamilyId');
    localStorage.removeItem('authApiBase');
    sessionStorage.removeItem('accessToken');
    sessionStorage.removeItem('refreshToken');
    sessionStorage.removeItem('sessionId');
    sessionStorage.removeItem('sessionFamilyId');
    sessionStorage.removeItem('authApiBase');
  }

  private applySessionId(sessionId?: string) {
    if (!sessionId) return;
    this.sessionId = sessionId;
    if (!this.authApi()) {
      localStorage.setItem('sessionId', sessionId);
      localStorage.removeItem('sessionFamilyId');
    }
  }

  private async getRefreshToken(): Promise<string | null> {
    const auth = this.authApi();
    if (auth?.getRefreshToken) {
      return auth.getRefreshToken();
    }
    return this.browserGetRefreshToken();
  }

  private async revokeCurrentSessionOnServer() {
    const refreshToken = await this.getRefreshToken();
    if (!refreshToken) return;

    try {
      await this.fetchWithTimeout(
        `${this.apiBase()}/auth/logout`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        },
        5_000,
      );
    } catch {
      // Best-effort server logout; always clear local state.
    }
  }

  async setTokens(tokens: AuthTokens) {
    const normalized = this.normalizeAuthTokens(tokens);
    this.accessToken = normalized.accessToken;
    this.applySessionId(normalized.sessionId);
    this.resolveSessionId(normalized.accessToken);

    const auth = this.authApi();
    if (auth) {
      const ok = await auth.setSession({
        accessToken: normalized.accessToken,
        refreshToken: normalized.refreshToken,
        expiresIn: normalized.expiresIn,
        sessionId: normalized.sessionId,
        apiBase: this.apiBase(),
      });
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('sessionId');
      localStorage.removeItem('sessionFamilyId');
      if (!ok) {
        throw new Error('Failed to persist auth session in Electron secure store');
      }
      await this.syncElectronApiBase();
      return;
    }

    this.browserStoreTokens(
      normalized.accessToken,
      normalized.refreshToken,
      normalized.sessionId,
      this.apiBase(),
    );
  }

  private async syncElectronApiBase() {
    const auth = this.authApi();
    if (!auth?.syncApiBase) return;
    await auth.syncApiBase(this.apiBase());
  }

  async loadTokens(): Promise<boolean> {
    const auth = this.authApi();
    if (auth) {
      const [, accessToken, sessionId] = await Promise.all([
        this.syncElectronApiBase(),
        auth.getAccessToken(),
        auth.getSessionId?.() ?? auth.getSessionFamilyId?.() ?? Promise.resolve(null),
      ]);

      const legacy = this.migrateLegacyLocalStorageTokens();
      if (legacy) {
        await auth.setSession({
          ...legacy,
          sessionId: legacy.sessionId,
          apiBase: this.apiBase(),
        });
      }

      if (accessToken) {
        this.accessToken = accessToken;
        if (sessionId) this.sessionId = sessionId;
        this.resolveSessionId(accessToken);
        return true;
      }
      return auth.hasSession();
    }

    const stored = this.browserLoadTokens();
    if (!stored) return false;
    this.accessToken = stored.accessToken;
    this.sessionId = stored.sessionId;
    this.resolveSessionId(stored.accessToken);
    return true;
  }

  async restoreSession(): Promise<User> {
    if (isAccessTokenUsable(this.accessToken)) {
      try {
        return await this.me();
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status !== 401) throw err;
      }
    }

    const refreshed = await this.refresh();
    if (refreshed && this.accessToken) {
      return this.me();
    }

    const hasStoredRefresh =
      (await this.getRefreshToken()) ?? this.browserGetRefreshToken();
    if (!hasStoredRefresh) {
      await this.clearTokens();
    }

    const error = new Error(
      hasStoredRefresh ? 'Cannot restore session right now' : 'Session expired',
    ) as Error & { status?: number };
    error.status = hasStoredRefresh ? undefined : 401;
    throw error;
  }

  async logout() {
    await this.revokeCurrentSessionOnServer();
    await this.clearTokens();
  }

  async clearTokens() {
    this.accessToken = null;
    this.sessionId = null;
    this.browserClearTokens();
    await this.authApi()?.clearSession();
  }

  getSessionId() {
    return this.resolveSessionId();
  }

  /** @deprecated use getSessionId */
  getSessionFamilyId() {
    return this.getSessionId();
  }

  getAccessToken() {
    return this.accessToken;
  }

  getWsUrl() {
    return getServiceUrls().wsBase;
  }

  private apiBase() {
    return getServiceUrls().apiBase;
  }

  private async fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeoutMs = 8_000,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      window.clearTimeout(timer);
    }
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };
    if (this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;

    let res: Response;
    try {
      res = await fetch(`${this.apiBase()}${path}`, { ...options, headers });
    } catch {
      throw new Error(
        `Cannot reach server (${this.apiBase()}). Check that the API is running and port 3000 is open on the firewall.`,
      );
    }

    if (res.status === 401) {
      const refreshed = await this.refresh();
      if (refreshed) {
        headers.Authorization = `Bearer ${this.accessToken}`;
        res = await fetch(`${this.apiBase()}${path}`, { ...options, headers });
      }
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const message = err.message ?? `HTTP ${res.status}`;
      const error = new Error(message) as Error & { status?: number };
      error.status = res.status;
      throw error;
    }
    return res.json();
  }

  async refresh(): Promise<boolean> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.performRefresh().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private async performRefresh(): Promise<boolean> {
    const auth = this.authApi();
    if (auth) {
      const next = await auth.refresh(getClientSessionInfo());
      if (!next?.accessToken) {
        this.accessToken = null;
        const stillHasSession = await auth.hasSession();
        if (!stillHasSession) {
          this.sessionId = null;
        }
        return false;
      }
      this.accessToken = next.accessToken;
      const sessionId = next.sessionId ?? (await auth.getSessionId?.()) ?? null;
      if (sessionId) {
        this.applySessionId(sessionId);
      } else {
        this.resolveSessionId(next.accessToken);
      }
      return true;
    }

    const refreshToken = this.browserGetRefreshToken();
    if (!refreshToken) {
      this.accessToken = null;
      return false;
    }

    try {
      const res = await this.fetchWithTimeout(`${this.apiBase()}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refreshToken,
          clientInfo: getClientSessionInfo(),
        }),
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          await this.clearTokens();
        }
        return false;
      }
      const data = this.normalizeAuthTokens((await res.json()) as AuthTokens);
      await this.setTokens(data);
      return true;
    } catch {
      return false;
    }
  }

  register(email: string, username: string, displayName: string, password: string) {
    return this.request<{ user: User } & AuthTokens>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email,
        username,
        displayName,
        password,
        clientInfo: getClientSessionInfo(),
      }),
    });
  }

  login(email: string, password: string) {
    return this.request<{ user: User } & AuthTokens>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
        clientInfo: getClientSessionInfo(),
      }),
    });
  }

  listSessions() {
    const request = this.request<ActiveSession[]>('/auth/sessions');
    const timeout = new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error('Sessions request timed out')), 8_000);
    });
    return Promise.race([request, timeout]);
  }

  revokeSession(sessionId: string) {
    return this.request<{ success: boolean }>(`/auth/sessions/${sessionId}`, {
      method: 'DELETE',
    });
  }

  revokeOtherSessions(exceptSessionId: string) {
    return this.request<{ success: boolean; revoked: number }>(
      `/auth/sessions/others?except=${encodeURIComponent(exceptSessionId)}`,
      { method: 'DELETE' },
    );
  }

  me() {
    return this.request<User>('/users/me');
  }

  listConversations() {
    return this.request<Conversation[]>('/conversations');
  }

  createChannel(name: string, description?: string) {
    return this.request<Conversation>('/conversations/channels', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    });
  }

  createGroup(input: {
    name: string;
    description?: string;
    memberIds?: string[];
    isPublic?: boolean;
  }) {
    return this.request<Conversation>('/conversations/groups', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  addConversationMembers(conversationId: string, userIds: string[]) {
    return this.request<{ added: string[] }>(`/conversations/${conversationId}/members`, {
      method: 'POST',
      body: JSON.stringify({ userIds }),
    });
  }

  removeConversationMember(conversationId: string, userId: string) {
    return this.request<{ conversationId: string; removedUserId: string }>(
      `/conversations/${conversationId}/members/${userId}`,
      { method: 'DELETE' },
    );
  }

  getChannelInvite(conversationId: string) {
    return this.request<{ token: string }>(`/conversations/${conversationId}/invite`);
  }

  getInvitePreview(token: string) {
    return this.request<{
      channelName: string;
      conversationId: string;
      conversationType?: 'channel' | 'group';
    }>(`/invites/${encodeURIComponent(token)}`);
  }

  getInviteStatus(token: string) {
    return this.request<{
      channelName: string;
      conversationId: string;
      isMember: boolean;
      conversationType?: 'channel' | 'group';
    }>(
      `/invites/${encodeURIComponent(token)}/status`,
    );
  }

  joinChannelByInvite(token: string) {
    return this.request<Conversation>(`/invites/${encodeURIComponent(token)}/join`, {
      method: 'POST',
    });
  }

  createDirect(userId: string) {
    return this.request<Conversation>('/conversations/direct', {
      method: 'POST',
      body: JSON.stringify({ userId }),
    });
  }

  deleteConversation(conversationId: string, scope: 'me' | 'everyone') {
    return this.request<{
      conversationId: string;
      scope: 'me' | 'everyone';
      deletedMessageIds: string[];
    }>(`/conversations/${conversationId}`, {
      method: 'DELETE',
      body: JSON.stringify({ scope }),
    });
  }

  leaveChannel(conversationId: string, newOwnerId?: string) {
    return this.request<{ conversationId: string; newOwnerId: string | null }>(
      `/conversations/${conversationId}/leave`,
      {
        method: 'POST',
        body: JSON.stringify(newOwnerId ? { newOwnerId } : {}),
      },
    );
  }

  pinConversation(conversationId: string) {
    return this.request<Conversation>(`/conversations/${conversationId}/pin`, {
      method: 'POST',
    });
  }

  unpinConversation(conversationId: string) {
    return this.request<Conversation>(`/conversations/${conversationId}/pin`, {
      method: 'DELETE',
    });
  }

  getMessages(conversationId: string, cursor?: string) {
    const qs = cursor ? `?cursor=${cursor}` : '';
    return this.request<{ messages: Message[]; nextCursor: string | null }>(
      `/conversations/${conversationId}/messages${qs}`,
    );
  }

  async sendMessageAttachment(
    conversationId: string,
    file: File,
    options?: {
      caption?: string;
      clientMessageId?: string;
      replyToMessageId?: string;
    },
  ) {
    const formData = new FormData();
    formData.append('file', file);
    if (options?.caption) formData.append('caption', options.caption);
    if (options?.clientMessageId) formData.append('clientMessageId', options.clientMessageId);
    if (options?.replyToMessageId) formData.append('replyToMessageId', options.replyToMessageId);

    const headers: Record<string, string> = {};
    if (this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;

    let res = await fetch(`${this.apiBase()}/conversations/${conversationId}/messages/attachment`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (res.status === 401) {
      const refreshed = await this.refresh();
      if (refreshed) {
        headers.Authorization = `Bearer ${this.accessToken}`;
        res = await fetch(`${this.apiBase()}/conversations/${conversationId}/messages/attachment`, {
          method: 'POST',
          headers,
          body: formData,
        });
      }
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message ?? `HTTP ${res.status}`);
    }

    return res.json() as Promise<Message>;
  }

  editMessage(conversationId: string, messageId: string, content: string) {
    return this.request<Message>(`/conversations/${conversationId}/messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    });
  }

  deleteMessage(conversationId: string, messageId: string, scope: 'me' | 'everyone') {
    return this.request<{ message?: Message; messageId: string; scope: 'me' | 'everyone' }>(
      `/conversations/${conversationId}/messages/${messageId}`,
      {
        method: 'DELETE',
        body: JSON.stringify({ scope }),
      },
    );
  }

  toggleReaction(conversationId: string, messageId: string, emoji: string) {
    return this.request<{
      messageId: string;
      conversationId: string;
      reactions: MessageReaction[];
    }>(`/conversations/${conversationId}/messages/${messageId}/reactions`, {
      method: 'POST',
      body: JSON.stringify({ emoji }),
    });
  }

  forwardMessage(
    conversationId: string,
    messageId: string,
    targetConversationIds: string[],
  ) {
    return this.request<{ messages: Message[] }>(
      `/conversations/${conversationId}/messages/${messageId}/forward`,
      {
        method: 'POST',
        body: JSON.stringify({ targetConversationIds }),
      },
    );
  }

  searchUsers(q: string) {
    return this.request<User[]>(`/users/search?q=${encodeURIComponent(q)}`);
  }

  listContacts() {
    return this.request<Contact[]>('/contacts');
  }

  addContact(userId: string) {
    return this.request<Contact>('/contacts', {
      method: 'POST',
      body: JSON.stringify({ userId }),
    });
  }

  removeContact(userId: string) {
    return this.request<{ removed: boolean }>(`/contacts/${userId}`, {
      method: 'DELETE',
    });
  }

  getUser(id: string) {
    return this.request<User>(`/users/${id}`);
  }

  async uploadAvatar(file: File) {
    const formData = new FormData();
    formData.append('avatar', file);

    const headers: Record<string, string> = {};
    if (this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;

    let res = await fetch(`${this.apiBase()}/users/me/avatar`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (res.status === 401) {
      const refreshed = await this.refresh();
      if (refreshed) {
        headers.Authorization = `Bearer ${this.accessToken}`;
        res = await fetch(`${this.apiBase()}/users/me/avatar`, {
          method: 'POST',
          headers,
          body: formData,
        });
      }
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message ?? `HTTP ${res.status}`);
    }
    return res.json() as Promise<User>;
  }

  async uploadChannelAvatar(conversationId: string, file: File) {
    const formData = new FormData();
    formData.append('avatar', file);

    const headers: Record<string, string> = {};
    if (this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;

    let res = await fetch(`${this.apiBase()}/conversations/${conversationId}/avatar`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (res.status === 401) {
      const refreshed = await this.refresh();
      if (refreshed) {
        headers.Authorization = `Bearer ${this.accessToken}`;
        res = await fetch(`${this.apiBase()}/conversations/${conversationId}/avatar`, {
          method: 'POST',
          headers,
          body: formData,
        });
      }
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message ?? `HTTP ${res.status}`);
    }
    return res.json() as Promise<{ id: string; avatarUrl: string }>;
  }
}

export const api = new ApiClient();
