import { Message, MessageReplyPreview } from '../services/api';
import { getAssetBase } from './avatar';
import { isVoiceMessage, VOICE_MESSAGE_PREFIX } from './voiceMessage';

export type MessageMediaKind = 'text' | 'image' | 'video' | 'audio' | 'document' | 'voice' | 'poll';

export const POLL_CONTENT_TYPE = 'application/vnd.relay.poll+json';
const LEGACY_POLL_CONTENT_TYPE = 'application/vnd.chatapp.poll+json';

export function isTextMessage(message: Pick<Message, 'contentType'>): boolean {
  return message.contentType === 'text/plain' || message.contentType.startsWith('text/');
}

export function isPollMessage(message: Pick<Message, 'contentType'>): boolean {
  return (
    message.contentType === POLL_CONTENT_TYPE ||
    message.contentType === LEGACY_POLL_CONTENT_TYPE
  );
}

export function isScreenShareMessage(message: Pick<Message, 'contentType'>): boolean {
  return message.contentType === 'application/vnd.relay.screen-share+json';
}

export function getMessageMediaKind(
  message: Pick<Message, 'contentType' | 'fileName'>,
): MessageMediaKind {
  if (isPollMessage(message)) return 'poll';
  if (isScreenShareMessage(message)) return 'document';
  if (isTextMessage(message)) return 'text';
  if (isVoiceMessage(message)) return 'voice';
  const contentType = message.contentType || '';
  if (contentType.startsWith('image/')) return 'image';
  if (contentType.startsWith('video/')) return 'video';
  if (contentType.startsWith('audio/')) return 'audio';
  return 'document';
}

export function getAttachmentMediaKind(
  attachment: Pick<{ mimeType: string; originalName: string }, 'mimeType' | 'originalName'>,
): Exclude<MessageMediaKind, 'text'> {
  if (attachment.originalName?.toLowerCase().startsWith(VOICE_MESSAGE_PREFIX)) return 'voice';
  const mimeType = attachment.mimeType || '';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'document';
}

export function getAttachmentMediaLabel(
  attachment: Pick<{ mimeType: string; originalName: string }, 'mimeType' | 'originalName'>,
): string {
  const kind = getAttachmentMediaKind(attachment);
  switch (kind) {
    case 'image':
      return 'Photo';
    case 'video':
      return 'Video';
    case 'voice':
      return 'Voice message';
    case 'audio':
      return 'Audio';
    case 'document':
      return attachment.originalName ?? 'Document';
    default:
      return 'File';
  }
}

export function getMessageMediaLabel(
  message: Pick<Message, 'contentType' | 'fileName'> & { content?: string },
): string {
  const kind = getMessageMediaKind(message);
  switch (kind) {
    case 'image':
      return 'Photo';
    case 'video':
      return 'Video';
    case 'voice':
      return 'Voice message';
    case 'audio':
      return 'Audio';
    case 'poll':
      return message.content?.trim() ? `Poll: ${message.content.trim()}` : 'Poll';
    case 'document':
      return message.fileName ?? 'Document';
    default:
      return 'Message';
  }
}

export function getMessagePreviewText(
  message: Pick<Message, 'content' | 'contentType' | 'fileName' | 'caption' | 'deletedForEveryone'>,
): string {
  if (message.deletedForEveryone) return 'Message deleted';
  if (isPollMessage(message)) {
    const q = message.content?.trim();
    return q ? `Poll: ${q}` : 'Poll';
  }
  if (isScreenShareMessage(message)) {
    try {
      const parsed = JSON.parse(message.content) as { status?: string; presenterName?: string };
      if (parsed.status === 'ended') return 'Screen share ended';
      return parsed.presenterName
        ? `${parsed.presenterName} started a screen share`
        : 'Screen share started';
    } catch {
      return 'Screen share';
    }
  }
  if (!isTextMessage(message)) {
    const label = getMessageMediaLabel(message);
    return message.caption?.trim() ? `${label}: ${message.caption.trim()}` : label;
  }
  return message.content;
}

export function getReplyPreviewText(replyTo: MessageReplyPreview): string {
  if (replyTo.deletedForEveryone) return 'Message deleted';
  if (replyTo.contentType && !isTextMessage({ contentType: replyTo.contentType })) {
    const label = getMessageMediaLabel({
      contentType: replyTo.contentType,
      fileName: replyTo.fileName,
    });
    return replyTo.caption?.trim() ? `${label}: ${replyTo.caption.trim()}` : label;
  }
  return replyTo.content;
}

export function resolveMediaUrl(url?: string) {
  if (!url) return undefined;
  if (url.startsWith('blob:')) return url;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `${getAssetBase()}${url}`;
}

export function formatFileSize(size?: string | number): string {
  const bytes = typeof size === 'string' ? Number(size) : size;
  if (!bytes || Number.isNaN(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const ATTACHMENT_ACCEPT =
  'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/aac,audio/webm,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,application/zip';
