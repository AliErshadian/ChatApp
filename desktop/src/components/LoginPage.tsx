import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { api } from '../services/api';
import { formatAuthError } from '../utils/authError';
import { Icon } from './Icon';
import { LoginCaptchaFields, useLoginCaptcha } from './LoginCaptcha';
import { faGlobe, faMoon, faSun } from '@fortawesome/free-solid-svg-icons';

type AuthProviderId = 'local' | 'active_directory';

interface PublicProvider {
  id: AuthProviderId;
  label: string;
  enabled: boolean;
  supportsRegistration: boolean;
  identifierLabel: string;
  identifierPlaceholder: string;
}

export function LoginPage() {
  const { login, loginWithProvider, register } = useAuth();
  const { theme, setTheme } = useTheme();
  const captcha = useLoginCaptcha();
  const [isRegister, setIsRegister] = useState(false);
  const [providers, setProviders] = useState<PublicProvider[]>([]);
  const [defaultProvider, setDefaultProvider] = useState<AuthProviderId>('local');
  const [selectedProvider, setSelectedProvider] = useState<AuthProviderId>('local');
  const [identifier, setIdentifier] = useState('');
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

  useEffect(() => {
    void captcha.checkProtection();
  }, [captcha.checkProtection]);

  useEffect(() => {
    let cancelled = false;
    api
      .getAuthProviders()
      .then((res) => {
        if (cancelled) return;
        const enabled = res.providers.filter((p) => p.enabled);
        setProviders(enabled.length ? enabled : [{
          id: 'local',
          label: 'Local',
          enabled: true,
          supportsRegistration: true,
          identifierLabel: 'Email',
          identifierPlaceholder: 'you@company.com',
        }]);
        const nextDefault =
          enabled.find((p) => p.id === res.defaultProvider)?.id ??
          enabled[0]?.id ??
          'local';
        setDefaultProvider(nextDefault);
        setSelectedProvider(nextDefault);
      })
      .catch(() => {
        if (cancelled) return;
        setProviders([
          {
            id: 'local',
            label: 'Local',
            enabled: true,
            supportsRegistration: true,
            identifierLabel: 'Email',
            identifierPlaceholder: 'you@company.com',
          },
        ]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeProvider =
    providers.find((p) => p.id === selectedProvider) ??
    providers[0] ??
    null;

  const canRegister =
    isRegister &&
    (activeProvider?.id === 'local' || !activeProvider) &&
    (providers.find((p) => p.id === 'local')?.supportsRegistration ?? true);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const mode = isRegister ? 'register' : 'login';
    try {
      if (isRegister) {
        await register(identifier, username, displayName, password);
        captcha.reset();
      } else {
        const provider = activeProvider?.id ?? defaultProvider;
        if (provider === 'local') {
          await login(identifier, password, captcha.payload);
        } else {
          await loginWithProvider(provider, identifier, password, captcha.payload);
        }
        captcha.reset();
      }
    } catch (err) {
      setError(formatAuthError(err, mode));
      if (!isRegister) {
        await captcha.applyFromError(err);
      }
    } finally {
      setLoading(false);
    }
  };

  const setMode = (nextRegister: boolean) => {
    setIsRegister(nextRegister);
    setError('');
    if (nextRegister) {
      setSelectedProvider('local');
    }
  };

  const showProviderToggle = !isRegister && providers.length > 1;

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
            <h1>RELAY</h1>
          </div>
          <p className="subtitle">Fast - Secure - Connected.</p>
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
            {(providers.some((p) => p.id === 'local' && p.supportsRegistration) ||
              providers.length === 0) && (
              <button
                type="button"
                role="tab"
                aria-selected={isRegister}
                className={`auth-mode-btn${isRegister ? ' active' : ''}`}
                onClick={() => setMode(true)}
              >
                Register
              </button>
            )}
          </div>

          {showProviderToggle && (
            <div className="auth-mode-toggle auth-provider-toggle" role="tablist" aria-label="Sign-in method">
              {providers.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={selectedProvider === p.id}
                  className={`auth-mode-btn${selectedProvider === p.id ? ' active' : ''}`}
                  onClick={() => {
                    setSelectedProvider(p.id);
                    setError('');
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}

          {inviteChannelName && (
            <p className="auth-invite-banner">
              You&apos;ve been invited to join <strong>#{inviteChannelName}</strong>
            </p>
          )}

          <form className="auth-form" onSubmit={handleSubmit}>
            <label className="auth-field">
              <span className="auth-field-label">
                {canRegister || activeProvider?.id === 'local'
                  ? 'Email'
                  : activeProvider?.identifierLabel ?? 'Username'}
              </span>
              <input
                type={
                  canRegister || activeProvider?.id === 'local' ? 'email' : 'text'
                }
                placeholder={
                  canRegister || activeProvider?.id === 'local'
                    ? 'you@company.com'
                    : activeProvider?.identifierPlaceholder ?? 'DOMAIN\\username'
                }
                value={identifier}
                onChange={(e) => {
                  setIdentifier(e.target.value);
                  if (error) setError('');
                }}
                onBlur={() => {
                  if (!isRegister && identifier.trim()) {
                    void captcha.checkProtection(identifier.trim());
                  }
                }}
                required
                autoComplete={
                  canRegister || activeProvider?.id === 'local' ? 'email' : 'username'
                }
                inputMode={
                  canRegister || activeProvider?.id === 'local' ? 'email' : 'text'
                }
                autoCapitalize="none"
                autoCorrect="off"
              />
            </label>

            {canRegister && (
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
                placeholder={
                  isRegister ? 'At least 8 characters' : 'Your password'
                }
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError('');
                }}
                required
                minLength={isRegister ? 8 : 1}
                autoComplete={isRegister ? 'new-password' : 'current-password'}
              />
            </label>

            {!isRegister && <LoginCaptchaFields captcha={captcha} />}

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

        <p className="auth-credit">
          Developed by <span>Ali Ershadian</span>
          <a
            className="auth-credit-link"
            href="https://aliershadian.com"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Ali Ershadian website"
            title="aliershadian.com"
          >
            <Icon icon={faGlobe} />
          </a>
        </p>
      </div>
    </div>
  );
}
