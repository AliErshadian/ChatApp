import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { formatAuthError } from '../utils/authError';
import { LoginCaptchaFields, useLoginCaptcha } from '../components/LoginCaptcha';

export function LoginPage() {
  const { login } = useAuth();
  const captcha = useLoginCaptcha();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void captcha.checkProtection();
  }, [captcha.checkProtection]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password, captcha.payload);
      captcha.reset();
    } catch (err) {
      setError(formatAuthError(err));
      await captcha.applyFromError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <span className="login-logo">◆</span>
          <h1>RELAY Admin</h1>
        </div>
        <p className="login-subtitle">Sign in with an administrator account</p>
        <form onSubmit={handleSubmit}>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (error) setError('');
              }}
              onBlur={() => {
                if (email.trim()) void captcha.checkProtection(email.trim());
              }}
              required
              autoComplete="email"
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError('');
              }}
              required
              autoComplete="current-password"
            />
          </label>
          <LoginCaptchaFields captcha={captcha} />
          {error && (
            <p className="error-banner" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
