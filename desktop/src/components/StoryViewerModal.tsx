import { useCallback, useEffect, useRef, useState } from 'react';
import { api, StoryItem, StoryViewerUser } from '../services/api';
import { useStorageUrl } from '../utils/storageUrl';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { Button } from './ui/Button';
import {
  faChevronLeft,
  faChevronRight,
  faEye,
  faHeart,
  faPaperPlane,
  faPlus,
  faTrashCan,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';

interface RingUser {
  userId: string;
  displayName: string;
  username: string;
  avatarUrl?: string;
}

interface Props {
  open: boolean;
  author: RingUser | null;
  currentUserId?: string;
  onClose: () => void;
  onDeleted: () => void;
  onReplySent: (conversationId: string) => void;
  /** Fired when the viewer has marked stories as seen (ring should update). */
  onViewed?: (authorId: string) => void;
  /** Owner can add another story from the viewer. */
  onAddStory?: () => void;
}

const IMAGE_DURATION_MS = 5000;

function StoryMedia({
  item,
  onEnded,
  paused = false,
}: {
  item: StoryItem;
  onEnded: () => void;
  paused?: boolean;
}) {
  const url = useStorageUrl(item.mediaUrl);
  const isVideo = item.mimeType.startsWith('video/');
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (paused) {
      video.pause();
    } else {
      void video.play().catch(() => undefined);
    }
  }, [paused, item.id]);

  if (!url) {
    return <div className="story-viewer-media-empty">Media unavailable</div>;
  }

  if (isVideo) {
    return (
      <video
        key={item.id}
        ref={videoRef}
        className="story-viewer-media"
        src={url}
        autoPlay={!paused}
        playsInline
        onEnded={onEnded}
      />
    );
  }

  return <img key={item.id} className="story-viewer-media" src={url} alt={item.caption ?? 'Story'} />;
}

export function StoryViewerModal({
  open,
  author,
  currentUserId,
  onClose,
  onDeleted,
  onReplySent,
  onViewed,
  onAddStory,
}: Props) {
  const [items, setItems] = useState<StoryItem[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reply, setReply] = useState('');
  const [replyBusy, setReplyBusy] = useState(false);
  const [likeBusy, setLikeBusy] = useState(false);
  const [replyFocused, setReplyFocused] = useState(false);
  const [viewersOpen, setViewersOpen] = useState(false);
  const [viewers, setViewers] = useState<StoryViewerUser[]>([]);
  const [progress, setProgress] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  const progressAtPauseRef = useRef(0);
  const viewedIdsRef = useRef<Set<string>>(new Set());
  const pendingViewIdsRef = useRef<Set<string>>(new Set());
  const didReportViewedRef = useRef(false);
  const reportFullyViewedRef = useRef<() => void>(() => undefined);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const indexRef = useRef(index);
  const itemsLengthRef = useRef(items.length);
  indexRef.current = index;
  itemsLengthRef.current = items.length;

  const current = items[index];
  const isOwner = Boolean(author && currentUserId && author.userId === currentUserId);
  const playbackPaused = viewersOpen || replyFocused;

  const reportFullyViewedIfNeeded = useCallback(() => {
    if (!author || isOwner || didReportViewedRef.current) return;
    if (items.length === 0) return;
    const allSeen = items.every((item) => viewedIdsRef.current.has(item.id));
    if (!allSeen) return;
    didReportViewedRef.current = true;
    onViewed?.(author.userId);
  }, [author, isOwner, items, onViewed]);

  reportFullyViewedRef.current = reportFullyViewedIfNeeded;

  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const goNext = useCallback(() => {
    // Side effects must not run inside setState updaters (would update ChatPage mid-render).
    if (indexRef.current >= itemsLengthRef.current - 1) {
      reportFullyViewedRef.current();
      onCloseRef.current();
      return;
    }
    progressAtPauseRef.current = 0;
    setIndex((prev) => prev + 1);
  }, []);

  const goPrev = useCallback(() => {
    progressAtPauseRef.current = 0;
    setIndex((prev) => Math.max(0, prev - 1));
  }, []);

  useEffect(() => {
    if (!open || !author) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setIndex(0);
    setReply('');
    setViewersOpen(false);
    setReplyFocused(false);
    viewedIdsRef.current = new Set();
    pendingViewIdsRef.current = new Set();
    didReportViewedRef.current = false;
    progressAtPauseRef.current = 0;
    api
      .listUserStories(author.userId)
      .then((list) => {
        if (cancelled) return;
        viewedIdsRef.current = new Set(
          list.filter((item) => item.viewedByMe).map((item) => item.id),
        );
        setItems(list);
        // Start at first unseen story when available.
        const firstUnseen = list.findIndex((item) => !item.viewedByMe);
        setIndex(firstUnseen >= 0 ? firstUnseen : 0);
        if (list.length === 0) onCloseRef.current();
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load stories');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, author?.userId]);

  useEffect(() => {
    if (!open || !current || isOwner) return;
    const storyId = current.id;
    if (current.viewedByMe || viewedIdsRef.current.has(storyId)) {
      viewedIdsRef.current.add(storyId);
      reportFullyViewedRef.current();
      return;
    }
    // Already in flight (e.g. React Strict Mode remount) — do not POST again.
    if (pendingViewIdsRef.current.has(storyId)) return;

    pendingViewIdsRef.current.add(storyId);
    void api
      .markStoryViewed(storyId)
      .then(() => {
        pendingViewIdsRef.current.delete(storyId);
        viewedIdsRef.current.add(storyId);
        reportFullyViewedRef.current();
      })
      .catch(() => {
        pendingViewIdsRef.current.delete(storyId);
      });
  }, [open, current?.id, current?.viewedByMe, isOwner]);

  useEffect(() => {
    clearTimer();
    setProgress(0);
    progressAtPauseRef.current = 0;
  }, [open, current?.id]);

  useEffect(() => {
    clearTimer();
    if (!open || !current || playbackPaused) return;
    if (current.mimeType.startsWith('video/')) return;

    const base = progressAtPauseRef.current;
    startedAtRef.current = Date.now() - base * IMAGE_DURATION_MS;
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAtRef.current;
      const next = Math.min(1, elapsed / IMAGE_DURATION_MS);
      setProgress(next);
      progressAtPauseRef.current = next;
      if (next >= 1) {
        clearTimer();
        goNext();
      }
    }, 50);

    return clearTimer;
  }, [open, current?.id, current?.mimeType, goNext, playbackPaused]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (viewersOpen) {
          setViewersOpen(false);
          return;
        }
        if (replyFocused) {
          (document.activeElement as HTMLElement | null)?.blur?.();
          setReplyFocused(false);
          return;
        }
        reportFullyViewedIfNeeded();
        onClose();
      }
      if (viewersOpen || replyFocused) return;
      if (e.key === 'ArrowRight') goNext();
      if (e.key === 'ArrowLeft') goPrev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, goNext, goPrev, reportFullyViewedIfNeeded, viewersOpen, replyFocused]);

  if (!open || !author) return null;

  const handleClose = () => {
    reportFullyViewedIfNeeded();
    onClose();
  };

  const handleDelete = async () => {
    if (!current || !isOwner) return;
    try {
      await api.deleteStory(current.id);
      const remaining = items.filter((item) => item.id !== current.id);
      setItems(remaining);
      onDeleted();
      if (remaining.length === 0) onClose();
      else setIndex((prev) => Math.min(prev, remaining.length - 1));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete story');
    }
  };

  const handleReply = async () => {
    if (!current || !reply.trim() || isOwner) return;
    setReplyBusy(true);
    setError('');
    try {
      const result = await api.replyToStory(current.id, reply.trim());
      setReply('');
      onReplySent(result.conversationId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send reply');
    } finally {
      setReplyBusy(false);
    }
  };

  const handleToggleLike = async () => {
    if (!current || isOwner || likeBusy) return;
    setLikeBusy(true);
    setError('');
    const storyId = current.id;
    const nextLiked = !current.likedByMe;
    // Optimistic update
    setItems((prev) =>
      prev.map((item) => (item.id === storyId ? { ...item, likedByMe: nextLiked } : item)),
    );
    try {
      if (nextLiked) {
        await api.likeStory(storyId);
        viewedIdsRef.current.add(storyId);
      } else {
        await api.unlikeStory(storyId);
      }
    } catch (err) {
      setItems((prev) =>
        prev.map((item) => (item.id === storyId ? { ...item, likedByMe: !nextLiked } : item)),
      );
      setError(err instanceof Error ? err.message : 'Failed to update like');
    } finally {
      setLikeBusy(false);
    }
  };

  const openViewers = async () => {
    if (!current || !isOwner) return;
    clearTimer();
    try {
      const list = await api.listStoryViewers(current.id);
      setViewers(list);
      setViewersOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load viewers');
    }
  };

  const closeViewers = () => setViewersOpen(false);

  const viewCountLabel =
    typeof current?.viewCount === 'number'
      ? current.viewCount
      : viewersOpen
        ? viewers.length
        : undefined;

  return (
    <div
      className={`story-viewer-overlay${viewersOpen ? ' story-viewer-overlay--sheet' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Story viewer"
    >
      <div className={`story-viewer${viewersOpen ? ' story-viewer--compact' : ''}`}>
        <div className="story-viewer-progress">
          {items.map((item, i) => (
            <div key={item.id} className="story-viewer-progress-track">
              <div
                className="story-viewer-progress-fill"
                style={{
                  width:
                    i < index
                      ? '100%'
                      : i === index
                        ? `${(current?.mimeType.startsWith('video/') ? 0 : progress) * 100}%`
                        : '0%',
                }}
              />
            </div>
          ))}
        </div>

        <header className="story-viewer-header">
          <div className="story-viewer-author">
            <Avatar name={author.displayName} avatarUrl={author.avatarUrl} size="sm" />
            <div>
              <strong>{author.displayName}</strong>
              <span>@{author.username}</span>
            </div>
          </div>
          <div className="story-viewer-header-actions">
            {isOwner && current && (
              <>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => {
                    handleClose();
                    onAddStory?.();
                  }}
                  title="Add story"
                  aria-label="Add story"
                >
                  <Icon icon={faPlus} />
                </button>
                <button type="button" className="icon-btn" onClick={() => void handleDelete()} title="Delete">
                  <Icon icon={faTrashCan} />
                </button>
              </>
            )}
            <button type="button" className="icon-btn" onClick={handleClose} aria-label="Close">
              <Icon icon={faXmark} />
            </button>
          </div>
        </header>

        <div className="story-viewer-stage">
          {!viewersOpen && (
            <button type="button" className="story-viewer-nav story-viewer-nav--prev" onClick={goPrev} aria-label="Previous">
              <Icon icon={faChevronLeft} />
            </button>
          )}
          <div className="story-viewer-media-wrap">
            {loading ? (
              <div className="story-viewer-media-empty">Loading…</div>
            ) : current ? (
              <StoryMedia
                item={current}
                paused={playbackPaused}
                onEnded={playbackPaused ? () => undefined : goNext}
              />
            ) : (
              <div className="story-viewer-media-empty">{error || 'No stories'}</div>
            )}
            {current?.caption && !viewersOpen && (
              <p className="story-viewer-caption">{current.caption}</p>
            )}
          </div>
          {!viewersOpen && (
            <button type="button" className="story-viewer-nav story-viewer-nav--next" onClick={goNext} aria-label="Next">
              <Icon icon={faChevronRight} />
            </button>
          )}
        </div>

        {isOwner && current && !viewersOpen && (
          <button
            type="button"
            className="story-viewer-views-btn"
            onClick={() => void openViewers()}
            aria-label="View story viewers"
          >
            <Icon icon={faEye} />
            <span>
              {typeof viewCountLabel === 'number'
                ? `${viewCountLabel} view${viewCountLabel === 1 ? '' : 's'}`
                : 'Views'}
            </span>
            {typeof current.likeCount === 'number' && current.likeCount > 0 && (
              <>
                <Icon icon={faHeart} className="story-viewer-views-heart" />
                <span>{current.likeCount}</span>
              </>
            )}
          </button>
        )}

        {!isOwner && current && !viewersOpen && (
          <form
            className="story-viewer-reply"
            onSubmit={(e) => {
              e.preventDefault();
              void handleReply();
            }}
          >
            <button
              type="button"
              className={`story-viewer-like-btn${current.likedByMe ? ' is-liked' : ''}`}
              onClick={() => void handleToggleLike()}
              disabled={likeBusy}
              aria-label={current.likedByMe ? 'Unlike story' : 'Like story'}
              aria-pressed={current.likedByMe}
            >
              <Icon icon={faHeart} />
            </button>
            <input
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onFocus={() => setReplyFocused(true)}
              onBlur={() => setReplyFocused(false)}
              placeholder="Reply to story…"
              maxLength={10000}
              disabled={replyBusy}
            />
            <Button type="submit" variant="primary" disabled={replyBusy || !reply.trim()}>
              <Icon icon={faPaperPlane} />
            </Button>
          </form>
        )}

        {error && <p className="story-viewer-error">{error}</p>}
      </div>

      {viewersOpen && (
        <>
          <button
            type="button"
            className="story-viewers-backdrop"
            aria-label="Dismiss viewers"
            onClick={closeViewers}
          />
          <div className="story-viewers-sheet" role="dialog" aria-label="Story viewers">
            <div className="story-viewers-handle" aria-hidden="true" />
            <header className="story-viewers-header">
              <h4>
                {viewers.length} view{viewers.length === 1 ? '' : 's'}
                {viewers.some((v) => v.liked) ? (
                  <span className="story-viewers-like-summary">
                    {' · '}
                    {viewers.filter((v) => v.liked).length} like
                    {viewers.filter((v) => v.liked).length === 1 ? '' : 's'}
                  </span>
                ) : null}
              </h4>
              <button type="button" className="icon-btn" onClick={closeViewers} aria-label="Close viewers">
                <Icon icon={faXmark} />
              </button>
            </header>
            <div className="story-viewers-body">
              {viewers.length === 0 ? (
                <p className="story-viewers-empty">No views yet</p>
              ) : (
                <ul className="story-viewers-list">
                  {viewers.map((viewer) => (
                    <li key={viewer.id}>
                      <Avatar name={viewer.displayName} avatarUrl={viewer.avatarUrl} size="sm" />
                      <div className="story-viewers-meta">
                        <strong>{viewer.displayName}</strong>
                        <span>@{viewer.username}</span>
                      </div>
                      {viewer.liked && (
                        <span className="story-viewers-liked" title="Liked your story" aria-label="Liked">
                          <Icon icon={faHeart} />
                        </span>
                      )}
                      <time dateTime={viewer.viewedAt}>
                        {new Date(viewer.viewedAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </time>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
