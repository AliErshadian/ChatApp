import { useState } from 'react';
import { Message } from '../services/api';
import {
  formatFileSize,
  getMessageMediaKind,
  isTextMessage,
  resolveMediaUrl,
} from '../utils/messageMedia';
import { LinkifiedMessageText } from './LinkifiedMessageText';
import { ImageViewerModal } from './ImageViewerModal';

interface Props {
  message: Message;
}

export function MessageAttachmentContent({ message }: Props) {
  const [imageViewerOpen, setImageViewerOpen] = useState(false);
  const kind = getMessageMediaKind(message.contentType);
  const mediaUrl = resolveMediaUrl(message.content);
  const caption = message.caption?.trim();

  if (!mediaUrl) {
    return <div className="message-content deleted">Attachment unavailable</div>;
  }

  return (
    <div className="message-attachment">
      {kind === 'image' && (
        <>
          <button
            type="button"
            className="message-attachment-image-link"
            onClick={(e) => {
              e.stopPropagation();
              setImageViewerOpen(true);
            }}
            aria-label={`Open ${message.fileName ?? 'image'}`}
          >
            <img src={mediaUrl} alt={message.fileName ?? 'Image'} className="message-attachment-image" />
          </button>
          <ImageViewerModal
            open={imageViewerOpen}
            src={mediaUrl}
            alt={message.fileName ?? 'Image'}
            fileName={message.fileName}
            onClose={() => setImageViewerOpen(false)}
          />
        </>
      )}

      {kind === 'video' && (
        <video
          src={mediaUrl}
          controls
          className="message-attachment-video"
          preload="metadata"
        />
      )}

      {kind === 'audio' && (
        <div className="message-attachment-audio">
          <audio src={mediaUrl} controls preload="metadata" />
          {message.fileName && <span className="message-attachment-filename">{message.fileName}</span>}
        </div>
      )}

      {kind === 'document' && (
        <a
          href={mediaUrl}
          target="_blank"
          rel="noopener noreferrer"
          download={message.fileName}
          className="message-attachment-document"
        >
          <span className="message-attachment-document-icon" aria-hidden>
            📄
          </span>
          <span className="message-attachment-document-meta">
            <span className="message-attachment-filename">{message.fileName ?? 'Document'}</span>
            {message.fileSize && (
              <span className="message-attachment-filesize">{formatFileSize(message.fileSize)}</span>
            )}
          </span>
        </a>
      )}

      {caption && (
        <div className="message-attachment-caption">
          <LinkifiedMessageText text={caption} />
        </div>
      )}
    </div>
  );
}

export function isAttachmentMessage(message: Message): boolean {
  return !isTextMessage(message);
}
