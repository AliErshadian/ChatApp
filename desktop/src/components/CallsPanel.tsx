import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, CallHistoryItem, CallHistoryFilter, User } from '../services/api';
import { usePresence } from '../context/PresenceContext';
import { useAppFeatures } from '../context/AppFeaturesContext';
import { useVoiceCall } from '../hooks/useVoiceCall';
import { realtime } from '../services/realtime';
import { voiceCallManager } from '../services/voiceCall';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { SkeletonListRows } from './Skeleton';
import { EmptyState } from './ui/EmptyState';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  faArrowLeft,
  faArrowTrendDown,
  faArrowTrendUp,
  faPhone,
  faPhoneSlash,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';

interface Props {
  onClose: () => void;
  isMobile?: boolean;
  onMessage: (user: User) => void;
}

const FILTERS: Array<{ id: CallHistoryFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'incoming', label: 'Incoming' },
  { id: 'outgoing', label: 'Outgoing' },
  { id: 'missed', label: 'Missed' },
  { id: 'cancelled', label: 'Cancelled' },
  { id: 'not_answered', label: 'Not answered' },
];

function formatCallTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (isToday) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(seconds: number | null | undefined): string | null {
  if (!seconds || seconds <= 0) return null;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins > 0) {
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
  return `${secs}s`;
}

function callIcon(category: CallHistoryItem['category']): IconDefinition {
  switch (category) {
    case 'incoming':
      return faArrowTrendDown;
    case 'outgoing':
      return faArrowTrendUp;
    case 'missed':
      return faPhoneSlash;
    case 'cancelled':
      return faPhoneSlash;
    case 'not_answered':
      return faPhoneSlash;
    default:
      return faPhone;
  }
}

export function CallsPanel({ onClose, isMobile = false, onMessage }: Props) {
  const { getPresence, refreshPresence } = usePresence();
  const { features } = useAppFeatures();
  const { startVoiceCall, startVideoCall } = useVoiceCall();
  const [filter, setFilter] = useState<CallHistoryFilter>('all');
  const [items, setItems] = useState<CallHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [actionKey, setActionKey] = useState<string | null>(null);

  const closeLabel = isMobile ? 'Back to conversations' : 'Close calls';

  const loadHistory = useCallback(
    async (options?: { cursor?: string; append?: boolean; filter?: CallHistoryFilter }) => {
      const activeFilter = options?.filter ?? filter;
      const append = options?.append ?? false;

      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setError('');

      try {
        const result = await api.listCallHistory({
          filter: activeFilter,
          cursor: options?.cursor,
        });
        setItems((prev) => (append ? [...prev, ...result.items] : result.items));
        setNextCursor(result.nextCursor);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load call history');
        if (!append) setItems([]);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [filter],
  );

  useEffect(() => {
    void loadHistory({ filter });
  }, [filter, loadHistory]);

  useEffect(() => {
    const refresh = () => {
      void loadHistory({ filter });
    };

    const unsubscribeRealtime = realtime.onCallEnded(refresh);
    const unsubscribeHistory = voiceCallManager.onHistoryRefresh(refresh);

    return () => {
      unsubscribeRealtime();
      unsubscribeHistory();
    };
  }, [filter, loadHistory]);

  const presenceUserIds = useMemo(() => items.map((item) => item.peer.id), [items]);

  useEffect(() => {
    refreshPresence(presenceUserIds);
  }, [presenceUserIds, refreshPresence]);

  const handleFilterChange = (next: CallHistoryFilter) => {
    setFilter(next);
  };

  const handleCallBack = async (item: CallHistoryItem) => {
    setActionKey(item.id);
    setError('');
    try {
      if (item.mediaType === 'video') {
        await startVideoCall(item.conversationId, {
          id: item.peer.id,
          displayName: item.peer.displayName,
          username: item.peer.username,
        });
      } else {
        await startVoiceCall(item.conversationId, {
          id: item.peer.id,
          displayName: item.peer.displayName,
          username: item.peer.username,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start call');
    } finally {
      setActionKey(null);
    }
  };

  return (
    <div className="calls-panel">
      <header className="profile-header">
        <button
          className="icon-btn close-chat-btn"
          onClick={onClose}
          aria-label={closeLabel}
          title={closeLabel}
        >
          {isMobile ? <Icon icon={faArrowLeft} /> : <Icon icon={faXmark} />}
        </button>
        <h3>Calls</h3>
      </header>

      <div className="calls-filter-bar" role="tablist" aria-label="Call history filters">
        {FILTERS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={filter === tab.id}
            className={`calls-filter-btn${filter === tab.id ? ' active' : ''}`}
            onClick={() => handleFilterChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="calls-content">
        {error && <p className="profile-error-inline">{error}</p>}

        {loading ? (
          <SkeletonListRows count={7} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={faPhone}
            title="No calls yet"
            description="Your voice and video call history will appear here."
            className="empty-state--panel"
          />
        ) : (
          <ul className="calls-list">
            {items.map((item) => {
              const busy = actionKey === item.id;
              const duration = formatDuration(item.durationSeconds);
              const isMissedLike = item.category === 'missed' || item.category === 'not_answered';
              const canCallBack =
                item.mediaType === 'video'
                  ? features.videoCallsEnabled
                  : features.voiceCallsEnabled;

              return (
                <li key={item.id} className="call-history-row">
                  <div className="call-history-main">
                    <Avatar
                      name={item.peer.displayName}
                      avatarUrl={item.peer.avatarUrl}
                      size="sm"
                      presence={getPresence(item.peer.id)}
                    />
                    <div className="call-history-info">
                      <div className="call-history-title-row">
                        <span
                          className={`call-history-direction${isMissedLike ? ' call-history-direction--alert' : ''}`}
                          aria-hidden="true"
                        >
                          <Icon icon={callIcon(item.category)} />
                        </span>
                        <span className="call-history-name">{item.peer.displayName}</span>
                      </div>
                      <div className="call-history-meta">
                        <span
                          className={`call-history-label${isMissedLike ? ' call-history-label--alert' : ''}`}
                        >
                          {item.mediaType === 'video' ? 'Video · ' : ''}
                          {item.label}
                        </span>
                        {duration && <span className="call-history-duration">{duration}</span>}
                      </div>
                    </div>
                    <time className="call-history-time" dateTime={item.endedAt}>
                      {formatCallTime(item.endedAt)}
                    </time>
                  </div>
                  <div className="call-history-actions">
                    {canCallBack && (
                    <button
                      type="button"
                      className="contact-action-btn primary"
                      onClick={() => void handleCallBack(item)}
                      disabled={busy}
                      title={`Call ${item.peer.displayName}`}
                    >
                      {busy ? '...' : 'Call'}
                    </button>
                    )}
                    <button
                      type="button"
                      className="contact-action-btn"
                      onClick={() => onMessage(item.peer)}
                      disabled={busy}
                    >
                      Message
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {nextCursor && !loading && (
          <button
            type="button"
            className="calls-load-more"
            onClick={() => void loadHistory({ cursor: nextCursor, append: true })}
            disabled={loadingMore}
          >
            {loadingMore ? 'Loading...' : 'Load more'}
          </button>
        )}
      </div>
    </div>
  );
}
