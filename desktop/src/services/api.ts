import { getServiceUrls } from '../config/endpoints';

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
  replyTo?: MessageReplyPreview;
  sender?: { id: string; displayName: string; username: string };
}

class ApiClient {
  /** Short-lived access token kept in renderer memory only (never localStorage). */
  private accessToken: string | null = null;

  private authApi() {
    return window.electronAPI?.auth;
  }

  private migrateLegacyLocalStorageTokens() {
    const accessToken = localStorage.getItem('accessToken');
    const refreshToken = localStorage.getItem('refreshToken');
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    if (!accessToken || !refreshToken) return null;
    return { accessToken, refreshToken };
  }

  async setTokens(tokens: AuthTokens) {
    this.accessToken = tokens.accessToken;
    const auth = this.authApi();
    if (auth) {
      const ok = await auth.setSession({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
        apiBase: this.apiBase(),
      });
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      if (!ok) {
        throw new Error('Failed to persist auth session in Electron secure store');
      }
      return;
    }

    // Dev browser (Vite without Electron): keep tokens for page refresh only.
    sessionStorage.setItem('accessToken', tokens.accessToken);
    sessionStorage.setItem('refreshToken', tokens.refreshToken);
  }

  async loadTokens(): Promise<boolean> {
    const auth = this.authApi();
    if (auth) {
      const legacy = this.migrateLegacyLocalStorageTokens();
      if (legacy) {
        await auth.setSession({
          ...legacy,
          apiBase: this.apiBase(),
        });
      }
      this.accessToken = await auth.getAccessToken();
      if (this.accessToken) return true;
      return auth.hasSession();
    }

    const legacy = this.migrateLegacyLocalStorageTokens();
    if (legacy) {
      this.accessToken = legacy.accessToken;
      sessionStorage.setItem('accessToken', legacy.accessToken);
      sessionStorage.setItem('refreshToken', legacy.refreshToken);
      return true;
    }

    this.accessToken = sessionStorage.getItem('accessToken');
    return !!this.accessToken && !!sessionStorage.getItem('refreshToken');
  }

  async clearTokens() {
    this.accessToken = null;
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    sessionStorage.removeItem('accessToken');
    sessionStorage.removeItem('refreshToken');
    await this.authApi()?.clearSession();
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
    const auth = this.authApi();
    if (auth) {
      const next = await auth.refresh();
      if (!next?.accessToken) {
        this.accessToken = null;
        return false;
      }
      this.accessToken = next.accessToken;
      return true;
    }

    const refreshToken = sessionStorage.getItem('refreshToken');
    if (!refreshToken) {
      this.accessToken = null;
      return false;
    }

    try {
      const res = await fetch(`${this.apiBase()}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        await this.clearTokens();
        return false;
      }
      const data = (await res.json()) as AuthTokens;
      await this.setTokens(data);
      return true;
    } catch {
      return false;
    }
  }

  register(email: string, username: string, displayName: string, password: string) {
    return this.request<{ user: User } & AuthTokens>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, username, displayName, password }),
    });
  }

  login(email: string, password: string) {
    return this.request<{ user: User } & AuthTokens>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
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
