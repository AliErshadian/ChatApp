import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  api,
  AuthStatistics,
  DirectoryAuthSettings,
  DirectoryGroupMapping,
  DirectoryHealth,
  DirectoryPreviewGroup,
  DirectoryPreviewUser,
  PaginatedAuthAudit,
  PaginatedSyncHistory,
} from '../services/api';
import { formatRelative } from '../utils/format';

type Tab = 'providers' | 'ldap' | 'groups' | 'sync' | 'audit';

export function AuthenticationSettingsPage() {
  const [tab, setTab] = useState<Tab>('providers');
  const [settings, setSettings] = useState<DirectoryAuthSettings | null>(null);
  const [health, setHealth] = useState<DirectoryHealth | null>(null);
  const [stats, setStats] = useState<AuthStatistics | null>(null);
  const [bindPassword, setBindPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [previewUsers, setPreviewUsers] = useState<DirectoryPreviewUser[]>([]);
  const [previewGroups, setPreviewGroups] = useState<DirectoryPreviewGroup[]>([]);
  const [mappings, setMappings] = useState<DirectoryGroupMapping[]>([]);
  const [syncHistory, setSyncHistory] = useState<PaginatedSyncHistory | null>(null);
  const [authAudit, setAuthAudit] = useState<PaginatedAuthAudit | null>(null);

  const [newMapping, setNewMapping] = useState({
    adGroupDn: '',
    adGroupName: '',
    chatRole: 'none' as 'system_admin' | 'none',
    allowLogin: true,
    isApprovedSecurityGroup: false,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [s, h, st] = await Promise.all([
        api.getAuthSettings(),
        api.getDirectoryHealth(),
        api.getAuthStatistics(),
      ]);
      setSettings(s);
      setHealth(h);
      setStats(st);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (tab === 'groups') {
      void api.listGroupMappings().then(setMappings).catch(() => setMappings([]));
    }
    if (tab === 'sync') {
      void api
        .listDirectorySyncHistory()
        .then(setSyncHistory)
        .catch(() => setSyncHistory(null));
    }
    if (tab === 'audit') {
      void api
        .listAuthAuditLogs({ limit: 50 })
        .then(setAuthAudit)
        .catch(() => setAuthAudit(null));
    }
  }, [tab]);

  const updateField = <K extends keyof DirectoryAuthSettings>(
    key: K,
    value: DirectoryAuthSettings[K],
  ) => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!settings) return;
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const payload: Record<string, unknown> = {
        localLoginEnabled: settings.localLoginEnabled,
        activeDirectoryLoginEnabled: settings.activeDirectoryLoginEnabled,
        defaultProvider: settings.defaultProvider,
        allowLocalFallback: settings.allowLocalFallback,
        autoCreateUsers: settings.autoCreateUsers,
        autoSyncProfile: settings.autoSyncProfile,
        autoSyncDepartment: settings.autoSyncDepartment,
        autoSyncDisplayName: settings.autoSyncDisplayName,
        autoSyncEmail: settings.autoSyncEmail,
        autoSyncGroupMembership: settings.autoSyncGroupMembership,
        requireAccountEnabled: settings.requireAccountEnabled,
        rejectLockedAccounts: settings.rejectLockedAccounts,
        rejectExpiredPasswords: settings.rejectExpiredPasswords,
        rejectExpiredAccounts: settings.rejectExpiredAccounts,
        requireApprovedGroup: settings.requireApprovedGroup,
        ldapHost: settings.ldapHost,
        ldapPort: settings.ldapPort,
        tlsMode: settings.tlsMode,
        validateTlsCertificate: settings.validateTlsCertificate,
        domainName: settings.domainName,
        baseDn: settings.baseDn,
        bindDn: settings.bindDn,
        userSearchBase: settings.userSearchBase,
        groupSearchBase: settings.groupSearchBase,
        userFilter: settings.userFilter,
        groupFilter: settings.groupFilter,
        connectionTimeoutMs: settings.connectionTimeoutMs,
        readTimeoutMs: settings.readTimeoutMs,
        syncInterval: settings.syncInterval,
      };
      if (bindPassword.trim()) payload.bindPassword = bindPassword.trim();
      const updated = await api.updateAuthSettings(payload);
      setSettings(updated);
      setBindPassword('');
      setMessage('Settings saved. Changes apply immediately — no restart required.');
      const h = await api.getDirectoryHealth();
      setHealth(h);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setMessage('');
    setError('');
    try {
      const result = await api.testDirectoryConnection();
      setMessage(result.ok ? result.message : `Connection failed: ${result.message}`);
      if (!result.ok) setError(result.message);
      const h = await api.getDirectoryHealth();
      setHealth(h);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection test failed');
    }
  };

  const runPreviewUsers = async () => {
    try {
      setPreviewUsers(await api.previewDirectoryUsers());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    }
  };

  const runPreviewGroups = async () => {
    try {
      setPreviewGroups(await api.previewDirectoryGroups());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    }
  };

  const runSync = async () => {
    setMessage('');
    try {
      const result = await api.runDirectorySync();
      setMessage(`Sync ${String(result.status ?? 'started')}`);
      setSyncHistory(await api.listDirectorySyncHistory());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    }
  };

  const createMapping = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.createGroupMapping(newMapping);
      setNewMapping({
        adGroupDn: '',
        adGroupName: '',
        chatRole: 'none',
        allowLogin: true,
        isApprovedSecurityGroup: false,
      });
      setMappings(await api.listGroupMappings());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create mapping');
    }
  };

  if (loading) return <div className="page-loading-inline">Loading authentication settings…</div>;
  if (!settings) return <div className="page-error">{error || 'Settings unavailable'}</div>;

  return (
    <div className="page page-compact auth-settings-page">
      <header className="page-header-row">
        <div>
          <p className="page-eyebrow">Settings</p>
          <h2 className="page-title">Authentication</h2>
          <p className="page-subtitle">
            Configure local and Active Directory login. Changes take effect without restarting the
            server.
          </p>
        </div>
        <div className="auth-health-pill" data-status={health?.healthStatus ?? 'unknown'}>
          <span className="auth-health-dot" />
          Directory: {health?.healthStatus ?? 'unknown'}
        </div>
      </header>

      {stats && (
        <section className="stat-grid stat-grid-compact">
          <article className="stat-card stat-card-compact">
            <span className="stat-label">Local OK (24h)</span>
            <strong className="stat-value">{stats.last24h.localSuccess}</strong>
          </article>
          <article className="stat-card stat-card-compact">
            <span className="stat-label">Local failed (24h)</span>
            <strong className="stat-value">{stats.last24h.localFailed}</strong>
          </article>
          <article className="stat-card stat-card-compact">
            <span className="stat-label">AD OK (24h)</span>
            <strong className="stat-value">{stats.last24h.adSuccess}</strong>
          </article>
          <article className="stat-card stat-card-compact">
            <span className="stat-label">AD failed (24h)</span>
            <strong className="stat-value">{stats.last24h.adFailed}</strong>
          </article>
        </section>
      )}

      <div className="auth-tabs" role="tablist">
        {(
          [
            ['providers', 'Providers'],
            ['ldap', 'LDAP / AD'],
            ['groups', 'Group mapping'],
            ['sync', 'Synchronization'],
            ['audit', 'Failed logins'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            className={tab === id ? 'auth-tab active' : 'auth-tab'}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {message && <p className="success-banner">{message}</p>}
      {error && <p className="error-banner">{error}</p>}

      {tab === 'providers' && (
        <form className="auth-settings-form" onSubmit={save}>
          <section className="settings-section">
            <h3>Login providers</h3>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={settings.localLoginEnabled}
                onChange={(e) => updateField('localLoginEnabled', e.target.checked)}
              />
              <span>Enable Local Login</span>
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={settings.activeDirectoryLoginEnabled}
                onChange={(e) => updateField('activeDirectoryLoginEnabled', e.target.checked)}
              />
              <span>Enable Active Directory Login</span>
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={settings.allowLocalFallback}
                onChange={(e) => updateField('allowLocalFallback', e.target.checked)}
              />
              <span>Allow fallback to Local Login after AD failure</span>
            </label>
            <label className="field">
              <span>Default Authentication Provider</span>
              <select
                value={settings.defaultProvider}
                onChange={(e) =>
                  updateField(
                    'defaultProvider',
                    e.target.value as DirectoryAuthSettings['defaultProvider'],
                  )
                }
              >
                <option value="local">Local</option>
                <option value="active_directory">Active Directory</option>
              </select>
            </label>
          </section>

          <section className="settings-section">
            <h3>Provisioning &amp; sync</h3>
            {(
              [
                ['autoCreateUsers', 'Auto-create local users after successful AD login'],
                ['autoSyncProfile', 'Auto-sync user profile'],
                ['autoSyncDepartment', 'Auto-sync department'],
                ['autoSyncDisplayName', 'Auto-sync display name'],
                ['autoSyncEmail', 'Auto-sync email'],
                ['autoSyncGroupMembership', 'Auto-sync group membership'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="toggle-row">
                <input
                  type="checkbox"
                  checked={settings[key]}
                  onChange={(e) => updateField(key, e.target.checked)}
                />
                <span>{label}</span>
              </label>
            ))}
          </section>

          <section className="settings-section">
            <h3>Account policy</h3>
            {(
              [
                ['requireAccountEnabled', 'Require AD account to be enabled'],
                ['rejectLockedAccounts', 'Reject locked AD accounts'],
                ['rejectExpiredPasswords', 'Reject expired passwords'],
                ['rejectExpiredAccounts', 'Reject expired accounts'],
                ['requireApprovedGroup', 'Require membership in an approved security group'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="toggle-row">
                <input
                  type="checkbox"
                  checked={settings[key]}
                  onChange={(e) => updateField(key, e.target.checked)}
                />
                <span>{label}</span>
              </label>
            ))}
          </section>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </form>
      )}

      {tab === 'ldap' && (
        <form className="auth-settings-form" onSubmit={save}>
          <section className="settings-section">
            <h3>LDAP connection</h3>
            <div className="form-grid">
              <label className="field">
                <span>LDAP Server Address</span>
                <input
                  value={settings.ldapHost ?? ''}
                  onChange={(e) => updateField('ldapHost', e.target.value || null)}
                  placeholder="dc01.corp.local"
                />
              </label>
              <label className="field">
                <span>LDAP Port</span>
                <input
                  type="number"
                  value={settings.ldapPort}
                  onChange={(e) => updateField('ldapPort', parseInt(e.target.value, 10) || 389)}
                />
              </label>
              <label className="field">
                <span>SSL / TLS</span>
                <select
                  value={settings.tlsMode}
                  onChange={(e) =>
                    updateField('tlsMode', e.target.value as DirectoryAuthSettings['tlsMode'])
                  }
                >
                  <option value="none">None</option>
                  <option value="ldaps">LDAPS</option>
                  <option value="starttls">StartTLS</option>
                </select>
              </label>
              <label className="toggle-row field-inline">
                <input
                  type="checkbox"
                  checked={settings.validateTlsCertificate}
                  onChange={(e) => updateField('validateTlsCertificate', e.target.checked)}
                />
                <span>Validate TLS certificates</span>
              </label>
              <label className="field">
                <span>Domain Name</span>
                <input
                  value={settings.domainName ?? ''}
                  onChange={(e) => updateField('domainName', e.target.value || null)}
                  placeholder="CORP"
                />
              </label>
              <label className="field">
                <span>Base DN</span>
                <input
                  value={settings.baseDn ?? ''}
                  onChange={(e) => updateField('baseDn', e.target.value || null)}
                  placeholder="DC=corp,DC=local"
                />
              </label>
              <label className="field">
                <span>Bind DN</span>
                <input
                  value={settings.bindDn ?? ''}
                  onChange={(e) => updateField('bindDn', e.target.value || null)}
                  placeholder="CN=svc-chat,OU=Service,DC=corp,DC=local"
                />
              </label>
              <label className="field">
                <span>
                  Bind Password{settings.bindPasswordSet ? ' (set — leave blank to keep)' : ''}
                </span>
                <input
                  type="password"
                  value={bindPassword}
                  onChange={(e) => setBindPassword(e.target.value)}
                  placeholder={settings.bindPasswordSet ? '••••••••' : 'Enter bind password'}
                  autoComplete="new-password"
                />
              </label>
              <label className="field">
                <span>User Search Base</span>
                <input
                  value={settings.userSearchBase ?? ''}
                  onChange={(e) => updateField('userSearchBase', e.target.value || null)}
                />
              </label>
              <label className="field">
                <span>Group Search Base</span>
                <input
                  value={settings.groupSearchBase ?? ''}
                  onChange={(e) => updateField('groupSearchBase', e.target.value || null)}
                />
              </label>
              <label className="field field-span-2">
                <span>User Filter</span>
                <input
                  value={settings.userFilter}
                  onChange={(e) => updateField('userFilter', e.target.value)}
                />
              </label>
              <label className="field field-span-2">
                <span>Group Filter</span>
                <input
                  value={settings.groupFilter}
                  onChange={(e) => updateField('groupFilter', e.target.value)}
                />
              </label>
              <label className="field">
                <span>Connection Timeout (ms)</span>
                <input
                  type="number"
                  value={settings.connectionTimeoutMs}
                  onChange={(e) =>
                    updateField('connectionTimeoutMs', parseInt(e.target.value, 10) || 5000)
                  }
                />
              </label>
              <label className="field">
                <span>Read Timeout (ms)</span>
                <input
                  type="number"
                  value={settings.readTimeoutMs}
                  onChange={(e) =>
                    updateField('readTimeoutMs', parseInt(e.target.value, 10) || 10000)
                  }
                />
              </label>
            </div>
          </section>

          <div className="form-actions form-actions-wrap">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save LDAP settings'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => void testConnection()}>
              Test Connection
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => void runPreviewUsers()}>
              Preview Users
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => void runPreviewGroups()}>
              Preview Groups
            </button>
          </div>

          {previewUsers.length > 0 && (
            <section className="settings-section">
              <h3>Preview users</h3>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Username</th>
                      <th>Display name</th>
                      <th>Email</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewUsers.map((u) => (
                      <tr key={u.dn}>
                        <td>{u.username}</td>
                        <td>{u.displayName}</td>
                        <td>{u.email}</td>
                        <td>{u.enabled ? 'Enabled' : 'Disabled'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {previewGroups.length > 0 && (
            <section className="settings-section">
              <h3>Preview groups</h3>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>DN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewGroups.map((g) => (
                      <tr key={g.dn}>
                        <td>{g.name}</td>
                        <td className="mono-cell">{g.dn}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </form>
      )}

      {tab === 'groups' && (
        <div className="auth-settings-form">
          <section className="settings-section">
            <h3>Map AD groups to Chat roles</h3>
            <form className="form-grid" onSubmit={createMapping}>
              <label className="field field-span-2">
                <span>AD Group DN</span>
                <input
                  required
                  value={newMapping.adGroupDn}
                  onChange={(e) => setNewMapping((p) => ({ ...p, adGroupDn: e.target.value }))}
                  placeholder="CN=Domain Admins,CN=Users,DC=corp,DC=local"
                />
              </label>
              <label className="field">
                <span>Group name</span>
                <input
                  required
                  value={newMapping.adGroupName}
                  onChange={(e) => setNewMapping((p) => ({ ...p, adGroupName: e.target.value }))}
                />
              </label>
              <label className="field">
                <span>Chat role</span>
                <select
                  value={newMapping.chatRole}
                  onChange={(e) =>
                    setNewMapping((p) => ({
                      ...p,
                      chatRole: e.target.value as 'system_admin' | 'none',
                    }))
                  }
                >
                  <option value="none">None</option>
                  <option value="system_admin">System Administrator</option>
                </select>
              </label>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={newMapping.allowLogin}
                  onChange={(e) => setNewMapping((p) => ({ ...p, allowLogin: e.target.checked }))}
                />
                <span>Allow login</span>
              </label>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={newMapping.isApprovedSecurityGroup}
                  onChange={(e) =>
                    setNewMapping((p) => ({ ...p, isApprovedSecurityGroup: e.target.checked }))
                  }
                />
                <span>Approved security group</span>
              </label>
              <div className="form-actions field-span-2">
                <button type="submit" className="btn btn-primary">
                  Add mapping
                </button>
              </div>
            </form>
          </section>

          <section className="settings-section">
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Group</th>
                    <th>Role</th>
                    <th>Login</th>
                    <th>Approved</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {mappings.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <strong>{m.adGroupName}</strong>
                        <div className="mono-cell muted">{m.adGroupDn}</div>
                      </td>
                      <td>{m.chatRole === 'system_admin' ? 'System Admin' : '—'}</td>
                      <td>{m.allowLogin ? 'Yes' : 'No'}</td>
                      <td>{m.isApprovedSecurityGroup ? 'Yes' : 'No'}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() =>
                            void api.deleteGroupMapping(m.id).then(() =>
                              api.listGroupMappings().then(setMappings),
                            )
                          }
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                  {mappings.length === 0 && (
                    <tr>
                      <td colSpan={5} className="empty-cell">
                        No group mappings yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {tab === 'sync' && (
        <div className="auth-settings-form">
          <section className="settings-section">
            <h3>Synchronization</h3>
            <label className="field">
              <span>Synchronization Interval</span>
              <select
                value={settings.syncInterval}
                onChange={(e) =>
                  updateField(
                    'syncInterval',
                    e.target.value as DirectoryAuthSettings['syncInterval'],
                  )
                }
              >
                <option value="manual">Manual</option>
                <option value="hourly">Every hour</option>
                <option value="daily">Every day</option>
                <option value="weekly">Every week</option>
              </select>
            </label>
            <div className="form-actions form-actions-wrap">
              <button type="button" className="btn btn-primary" onClick={() => void save()}>
                Save interval
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => void runSync()}>
                Manual Sync
              </button>
            </div>
          </section>

          <section className="settings-section">
            <h3>Synchronization history</h3>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Started</th>
                    <th>Trigger</th>
                    <th>Status</th>
                    <th>Examined</th>
                    <th>Updated</th>
                    <th>Disabled</th>
                  </tr>
                </thead>
                <tbody>
                  {syncHistory?.items.map((h) => (
                    <tr key={h.id}>
                      <td title={h.startedAt}>{formatRelative(h.startedAt)}</td>
                      <td>{h.triggeredBy}</td>
                      <td>{h.status}</td>
                      <td>{h.usersExamined}</td>
                      <td>{h.usersUpdated}</td>
                      <td>{h.usersDisabled}</td>
                    </tr>
                  ))}
                  {!syncHistory?.items.length && (
                    <tr>
                      <td colSpan={6} className="empty-cell">
                        No sync runs yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {tab === 'audit' && (
        <section className="settings-section">
          <h3>Authentication audit (recent)</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Provider</th>
                  <th>Event</th>
                  <th>User</th>
                  <th>Result</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {authAudit?.items.map((row) => (
                  <tr key={row.id}>
                    <td>{formatRelative(row.createdAt)}</td>
                    <td>{row.provider}</td>
                    <td>{row.eventType}</td>
                    <td>{row.username ?? '—'}</td>
                    <td>{row.success ? 'OK' : 'Failed'}</td>
                    <td>{row.message ?? '—'}</td>
                  </tr>
                ))}
                {!authAudit?.items.length && (
                  <tr>
                    <td colSpan={6} className="empty-cell">
                      No authentication events yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
