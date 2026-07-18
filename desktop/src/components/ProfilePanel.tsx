import { useEffect, useRef, useState } from 'react';
import { api, User } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { ConfirmModal } from './ConfirmModal';
import { SessionsPanel } from './SessionsPanel';
import { CacheManagementPanel } from './CacheManagementPanel';
import { SkeletonProfile } from './Skeleton';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { getLogoutConfirm } from '../utils/deleteChatConfirm';
import {
  getInAppAlertsEnabled,
  setInAppAlertsEnabled,
} from '../utils/notificationPrefs';
import {
  faArrowLeft,
  faCamera,
  faMoon,
  faRightFromBracket,
  faSun,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';

interface Props {
  onClose: () => void;
  isMobile?: boolean;
}

function formatDate(value?: string) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function ProfilePanel({ onClose, isMobile = false }: Props) {
  const { user: authUser, logout, updateUser } = useAuth();
  const { theme, setTheme } = useTheme();
  const [profile, setProfile] = useState<User | null>(authUser);
  const [loading, setLoading] = useState(!authUser);
  const [uploading, setUploading] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState(authUser?.displayName ?? '');
  const [inAppAlerts, setInAppAlerts] = useState(getInAppAlertsEnabled);
  const [error, setError] = useState('');
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logoutConfirm = getLogoutConfirm();

  useEffect(() => {
    if (authUser) {
      setProfile(authUser);
      setDisplayNameDraft(authUser.displayName);
      setLoading(false);
      void api
        .me()
        .then((user) => {
          setProfile(user);
          setDisplayNameDraft(user.displayName);
        })
        .catch(() => {
          // Keep cached profile from auth context on transient failures.
        });
      return;
    }

    setLoading(true);
    setError('');
    api.me()
      .then((user) => {
        setProfile(user);
        setDisplayNameDraft(user.displayName);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load settings'))
      .finally(() => setLoading(false));
  }, [authUser]);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setUploading(true);
    setError('');
    try {
      const updated = await api.uploadAvatar(file);
      setProfile(updated);
      updateUser(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload photo');
    } finally {
      setUploading(false);
    }
  };

  const handleSaveDisplayName = async () => {
    if (!profile) return;
    const next = displayNameDraft.trim();
    if (next.length < 2) {
      setError('Display name must be at least 2 characters');
      return;
    }
    if (next === profile.displayName) return;

    setSavingName(true);
    setError('');
    try {
      const updated = await api.updateMe({ displayName: next });
      setProfile(updated);
      setDisplayNameDraft(updated.displayName);
      updateUser(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update display name');
    } finally {
      setSavingName(false);
    }
  };

  const handleInAppAlertsChange = (enabled: boolean) => {
    setInAppAlerts(enabled);
    setInAppAlertsEnabled(enabled);
  };

  const closeLabel = isMobile ? 'Back to conversations' : 'Close settings';
  const closeIcon = isMobile ? <Icon icon={faArrowLeft} /> : <Icon icon={faXmark} />;
  const nameDirty = Boolean(profile && displayNameDraft.trim() !== profile.displayName);

  if (!profile && loading) {
    return (
      <div className="profile-panel">
        <header className="profile-header">
          <button className="icon-btn close-chat-btn" onClick={onClose} aria-label={closeLabel} title={closeLabel}>{closeIcon}</button>
          <h3>Settings</h3>
        </header>
        <SkeletonProfile />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="profile-panel">
        <header className="profile-header">
          <button className="icon-btn close-chat-btn" onClick={onClose} aria-label={closeLabel} title={closeLabel}>{closeIcon}</button>
          <h3>Settings</h3>
        </header>
        <div className="profile-error">{error || 'Settings unavailable'}</div>
      </div>
    );
  }

  return (
    <div className="profile-panel">
      <header className="profile-header">
        <button className="icon-btn close-chat-btn" onClick={onClose} aria-label={closeLabel} title={closeLabel}>{closeIcon}</button>
        <h3>Settings</h3>
      </header>

      <div className="profile-content">
        <div className="profile-hero">
          <div className="profile-avatar-stage">
            <Avatar name={profile.displayName} avatarUrl={profile.avatarUrl} size="lg" />
            <button
              type="button"
              className="profile-avatar-edit"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              aria-label={uploading ? 'Uploading photo' : 'Change photo'}
              title={uploading ? 'Uploading…' : 'Change photo'}
            >
              <Icon icon={faCamera} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="avatar-file-input"
              onChange={handleAvatarChange}
            />
          </div>
          <h2>{profile.displayName}</h2>
          <p className="profile-username">@{profile.username}</p>
          {error && <p className="profile-error-inline">{error}</p>}
        </div>

        <section className="profile-section">
          <h4>Appearance</h4>
          <div className="profile-pref-card">
            <div className="theme-toggle" role="group" aria-label="Color theme">
              <button
                type="button"
                className={`theme-toggle-btn${theme === 'dark' ? ' active' : ''}`}
                onClick={() => setTheme('dark')}
                aria-pressed={theme === 'dark'}
              >
                <Icon icon={faMoon} />
                <span>Dark</span>
              </button>
              <button
                type="button"
                className={`theme-toggle-btn${theme === 'light' ? ' active' : ''}`}
                onClick={() => setTheme('light')}
                aria-pressed={theme === 'light'}
              >
                <Icon icon={faSun} />
                <span>Light</span>
              </button>
            </div>
          </div>
        </section>

        <section className="profile-section">
          <h4>Notifications</h4>
          <div className="profile-pref-card profile-pref-row">
            <div>
              <p className="profile-pref-title">Show in-app alerts</p>
              <p className="profile-pref-desc">Mentions, new chats, and session notices</p>
            </div>
            <button
              type="button"
              className={`pref-switch${inAppAlerts ? ' on' : ''}`}
              role="switch"
              aria-checked={inAppAlerts}
              onClick={() => handleInAppAlertsChange(!inAppAlerts)}
            >
              <span className="pref-switch-thumb" />
            </button>
          </div>
        </section>

        <section className="profile-section">
          <h4>Account</h4>
          <div className="profile-pref-card profile-account-edit">
            <Input
              label="Display name"
              value={displayNameDraft}
              onChange={(e) => setDisplayNameDraft(e.target.value)}
              maxLength={128}
              disabled={savingName}
            />
            {nameDirty && (
              <Button
                variant="primary"
                onClick={() => void handleSaveDisplayName()}
                disabled={savingName || displayNameDraft.trim().length < 2}
              >
                {savingName ? 'Saving…' : 'Save name'}
              </Button>
            )}
          </div>
          <dl className="profile-list">
            <div className="profile-list-row">
              <dt>Email</dt>
              <dd>{profile.email}</dd>
            </div>
            <div className="profile-list-row">
              <dt>Username</dt>
              <dd>@{profile.username}</dd>
            </div>
            <div className="profile-list-row">
              <dt>Member since</dt>
              <dd>{formatDate(profile.createdAt)}</dd>
            </div>
            <div className="profile-list-row profile-list-row--mono">
              <dt>User ID</dt>
              <dd className="profile-mono">{profile.id}</dd>
            </div>
          </dl>
        </section>

        <section className="profile-section">
          <h4>Devices</h4>
          <SessionsPanel />
        </section>

        <CacheManagementPanel />

        <div className="profile-actions">
          <button className="profile-logout-btn" onClick={() => setLogoutConfirmOpen(true)}>
            <Icon icon={faRightFromBracket} />
            <span>Sign out</span>
          </button>
        </div>
      </div>

      <ConfirmModal
        open={logoutConfirmOpen}
        title={logoutConfirm.title}
        message={logoutConfirm.message}
        confirmLabel={logoutConfirm.confirmLabel}
        danger={logoutConfirm.danger}
        onConfirm={() => {
          setLogoutConfirmOpen(false);
          logout();
        }}
        onCancel={() => setLogoutConfirmOpen(false)}
      />
    </div>
  );
}
