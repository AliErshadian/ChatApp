import { useState } from 'react';
import { Message } from '../services/api';
import {
  formatFileSize,
  getMessageMediaKind,
  isTextMessage,
} from '../utils/messageMedia';
import { isVoiceMessage } from '../utils/voiceMessage';
import { useStorageUrl } from '../utils/storageUrl';
import { LinkifiedMessageText } from './LinkifiedMessageText';
import { ImageViewerModal } from './ImageViewerModal';
import { VideoViewerModal } from './VideoViewerModal';
import { VoiceMessageBubble } from './VoiceMessageBubble';

interface Props {
  message: Message;
  isOwn?: boolean;
}

export function MessageAttachmentContent({ message, isOwn = false }: Props) {
  const [imageViewerOpen, setImageViewerOpen] = useState(false);
  const [videoViewerOpen, setVideoViewerOpen] = useState(false);
  const kind = getMessageMediaKind(message);
  const mediaUrl = useStorageUrl(message.content);
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
        <>
          <button
            type="button"
            className="message-attachment-video-preview"
            onClick={(e) => {
              e.stopPropagation();
              setVideoViewerOpen(true);
            }}
            aria-label={`Play ${message.fileName ?? 'video'}`}
          >
            <video
              src={mediaUrl}
              className="message-attachment-video-thumb"
              preload="metadata"
              muted
              playsInline
            />
            <span className="message-attachment-play-icon" aria-hidden>
              ▶
            </span>
          </button>
          <VideoViewerModal
            open={videoViewerOpen}
            src={mediaUrl}
            fileName={message.fileName}
            onClose={() => setVideoViewerOpen(false)}
          />
        </>
      )}

      {(kind === 'voice' || isVoiceMessage(message)) && (
        <VoiceMessageBubble
          messageId={message.id}
          clientMessageId={message.clientMessageId}
          attachmentId={message.attachmentId}
          mediaUrl={mediaUrl}
          isOwn={isOwn}
        />
      )}

      {kind === 'audio' && !isVoiceMessage(message) && (
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
          <LinkifiedMessageText text={caption} mentions={message.mentions} />
        </div>
      )}
    </div>
  );
}

export function isAttachmentMessage(message: Message): boolean {
  return !isTextMessage(message);
}
