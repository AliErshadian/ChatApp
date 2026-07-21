import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, AppFeaturesSettings } from '../services/api';

export function FeaturesSettingsPage() {
  const [settings, setSettings] = useState<AppFeaturesSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setSettings(await api.getAppFeaturesSettings());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load feature settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const updateField = <K extends keyof AppFeaturesSettings>(key: K, value: AppFeaturesSettings[K]) => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!settings) return;
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const saved = await api.updateAppFeaturesSettings({
        voiceCallsEnabled: settings.voiceCallsEnabled,
        videoCallsEnabled: settings.videoCallsEnabled,
      });
      setSettings(saved);
      setMessage('Feature settings saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save feature settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="page-loading">Loading feature settings...</div>;
  }

  if (!settings) {
    return <p className="error-banner">{error || 'Failed to load feature settings'}</p>;
  }

  return (
    <div className="auth-settings-page">
      <p className="muted">
        Control which calling features are available to users in the desktop app. Changes take effect
        immediately without restarting the server.
      </p>

      {message && <p className="success-banner">{message}</p>}
      {error && <p className="error-banner">{error}</p>}

      <form className="auth-settings-form" onSubmit={save}>
        <section className="settings-section">
          <h3>Calls</h3>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={settings.voiceCallsEnabled}
              onChange={(e) => updateField('voiceCallsEnabled', e.target.checked)}
            />
            <span>Enable voice calls</span>
          </label>
          <p className="muted small">
            When disabled, users cannot start or receive voice calls. Call history remains visible.
          </p>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={settings.videoCallsEnabled}
              onChange={(e) => updateField('videoCallsEnabled', e.target.checked)}
            />
            <span>Enable video calls</span>
          </label>
          <p className="muted small">
            When disabled, users cannot start or receive video calls. Voice calls are unaffected.
          </p>
        </section>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  );
}
