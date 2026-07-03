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
  type: 'direct' | 'channel';
  name: string;
  description?: string;
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
  unreadCount?: number;
  lastMessage?: {
    id: string;
    content: string;
    senderId: string;
    senderName?: string;
    createdAt: string;
    deletedForEveryone?: boolean;
  };
}

export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read';

export interface MessageReaction {
  emoji: string;
  count: number;
  reactedByMe: boolean;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  contentType: string;
  clientMessageId?: string;
  sequence: string;
  createdAt: string;
  editedAt?: string;
  deletedForEveryone?: boolean;
  status?: MessageStatus;
  reactions?: MessageReaction[];
  sender?: { id: string; displayName: string; username: string };
}

class ApiClient {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  setTokens(tokens: AuthTokens) {
    this.accessToken = tokens.accessToken;
    this.refreshToken = tokens.refreshToken;
    localStorage.setItem('accessToken', tokens.accessToken);
    localStorage.setItem('refreshToken', tokens.refreshToken);
  }

  loadTokens() {
    this.accessToken = localStorage.getItem('accessToken');
    this.refreshToken = localStorage.getItem('refreshToken');
    return !!this.accessToken;
  }

  clearTokens() {
    this.accessToken = null;
    this.refreshToken = null;
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
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

    if (res.status === 401 && this.refreshToken) {
      const refreshed = await this.refresh();
      if (refreshed) {
        headers.Authorization = `Bearer ${this.accessToken}`;
        res = await fetch(`${this.apiBase()}${path}`, { ...options, headers });
      }
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message ?? `HTTP ${res.status}`);
    }
    return res.json();
  }

  async refresh(): Promise<boolean> {
    if (!this.refreshToken) return false;
    try {
      const data = await fetch(`${this.apiBase()}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.refreshToken }),
      }).then((r) => r.json());
      this.setTokens(data);
      return true;
    } catch {
      this.clearTokens();
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

  getMessages(conversationId: string, cursor?: string) {
    const qs = cursor ? `?cursor=${cursor}` : '';
    return this.request<{ messages: Message[]; nextCursor: string | null }>(
      `/conversations/${conversationId}/messages${qs}`,
    );
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

    if (res.status === 401 && this.refreshToken) {
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
}

export const api = new ApiClient();
