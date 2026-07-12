import { useCallback, useEffect, useState } from 'react';
import {
  clearMediaCache,
  formatCacheSize,
  getMediaCacheStats,
  MediaCacheStats,
} from '../utils/mediaCache';

export function CacheManagementPanel() {
  const [stats, setStats] = useState<MediaCacheStats>({ count: 0, bytes: 0 });
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const next = await getMediaCacheStats();
      setStats(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read cache');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleClear = async () => {
    if (!window.confirm('Clear all cached images, videos, and other downloaded files?')) return;

    setClearing(true);
    setError('');
    setMessage('');
    try {
      await clearMediaCache();
      await refresh();
      setMessage('Cache cleared. Files will download again when needed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear cache');
    } finally {
      setClearing(false);
    }
  };

  return (
    <section className="profile-section">
      <div className="profile-section-header">
        <h4>Offline cache</h4>
      </div>
      <p className="profile-cache-intro">
        Downloaded avatars and attachments are saved locally so they load faster and use less data.
      </p>
      <dl className="profile-details profile-cache-stats">
        <div className="profile-detail-row">
          <dt>Cached files</dt>
          <dd>{loading ? '…' : stats.count.toLocaleString()}</dd>
        </div>
        <div className="profile-detail-row">
          <dt>Cache size</dt>
          <dd>{loading ? '…' : formatCacheSize(stats.bytes)}</dd>
        </div>
      </dl>
      {error && <p className="profile-error-inline">{error}</p>}
      {message && <p className="profile-cache-message">{message}</p>}
      <div className="profile-cache-actions">
        <button
          type="button"
          className="btn-secondary profile-cache-btn"
          onClick={() => void refresh()}
          disabled={loading || clearing}
        >
          Refresh
        </button>
        <button
          type="button"
          className="profile-cache-clear-btn"
          onClick={() => void handleClear()}
          disabled={loading || clearing || stats.count === 0}
        >
          {clearing ? 'Clearing…' : 'Clear cache'}
        </button>
      </div>
    </section>
  );
}
