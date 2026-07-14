import type { Message } from '../services/api';

const STORAGE_KEY = 'chatapp_message_drafts';

export interface DraftReplyTo {
  id: string;
  senderId: string;
  content: string;
  contentType: string;
  fileName?: string;
  caption?: string;
  deletedForEveryone?: boolean;
  sender?: { id: string; displayName: string; username: string };
}

export interface MessageDraft {
  text: string;
  replyTo?: DraftReplyTo;
  updatedAt: number;
}

type DraftMap = Record<string, MessageDraft>;

let cache: DraftMap | null = null;
let version = 0;
const listeners = new Set<() => void>();

function notify() {
  version += 1;
  listeners.forEach((listener) => listener());
}

function readStorage(): DraftMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: DraftMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const entry = value as Partial<MessageDraft>;
      if (typeof entry.text !== 'string') continue;
      out[key] = {
        text: entry.text,
        replyTo: isDraftReply(entry.replyTo) ? entry.replyTo : undefined,
        updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : Date.now(),
      };
    }
    return out;
  } catch {
    return {};
  }
}

function isDraftReply(value: unknown): value is DraftReplyTo {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const reply = value as Partial<DraftReplyTo>;
  return (
    typeof reply.id === 'string' &&
    typeof reply.senderId === 'string' &&
    typeof reply.content === 'string' &&
    typeof reply.contentType === 'string'
  );
}

function ensureCache(): DraftMap {
  if (!cache) cache = readStorage();
  return cache;
}

function writeCache(next: DraftMap) {
  cache = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota / private mode — keep in-memory drafts for the session.
  }
  notify();
}

export function chatDraftKey(conversationId: string) {
  return `chat:${conversationId}`;
}

export function threadDraftKey(conversationId: string, rootMessageId: string) {
  return `thread:${conversationId}:${rootMessageId}`;
}

export function getDraft(key: string): MessageDraft | null {
  return ensureCache()[key] ?? null;
}

export function getDraftsVersion() {
  ensureCache();
  return version;
}

export function subscribeDrafts(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

export function draftReplyFromMessage(message: Message): DraftReplyTo {
  return {
    id: message.id,
    senderId: message.senderId,
    content: message.deletedForEveryone ? '' : message.content,
    contentType: message.contentType,
    fileName: message.fileName,
    caption: message.caption,
    deletedForEveryone: message.deletedForEveryone,
    sender: message.sender,
  };
}

export function messageFromDraftReply(reply: DraftReplyTo): Message {
  return {
    id: reply.id,
    conversationId: '',
    senderId: reply.senderId,
    content: reply.content,
    contentType: reply.contentType,
    fileName: reply.fileName,
    caption: reply.caption,
    deletedForEveryone: reply.deletedForEveryone,
    sequence: '0',
    createdAt: '',
    sender: reply.sender,
  };
}

export function setDraft(
  key: string,
  text: string,
  replyTo?: DraftReplyTo | Message | null,
) {
  const map = { ...ensureCache() };
  const reply =
    replyTo == null
      ? undefined
      : 'conversationId' in replyTo
        ? draftReplyFromMessage(replyTo)
        : replyTo;
  const hasText = text.trim().length > 0;
  const hasReply = Boolean(reply);

  if (!hasText && !hasReply) {
    if (!(key in map)) return;
    delete map[key];
    writeCache(map);
    return;
  }

  map[key] = {
    text,
    replyTo: reply,
    updatedAt: Date.now(),
  };
  writeCache(map);
}

export function clearDraft(key: string) {
  const map = { ...ensureCache() };
  if (!(key in map)) return;
  delete map[key];
  writeCache(map);
}

/** Prefer the main-chat draft; otherwise the newest thread draft for this conversation. */
export function getConversationDraftPreview(conversationId: string): string | null {
  const chat = getDraft(chatDraftKey(conversationId));
  if (chat?.text.trim()) return chat.text.trim();
  if (chat?.replyTo) return '';

  const map = ensureCache();
  const prefix = `thread:${conversationId}:`;
  let latest: MessageDraft | null = null;
  for (const [key, draft] of Object.entries(map)) {
    if (!key.startsWith(prefix)) continue;
    if (!draft.text.trim() && !draft.replyTo) continue;
    if (!latest || draft.updatedAt > latest.updatedAt) latest = draft;
  }
  if (!latest) return null;
  return latest.text.trim();
}
