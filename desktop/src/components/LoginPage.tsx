import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { api } from '../services/api';
import { formatAuthError } from '../utils/authError';
import { Icon } from './Icon';
import { faMoon, faSun } from '@fortawesome/free-solid-svg-icons';

export function LoginPage() {
  const { login, register } = useAuth();
  const { theme, setTheme } = useTheme();
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [inviteChannelName, setInviteChannelName] = useState<string | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    const token = sessionStorage.getItem('pendingInviteToken');
    if (!token) return;

    api
      .getInvitePreview(token)
      .then((preview) => setInviteChannelName(preview.channelName))
      .catch(() => setInviteChannelName(null));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const mode = isRegister ? 'register' : 'login';
    try {
      if (isRegister) {
        await register(email, username, displayName, password);
      } else {
        await login(email, password);
      }
    } catch (err) {
      setError(formatAuthError(err, mode));
    } finally {
      setLoading(false);
    }
  };

  const setMode = (nextRegister: boolean) => {
    setIsRegister(nextRegister);
    setError('');
  };

  return (
    <div className="auth-page">
      <button
        type="button"
        className="auth-theme-btn"
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
      >
        <Icon icon={theme === 'dark' ? faSun : faMoon} />
      </button>

      <div className="auth-shell">
        <header className="auth-hero">
          <div className="auth-brand">
            {!logoFailed && (
              <img
                src="/logo.png"
                alt=""
                className="auth-logo"
                onError={() => setLogoFailed(true)}
              />
            )}
            <h1>ChatApp</h1>
          </div>
          <p className="subtitle">Secure messaging for your team</p>
        </header>

        <div className="auth-card">
          <div className="auth-mode-toggle" role="tablist" aria-label="Account mode">
            <button
              type="button"
              role="tab"
              aria-selected={!isRegister}
              className={`auth-mode-btn${!isRegister ? ' active' : ''}`}
              onClick={() => setMode(false)}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isRegister}
              className={`auth-mode-btn${isRegister ? ' active' : ''}`}
              onClick={() => setMode(true)}
            >
              Register
            </button>
          </div>

          {inviteChannelName && (
            <p className="auth-invite-banner">
              You&apos;ve been invited to join <strong>#{inviteChannelName}</strong>
            </p>
          )}

          <form className="auth-form" onSubmit={handleSubmit}>
            <label className="auth-field">
              <span className="auth-field-label">Email</span>
              <input
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (error) setError('');
                }}
                required
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
              />
            </label>

            {isRegister && (
              <>
                <label className="auth-field">
                  <span className="auth-field-label">Username</span>
                  <input
                    type="text"
                    placeholder="username"
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value);
                      if (error) setError('');
                    }}
                    required
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                  />
                </label>
                <label className="auth-field">
                  <span className="auth-field-label">Display name</span>
                  <input
                    type="text"
                    placeholder="Your name"
                    value={displayName}
                    onChange={(e) => {
                      setDisplayName(e.target.value);
                      if (error) setError('');
                    }}
                    required
                    autoComplete="name"
                  />
                </label>
              </>
            )}

            <label className="auth-field">
              <span className="auth-field-label">Password</span>
              <input
                type="password"
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError('');
                }}
                required
                minLength={8}
                autoComplete={isRegister ? 'new-password' : 'current-password'}
              />
            </label>

            {error && (
              <p className="error auth-error" role="alert">
                {error}
              </p>
            )}

            <button type="submit" className="auth-submit" disabled={loading}>
              {loading ? 'Please wait...' : isRegister ? 'Create account' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
