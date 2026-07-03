import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';

export function LoginPage() {
  const { login, register } = useAuth();
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
    try {
      if (isRegister) {
        await register(email, username, displayName, password);
      } else {
        await login(email, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
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
        <p className="subtitle">Enterprise Internal Messaging</p>
        {inviteChannelName && (
          <p className="auth-invite-banner">
            You&apos;ve been invited to join <strong>#{inviteChannelName}</strong>
          </p>
        )}
        <form onSubmit={handleSubmit}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          {isRegister && (
            <>
              <input
                type="text"
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
              <input
                type="text"
                placeholder="Display Name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
              />
            </>
          )}
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={loading}>
            {loading ? 'Please wait...' : isRegister ? 'Create Account' : 'Sign In'}
          </button>
        </form>
        <button className="link-btn" onClick={() => setIsRegister(!isRegister)}>
          {isRegister ? 'Already have an account? Sign in' : 'Need an account? Register'}
        </button>
      </div>
    </div>
  );
}
