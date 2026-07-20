import { getApiBase } from '../config/endpoints';
import { extractApiErrorMessage, isSessionAuthFailure } from '../utils/authError';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  sessionId?: string;
}

export interface LoginCaptchaPayload {
  captchaToken?: string;
  captchaAnswer?: string;
}

export interface LoginProtectionStatus {
  captchaRequired: boolean;
  captchaProvider: 'challenge' | 'turnstile';
  threshold: number;
  turnstileSiteKey?: string;
}

export interface AdminUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  isActive: boolean;
  isAdmin: boolean;
  createdAt: string;
  updatedAt: string;
  activeSessionCount?: number;
  messageCount?: number;
  conversationCount?: number;
  lastSeenAt?: string | null;
  recentActivity?: AuditLogEntry[];
}

export interface AdminStats {
  users: {
    total: number;
    active: number;
    inactive: number;
    admins: number;
    newLast7d: number;
  };
  conversations: { total: number; direct: number; channel: number; group: number };
  messages: { total: number; last24h: number; last7d: number };
  sessions: { active: number };
  audit: { last24h: number };
  storage: AdminStorageStats;
  recentActivity: AuditLogEntry[];
}

export interface AdminStorageStats {
  totalBytes: number;
  database: {
    totalBytes: number;
    tables: Array<{ name: string; bytes: number; approxRows: number }>;
  };
  files: {
    totalBytes: number;
    categories: Array<{ id: string; label: string; bytes: number; fileCount: number }>;
  };
  messages: {
    textCount: number;
    attachmentCount: number;
    attachmentBytes: number;
    byKind: Array<{ kind: string; label: string; count: number; bytes: number }>;
  };
}

export interface PaginatedUsers {
  items: AdminUser[];
  total: number;
  page: number;
  limit: number;
}

export interface AdminSession {
  sessionId: string;
  appName: string;
  deviceLabel: string;
  platform: string | null;
  clientType: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastActiveAt: string;
}

export interface AuditLogEntry {
  id: string;
  userId: string | null;
  userEmail: string | null;
  userDisplayName: string | null;
  userUsername: string | null;
  actorUserId: string | null;
  actorEmail: string | null;
  actorDisplayName: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: string;
}

export interface PaginatedAuditLogs {
  items: AuditLogEntry[];
  total: number;
  page: number;
  limit: number;
}

class AdminApiClient {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private refreshPromise: Promise<boolean> | null = null;

  private apiBase() {
    return getApiBase();
  }

  loadTokens() {
    this.accessToken = localStorage.getItem('adminAccessToken');
    this.refreshToken = localStorage.getItem('adminRefreshToken');
    return Boolean(this.accessToken && this.refreshToken);
  }

  setTokens(tokens: AuthTokens) {
    this.accessToken = tokens.accessToken;
    this.refreshToken = tokens.refreshToken;
    localStorage.setItem('adminAccessToken', tokens.accessToken);
    localStorage.setItem('adminRefreshToken', tokens.refreshToken);
  }

  clearTokens() {
    this.accessToken = null;
    this.refreshToken = null;
    localStorage.removeItem('adminAccessToken');
    localStorage.removeItem('adminRefreshToken');
  }

  getAccessToken() {
    return this.accessToken;
  }

  getAttachmentDownloadUrl(attachmentId: string) {
    return this.request<{ url: string; expiresInSeconds: number; expiresAt: string }>(
      `/attachments/${attachmentId}/download`,
    );
  }

  private async fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 10_000) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      window.clearTimeout(timer);
    }
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
    allowRefresh = true,
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };
    if (this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;

    let res: Response;
    try {
      res = await this.fetchWithTimeout(`${this.apiBase()}${path}`, { ...options, headers });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw Object.assign(new Error('Request timed out. Check that the API is running.'), {
          cause: err,
        });
      }
      throw Object.assign(new Error(`Cannot reach server (${this.apiBase()}).`), { cause: err });
    }

    if (res.status === 401 && allowRefresh) {
      const errBody = await res.clone().json().catch(() => ({}));
      const sessionMessage = extractApiErrorMessage(errBody, res.status);
      if (isSessionAuthFailure(sessionMessage)) {
        this.clearTokens();
        const error = new Error(sessionMessage) as Error & { status?: number };
        error.status = 401;
        throw error;
      }

      const refreshed = await this.refresh();
      if (refreshed) {
        headers.Authorization = `Bearer ${this.accessToken}`;
        res = await this.fetchWithTimeout(`${this.apiBase()}${path}`, { ...options, headers });
      }
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const message = extractApiErrorMessage(body, res.status);
      const error = new Error(message) as Error & {
        status?: number;
        body?: Record<string, unknown>;
        code?: string;
      };
      error.status = res.status;
      error.body = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
      if (typeof (body as { code?: unknown }).code === 'string') {
        error.code = (body as { code: string }).code;
      }
      throw error;
    }

    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  async refresh(): Promise<boolean> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.performRefresh().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private async performRefresh(): Promise<boolean> {
    if (!this.refreshToken) return false;
    try {
      const res = await this.fetchWithTimeout(`${this.apiBase()}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refreshToken: this.refreshToken,
          clientInfo: {
            clientType: 'browser',
            platform: 'Web',
            appName: 'ChatApp Admin',
            deviceLabel: 'ChatApp Admin, Web',
            userAgent: navigator.userAgent,
          },
        }),
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) this.clearTokens();
        return false;
      }
      const data = (await res.json()) as AuthTokens;
      this.setTokens(data);
      return true;
    } catch {
      return false;
    }
  }

  login(email: string, password: string, captcha?: LoginCaptchaPayload) {
    return this.request<{ user: unknown } & AuthTokens>(
      '/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({
          email,
          password,
          clientInfo: {
            clientType: 'browser',
            platform: 'Web',
            appName: 'ChatApp Admin',
            deviceLabel: 'ChatApp Admin, Web',
            userAgent: navigator.userAgent,
          },
          ...captcha,
        }),
      },
      false,
    );
  }

  getLoginProtection(identifier?: string) {
    const q = identifier ? `?identifier=${encodeURIComponent(identifier)}` : '';
    return this.request<LoginProtectionStatus>(`/auth/login/protection${q}`, undefined, false);
  }

  createCaptchaChallenge() {
    return this.request<{ captchaToken: string; question: string; expiresIn: number }>(
      '/auth/captcha/challenge',
      { method: 'POST' },
      false,
    );
  }

  me() {
    return this.request<AdminUser>('/admin/me');
  }

  getStats() {
    return this.request<AdminStats>('/admin/stats');
  }

  getStorage() {
    return this.request<AdminStorageStats>('/admin/storage');
  }

  listUsers(params: {
    page?: number;
    limit?: number;
    q?: string;
    isActive?: boolean;
    isAdmin?: boolean;
    sortBy?: 'createdAt' | 'displayName' | 'email' | 'updatedAt';
    sortDir?: 'asc' | 'desc';
  }) {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.q) qs.set('q', params.q);
    if (params.isActive !== undefined) qs.set('isActive', String(params.isActive));
    if (params.isAdmin !== undefined) qs.set('isAdmin', String(params.isAdmin));
    if (params.sortBy) qs.set('sortBy', params.sortBy);
    if (params.sortDir) qs.set('sortDir', params.sortDir);
    const query = qs.toString();
    return this.request<PaginatedUsers>(`/admin/users${query ? `?${query}` : ''}`);
  }

  getUser(userId: string) {
    return this.request<AdminUser>(`/admin/users/${userId}`);
  }

  updateUser(userId: string, data: { isActive?: boolean; isAdmin?: boolean }) {
    return this.request<AdminUser>(`/admin/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  listUserSessions(userId: string) {
    return this.request<AdminSession[]>(`/admin/users/${userId}/sessions`);
  }

  revokeSession(userId: string, sessionId: string) {
    return this.request<{ success: boolean }>(
      `/admin/users/${userId}/sessions/${sessionId}`,
      { method: 'DELETE' },
    );
  }

  revokeAllSessions(userId: string) {
    return this.request<{ success: boolean; revoked: number }>(
      `/admin/users/${userId}/sessions`,
      { method: 'DELETE' },
    );
  }

  listAuditLogs(params: {
    page?: number;
    limit?: number;
    userId?: string;
    action?: string;
    category?: string;
    from?: string;
    to?: string;
    q?: string;
  }) {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.userId) qs.set('userId', params.userId);
    if (params.action) qs.set('action', params.action);
    if (params.category) qs.set('category', params.category);
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    if (params.q) qs.set('q', params.q);
    const query = qs.toString();
    return this.request<PaginatedAuditLogs>(`/admin/audit-logs${query ? `?${query}` : ''}`);
  }

  getAuthSettings() {
    return this.request<DirectoryAuthSettings>('/admin/settings/authentication');
  }

  updateAuthSettings(data: Partial<DirectoryAuthSettingsUpdate>) {
    return this.request<DirectoryAuthSettings>('/admin/settings/authentication', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  getDirectoryHealth() {
    return this.request<DirectoryHealth>('/admin/settings/authentication/health');
  }

  getAuthStatistics() {
    return this.request<AuthStatistics>('/admin/settings/authentication/statistics');
  }

  testDirectoryConnection() {
    return this.request<{ ok: boolean; message: string }>(
      '/admin/settings/authentication/test-connection',
      { method: 'POST', body: '{}' },
    );
  }

  previewDirectoryUsers(limit = 25) {
    return this.request<DirectoryPreviewUser[]>(
      `/admin/settings/authentication/preview/users?limit=${limit}`,
    );
  }

  previewDirectoryGroups(limit = 50) {
    return this.request<DirectoryPreviewGroup[]>(
      `/admin/settings/authentication/preview/groups?limit=${limit}`,
    );
  }

  runDirectorySync() {
    return this.request<Record<string, unknown>>('/admin/settings/authentication/sync', {
      method: 'POST',
      body: '{}',
    });
  }

  listDirectorySyncHistory(page = 1, limit = 20) {
    return this.request<PaginatedSyncHistory>(
      `/admin/settings/authentication/sync/history?page=${page}&limit=${limit}`,
    );
  }

  listAuthAuditLogs(params: {
    page?: number;
    limit?: number;
    provider?: string;
    success?: boolean;
  }) {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.provider) qs.set('provider', params.provider);
    if (params.success !== undefined) qs.set('success', String(params.success));
    return this.request<PaginatedAuthAudit>(
      `/admin/settings/authentication/audit?${qs.toString()}`,
    );
  }

  listGroupMappings() {
    return this.request<DirectoryGroupMapping[]>('/admin/settings/authentication/group-mappings');
  }

  createGroupMapping(data: Partial<DirectoryGroupMapping> & { adGroupDn: string; adGroupName: string }) {
    return this.request<DirectoryGroupMapping>('/admin/settings/authentication/group-mappings', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  updateGroupMapping(id: string, data: Partial<DirectoryGroupMapping>) {
    return this.request<DirectoryGroupMapping>(
      `/admin/settings/authentication/group-mappings/${id}`,
      { method: 'PATCH', body: JSON.stringify(data) },
    );
  }

  deleteGroupMapping(id: string) {
    return this.request<{ success: boolean }>(
      `/admin/settings/authentication/group-mappings/${id}`,
      { method: 'DELETE' },
    );
  }
}

export interface DirectoryAuthSettings {
  localLoginEnabled: boolean;
  activeDirectoryLoginEnabled: boolean;
  defaultProvider: 'local' | 'active_directory';
  allowLocalFallback: boolean;
  autoCreateUsers: boolean;
  autoSyncProfile: boolean;
  autoSyncDepartment: boolean;
  autoSyncDisplayName: boolean;
  autoSyncEmail: boolean;
  autoSyncGroupMembership: boolean;
  requireAccountEnabled: boolean;
  rejectLockedAccounts: boolean;
  rejectExpiredPasswords: boolean;
  rejectExpiredAccounts: boolean;
  requireApprovedGroup: boolean;
  ldapHost: string | null;
  ldapPort: number;
  tlsMode: 'none' | 'ldaps' | 'starttls';
  validateTlsCertificate: boolean;
  domainName: string | null;
  baseDn: string | null;
  bindDn: string | null;
  bindPasswordSet: boolean;
  userSearchBase: string | null;
  groupSearchBase: string | null;
  userFilter: string;
  groupFilter: string;
  connectionTimeoutMs: number;
  readTimeoutMs: number;
  syncInterval: 'manual' | 'hourly' | 'daily' | 'weekly';
  lastConnectionTestAt: string | null;
  lastConnectionTestOk: boolean | null;
  lastConnectionTestMessage: string | null;
  healthStatus: string;
  updatedAt: string;
}

export type DirectoryAuthSettingsUpdate = Omit<
  DirectoryAuthSettings,
  | 'bindPasswordSet'
  | 'lastConnectionTestAt'
  | 'lastConnectionTestOk'
  | 'lastConnectionTestMessage'
  | 'healthStatus'
  | 'updatedAt'
> & { bindPassword?: string | null };

export interface DirectoryHealth {
  healthStatus: string;
  activeDirectoryLoginEnabled: boolean;
  localLoginEnabled: boolean;
  lastConnectionTestAt: string | null;
  lastConnectionTestOk: boolean | null;
  lastConnectionTestMessage: string | null;
  ldapHostConfigured: boolean;
  bindPasswordSet: boolean;
  syncInterval: string;
}

export interface AuthStatistics {
  last24h: {
    localSuccess: number;
    localFailed: number;
    adSuccess: number;
    adFailed: number;
  };
}

export interface DirectoryPreviewUser {
  dn: string;
  username: string;
  displayName: string;
  email: string;
  department?: string;
  enabled: boolean;
}

export interface DirectoryPreviewGroup {
  dn: string;
  name: string;
  description?: string;
}

export interface DirectoryGroupMapping {
  id: string;
  adGroupDn: string;
  adGroupName: string;
  chatRole: 'system_admin' | 'none';
  allowLogin: boolean;
  isApprovedSecurityGroup: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedSyncHistory {
  items: Array<{
    id: string;
    triggeredBy: string;
    status: string;
    usersExamined: number;
    usersUpdated: number;
    usersCreated: number;
    usersDisabled: number;
    errorMessage: string | null;
    startedAt: string;
    finishedAt: string | null;
  }>;
  total: number;
  page: number;
  limit: number;
}

export interface PaginatedAuthAudit {
  items: Array<{
    id: string;
    provider: string;
    eventType: string;
    success: boolean;
    username: string | null;
    message: string | null;
    createdAt: string;
  }>;
  total: number;
  page: number;
  limit: number;
}

export const api = new AdminApiClient();
