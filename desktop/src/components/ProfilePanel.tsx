import { useEffect, useRef, useState } from 'react';
import { api, User } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Avatar } from './Avatar';
import { ConfirmModal } from './ConfirmModal';
import { SessionsPanel } from './SessionsPanel';
import { CacheManagementPanel } from './CacheManagementPanel';
import { getLogoutConfirm } from '../utils/deleteChatConfirm';

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
  const [profile, setProfile] = useState<User | null>(authUser);
  const [loading, setLoading] = useState(!authUser);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logoutConfirm = getLogoutConfirm();

  useEffect(() => {
    if (authUser) {
      setProfile(authUser);
      setLoading(false);
      void api
        .me()
        .then(setProfile)
        .catch(() => {
          // Keep cached profile from auth context on transient failures.
        });
      return;
    }

    setLoading(true);
    setError('');
    api.me()
      .then(setProfile)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load profile'))
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

  const closeLabel = isMobile ? 'Back to conversations' : 'Close profile';
  const closeIcon = isMobile ? '←' : '✕';

  if (!profile && loading) {
    return (
      <div className="profile-panel">
        <header className="profile-header">
          <button className="icon-btn close-chat-btn" onClick={onClose} aria-label={closeLabel} title={closeLabel}>{closeIcon}</button>
          <h3>My Profile</h3>
        </header>
        <div className="profile-loading">Loading profile...</div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="profile-panel">
        <header className="profile-header">
          <button className="icon-btn close-chat-btn" onClick={onClose} aria-label={closeLabel} title={closeLabel}>{closeIcon}</button>
          <h3>My Profile</h3>
        </header>
        <div className="profile-error">{error || 'Profile unavailable'}</div>
      </div>
    );
  }

  return (
    <div className="profile-panel">
      <header className="profile-header">
        <button className="icon-btn close-chat-btn" onClick={onClose} aria-label={closeLabel} title={closeLabel}>{closeIcon}</button>
        <h3>My Profile</h3>
      </header>

      <div className="profile-content">
        <div className="profile-hero">
          <div className="profile-avatar-wrap">
            <Avatar name={profile.displayName} avatarUrl={profile.avatarUrl} size="lg" />
            <button
              type="button"
              className="avatar-upload-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? 'Uploading...' : 'Change photo'}
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
          <h4>Account Details</h4>
          <dl className="profile-details">
            <div className="profile-detail-row">
              <dt>Email</dt>
              <dd>{profile.email}</dd>
            </div>
            <div className="profile-detail-row">
              <dt>Username</dt>
              <dd>@{profile.username}</dd>
            </div>
            <div className="profile-detail-row">
              <dt>Display Name</dt>
              <dd>{profile.displayName}</dd>
            </div>
            <div className="profile-detail-row">
              <dt>User ID</dt>
              <dd className="profile-mono">{profile.id}</dd>
            </div>
            <div className="profile-detail-row">
              <dt>Member Since</dt>
              <dd>{formatDate(profile.createdAt)}</dd>
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
            Sign Out
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
