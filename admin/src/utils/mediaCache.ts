const DB_NAME = 'chatapp-admin-media-cache';
const DB_VERSION = 1;
const STORE_NAME = 'entries';
const MAX_CACHE_BYTES = 150 * 1024 * 1024;

export interface MediaCacheEntry {
  key: string;
  mimeType: string;
  size: number;
  cachedAt: number;
  blob: Blob;
}

export interface MediaCacheStats {
  count: number;
  bytes: number;
}

const objectUrls = new Map<string, string>();

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('Failed to open media cache'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | void> {
  return openDb().then(
    (db) =>
      new Promise<T | void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);
        const request = run(store);
        tx.oncomplete = () => resolve(request?.result);
        tx.onerror = () => reject(tx.error ?? new Error('Media cache transaction failed'));
        tx.onabort = () => reject(tx.error ?? new Error('Media cache transaction aborted'));
      }),
  );
}

export function buildMediaCacheKey(reference: string): string | null {
  const cleaned = reference.replace(/\?.*$/, '');
  const attachmentMatch = cleaned.match(/\/attachments\/([0-9a-f-]{36})(?:\/(?:download|content))?$/i);
  if (attachmentMatch) return `attachment:${attachmentMatch[1]}`;

  if (
    cleaned.startsWith('/uploads/') ||
    cleaned.startsWith('http://') ||
    cleaned.startsWith('https://')
  ) {
    return `asset:${cleaned}`;
  }

  return null;
}

function revokeObjectUrl(key: string) {
  const existing = objectUrls.get(key);
  if (existing) {
    URL.revokeObjectURL(existing);
    objectUrls.delete(key);
  }
}

export function getCachedObjectUrl(key: string, blob: Blob): string {
  const existing = objectUrls.get(key);
  if (existing) return existing;

  const objectUrl = URL.createObjectURL(blob);
  objectUrls.set(key, objectUrl);
  return objectUrl;
}

export async function getCachedMedia(key: string): Promise<MediaCacheEntry | null> {
  const entry = (await runTransaction<MediaCacheEntry>('readonly', (store) =>
    store.get(key),
  )) as MediaCacheEntry | undefined;
  return entry ?? null;
}

async function listEntries(): Promise<MediaCacheEntry[]> {
  const entries = (await runTransaction<MediaCacheEntry[]>('readonly', (store) =>
    store.getAll(),
  )) as MediaCacheEntry[] | undefined;
  return entries ?? [];
}

async function evictIfNeeded(incomingSize: number) {
  const entries = await listEntries();
  let totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  if (totalBytes + incomingSize <= MAX_CACHE_BYTES) return;

  const sorted = [...entries].sort((a, b) => a.cachedAt - b.cachedAt);
  for (const entry of sorted) {
    if (totalBytes + incomingSize <= MAX_CACHE_BYTES) break;
    revokeObjectUrl(entry.key);
    await runTransaction('readwrite', (store) => store.delete(entry.key));
    totalBytes -= entry.size;
  }
}

export async function putCachedMedia(
  key: string,
  blob: Blob,
  mimeType = blob.type || 'application/octet-stream',
): Promise<void> {
  const entry: MediaCacheEntry = {
    key,
    mimeType,
    size: blob.size,
    cachedAt: Date.now(),
    blob,
  };

  await evictIfNeeded(blob.size);
  revokeObjectUrl(key);
  await runTransaction('readwrite', (store) => store.put(entry));
}

export async function clearMediaCache(): Promise<void> {
  for (const key of objectUrls.keys()) {
    revokeObjectUrl(key);
  }
  await runTransaction('readwrite', (store) => store.clear());
  window.dispatchEvent(new CustomEvent('chatapp-media-cache-cleared'));
}

export async function getMediaCacheStats(): Promise<MediaCacheStats> {
  const entries = await listEntries();
  return {
    count: entries.length,
    bytes: entries.reduce((sum, entry) => sum + entry.size, 0),
  };
}

export function formatCacheSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value >= 100 || unit === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unit]}`;
}
