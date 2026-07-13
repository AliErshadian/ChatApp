import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  ConversationAttachment,
  ConversationAttachmentKind,
} from '../services/api';
import {
  formatFileSize,
  getAttachmentMediaKind,
  getAttachmentMediaLabel,
} from '../utils/messageMedia';
import { downloadMedia } from '../utils/downloadMedia';
import { useStorageUrl } from '../utils/storageUrl';
import { ImageViewerModal } from './ImageViewerModal';
import { VideoViewerModal } from './VideoViewerModal';
import { Icon } from './Icon';
import {
  faArrowLeft,
  faFile,
  faFileAudio,
  faFileImage,
  faFileVideo,
  faFolder,
  faMicrophone,
  faPlay,
} from '@fortawesome/free-solid-svg-icons';

interface Props {
  conversationId: string;
  currentUserId: string;
  onClose: () => void;
  onOpenMessage?: (messageId: string) => void;
}

const FILTER_TABS: Array<{ id: ConversationAttachmentKind; label: string }> = [
  { id: 'all', label: 'All files' },
  { id: 'mine', label: 'My uploads' },
  { id: 'shared', label: 'Shared' },
  { id: 'image', label: 'Images' },
  { id: 'video', label: 'Videos' },
  { id: 'document', label: 'Documents' },
  { id: 'audio', label: 'Audio' },
  { id: 'voice', label: 'Voice' },
];

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function FileKindIcon({ kind }: { kind: ReturnType<typeof getAttachmentMediaKind> }) {
  switch (kind) {
    case 'image':
      return <Icon icon={faFileImage} className="file-kind-icon" />;
    case 'video':
      return <Icon icon={faFileVideo} className="file-kind-icon" />;
    case 'voice':
      return <Icon icon={faMicrophone} className="file-kind-icon" />;
    case 'audio':
      return <Icon icon={faFileAudio} className="file-kind-icon" />;
    default:
      return <Icon icon={faFile} className="file-kind-icon" />;
  }
}

function FileThumbnail({
  item,
  onPreview,
}: {
  item: ConversationAttachment;
  onPreview?: () => void;
}) {
  const kind = getAttachmentMediaKind(item);
  const mediaUrl = useStorageUrl(item.url);

  if (kind === 'image' && mediaUrl) {
    return (
      <button type="button" className="file-thumb file-thumb--image" onClick={onPreview}>
        <img src={mediaUrl} alt={item.originalName} />
      </button>
    );
  }

  if (kind === 'video' && mediaUrl) {
    return (
      <button type="button" className="file-thumb file-thumb--video" onClick={onPreview}>
        <video src={mediaUrl} preload="metadata" muted playsInline />
        <span className="file-thumb-play" aria-hidden>
          <Icon icon={faPlay} />
        </span>
      </button>
    );
  }

  return (
    <div className="file-thumb file-thumb--icon">
      <FileKindIcon kind={kind} />
    </div>
  );
}

function FileRow({
  item,
  currentUserId,
  onOpenMessage,
}: {
  item: ConversationAttachment;
  currentUserId: string;
  onOpenMessage?: (messageId: string) => void;
}) {
  const kind = getAttachmentMediaKind(item);
  const mediaUrl = useStorageUrl(item.url);
  const [imageOpen, setImageOpen] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  const isOwn = item.uploadedBy === currentUserId;

  const handlePreview = () => {
    if (kind === 'image') setImageOpen(true);
    if (kind === 'video') setVideoOpen(true);
  };

  const handleDownload = () => {
    if (!mediaUrl) return;
    void downloadMedia(mediaUrl, item.originalName).catch(() => undefined);
  };

  return (
    <li className="file-list-item">
      <FileThumbnail item={item} onPreview={kind === 'image' || kind === 'video' ? handlePreview : undefined} />

      <div className="file-list-body">
        <div className="file-list-title" title={item.originalName}>
          {item.originalName}
        </div>
        <div className="file-list-meta">
          <span>{getAttachmentMediaLabel(item)}</span>
          <span>{formatFileSize(item.size)}</span>
          <span>{formatDate(item.createdAt)}</span>
        </div>
        <div className="file-list-uploader">
          {isOwn ? 'Uploaded by you' : `Shared by ${item.uploader.displayName}`}
        </div>
        {item.caption?.trim() && <div className="file-list-caption">{item.caption.trim()}</div>}
      </div>

      <div className="file-list-actions">
        {onOpenMessage && (
          <button
            type="button"
            className="btn-link file-action-btn"
            onClick={() => onOpenMessage(item.messageId)}
            title="Go to message"
          >
            Jump
          </button>
        )}
        {mediaUrl && (
          <button
            type="button"
            className="btn-link file-action-btn"
            onClick={handleDownload}
            title="Download"
          >
            Save
          </button>
        )}
      </div>

      {imageOpen && mediaUrl && (
        <ImageViewerModal
          open={imageOpen}
          src={mediaUrl}
          alt={item.originalName}
          fileName={item.originalName}
          onClose={() => setImageOpen(false)}
        />
      )}
      {videoOpen && mediaUrl && (
        <VideoViewerModal
          open={videoOpen}
          src={mediaUrl}
          fileName={item.originalName}
          onClose={() => setVideoOpen(false)}
        />
      )}
    </li>
  );
}

export function FileManagementPanel({
  conversationId,
  currentUserId,
  onClose,
  onOpenMessage,
}: Props) {
  const [activeKind, setActiveKind] = useState<ConversationAttachmentKind>('all');
  const [items, setItems] = useState<ConversationAttachment[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const requestIdRef = useRef(0);

  const loadPage = useCallback(
    async (kind: ConversationAttachmentKind, cursor?: string, append = false) => {
      const requestId = ++requestIdRef.current;
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setError('');
      }

      try {
        const result = await api.listConversationAttachments(conversationId, {
          kind,
          cursor,
        });
        if (requestId !== requestIdRef.current) return;

        setItems((prev) => (append ? [...prev, ...result.items] : result.items));
        setNextCursor(result.nextCursor);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setError(err instanceof Error ? err.message : 'Failed to load files');
        if (!append) setItems([]);
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [conversationId],
  );

  useEffect(() => {
    setItems([]);
    setNextCursor(null);
    void loadPage(activeKind);
  }, [activeKind, loadPage]);

  const handleLoadMore = () => {
    if (!nextCursor || loadingMore) return;
    void loadPage(activeKind, nextCursor, true);
  };

  return (
    <div className="conversation-info-panel file-management-panel">
      <header className="conversation-info-header">
        <button className="icon-btn back-btn" onClick={onClose} aria-label="Back to chat">
          <Icon icon={faArrowLeft} />
        </button>
        <h3>Files</h3>
      </header>

      <div className="file-management-tabs" role="tablist" aria-label="File filters">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeKind === tab.id}
            className={`file-management-tab${activeKind === tab.id ? ' file-management-tab--active' : ''}`}
            onClick={() => setActiveKind(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="conversation-info-content file-management-content">
        {loading ? (
          <div className="profile-loading">Loading files...</div>
        ) : error ? (
          <div className="profile-error">{error}</div>
        ) : items.length === 0 ? (
          <div className="file-management-empty">
            <div className="file-management-empty-icon" aria-hidden>
              <Icon icon={faFolder} />
            </div>
            <p>No files in this category yet.</p>
            <p className="file-management-empty-hint">
              Photos, videos, documents, and other attachments shared in this chat will appear here.
            </p>
          </div>
        ) : (
          <>
            <ul className="file-list">
              {items.map((item) => (
                <FileRow
                  key={item.id}
                  item={item}
                  currentUserId={currentUserId}
                  onOpenMessage={onOpenMessage}
                />
              ))}
            </ul>
            {nextCursor && (
              <div className="file-management-load-more">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? 'Loading...' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
