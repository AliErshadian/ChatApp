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
        screenSharingEnabled: settings.screenSharingEnabled,
        screenSharingDirectEnabled: settings.screenSharingDirectEnabled,
        screenSharingGroupsEnabled: settings.screenSharingGroupsEnabled,
        screenMaxResolution: settings.screenMaxResolution,
        screenMaxFps: settings.screenMaxFps,
        screenMaxConcurrentSessions: settings.screenMaxConcurrentSessions,
        screenBandwidthLimitKbps: settings.screenBandwidthLimitKbps,
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
        Control calling and screen sharing features. Changes take effect immediately without restarting
        the server.
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
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={settings.videoCallsEnabled}
              onChange={(e) => updateField('videoCallsEnabled', e.target.checked)}
            />
            <span>Enable video calls</span>
          </label>
        </section>

        <section className="settings-section">
          <h3>Communication — Screen Sharing</h3>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={settings.screenSharingEnabled}
              onChange={(e) => updateField('screenSharingEnabled', e.target.checked)}
            />
            <span>Enable screen sharing</span>
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={settings.screenSharingDirectEnabled}
              onChange={(e) => updateField('screenSharingDirectEnabled', e.target.checked)}
              disabled={!settings.screenSharingEnabled}
            />
            <span>Enable in direct chats (during an active call)</span>
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={settings.screenSharingGroupsEnabled}
              onChange={(e) => updateField('screenSharingGroupsEnabled', e.target.checked)}
              disabled={!settings.screenSharingEnabled}
            />
            <span>Enable in groups (standalone sessions)</span>
          </label>
          <p className="muted small">Channels: always disabled (hard-enforced).</p>

          <label className="field">
            <span>Maximum resolution</span>
            <select
              value={settings.screenMaxResolution}
              onChange={(e) => updateField('screenMaxResolution', e.target.value)}
            >
              <option value="720p">720p</option>
              <option value="1080p">1080p</option>
              <option value="1440p">1440p</option>
            </select>
          </label>
          <label className="field">
            <span>Maximum FPS</span>
            <input
              type="number"
              min={1}
              max={60}
              value={settings.screenMaxFps}
              onChange={(e) => updateField('screenMaxFps', Number(e.target.value))}
            />
          </label>
          <label className="field">
            <span>Maximum concurrent sessions</span>
            <input
              type="number"
              min={1}
              max={500}
              value={settings.screenMaxConcurrentSessions}
              onChange={(e) => updateField('screenMaxConcurrentSessions', Number(e.target.value))}
            />
          </label>
          <label className="field">
            <span>Bandwidth limit (kbps, optional)</span>
            <input
              type="number"
              min={64}
              max={50000}
              value={settings.screenBandwidthLimitKbps ?? ''}
              placeholder="No limit"
              onChange={(e) =>
                updateField(
                  'screenBandwidthLimitKbps',
                  e.target.value === '' ? null : Number(e.target.value),
                )
              }
            />
          </label>
          <p className="muted small">
            TURN server: {settings.turnConfigured ? 'configured via environment' : 'not configured'}{' '}
            (set TURN_URL / TURN_USERNAME / TURN_PASSWORD).
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
