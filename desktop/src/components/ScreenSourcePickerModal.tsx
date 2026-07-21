import { useEffect, useState } from 'react';
import {
  SYSTEM_PICKER_SOURCE_ID,
  canUseSystemDisplayPicker,
  listScreenCaptureSources,
  type ScreenCaptureSource,
  type ScreenShareSourceKind,
  mapSourceKind,
} from '../utils/screenCapture';

interface Props {
  open: boolean;
  onCancel: () => void;
  onConfirm: (selection: { source: ScreenCaptureSource; kind: ScreenShareSourceKind }) => void;
}

export function ScreenSourcePickerModal({ open, onCancel, onConfirm }: Props) {
  const [sources, setSources] = useState<ScreenCaptureSource[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'screen' | 'window'>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError('');
    setSelectedId(null);
    setSources([]);

    void listScreenCaptureSources(['screen', 'window'])
      .then((list) => {
        setSources(list);
        if (list[0]) setSelectedId(list[0].id);
        if (list.length === 0) {
          setError(
            'No screens or windows were listed by Electron. Use the system picker below — Windows will show a share dialog.',
          );
        }
      })
      .catch((err) => {
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to list capture sources. Use the system picker below.',
        );
      })
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  const filtered = sources.filter((s) => (filter === 'all' ? true : s.kind === filter));
  const selected = sources.find((s) => s.id === selectedId) ?? null;
  const systemPickerAvailable = canUseSystemDisplayPicker();

  const useSystemPicker = () => {
    onConfirm({
      source: {
        id: SYSTEM_PICKER_SOURCE_ID,
        name: 'System picker',
        kind: 'screen',
      },
      kind: 'screen',
    });
  };

  return (
    <div className="modal-overlay" role="presentation" onClick={onCancel}>
      <div
        className="modal screen-source-picker"
        role="dialog"
        aria-modal="true"
        aria-label="Choose what to share"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <h2>Share your screen</h2>
          <p className="muted">
            Choose a screen or window, or open the system share dialog.
          </p>
        </header>

        <div className="screen-source-filters" role="tablist">
          {(['all', 'screen', 'window'] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              className={filter === id ? 'active' : ''}
              onClick={() => setFilter(id)}
            >
              {id === 'all' ? 'All' : id === 'screen' ? 'Screens' : 'Windows'}
            </button>
          ))}
        </div>

        {loading && <p className="muted">Loading sources…</p>}
        {error && <p className="error-banner">{error}</p>}

        <div className="screen-source-grid">
          {filtered.map((source) => (
            <button
              key={source.id}
              type="button"
              className={`screen-source-card${selectedId === source.id ? ' selected' : ''}`}
              onClick={() => setSelectedId(source.id)}
            >
              {source.thumbnailDataUrl ? (
                <img src={source.thumbnailDataUrl} alt="" className="screen-source-thumb" />
              ) : (
                <div className="screen-source-thumb placeholder" />
              )}
              <span className="screen-source-name">{source.name}</span>
              <span className="screen-source-kind">{source.kind}</span>
            </button>
          ))}
        </div>

        {systemPickerAvailable && (
          <button type="button" className="screen-system-picker-btn" onClick={useSystemPicker}>
            Use system share dialog…
          </button>
        )}

        <footer className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!selected}
            onClick={() => {
              if (!selected) return;
              onConfirm({ source: selected, kind: mapSourceKind(selected) });
            }}
          >
            Share
          </button>
        </footer>
      </div>
    </div>
  );
}
