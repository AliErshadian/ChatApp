import { useEffect, useState } from 'react';
import { getAssetBase } from './avatar';
import { api } from '../services/api';
import {
  buildMediaCacheKey,
  getCachedMedia,
  getCachedObjectUrl,
  putCachedMedia,
} from './mediaCache';

const inflightDownloads = new Map<string, Promise<string | undefined>>();

export function parseAttachmentId(reference?: string): string | undefined {
  if (!reference) return undefined;
  const cleaned = reference.replace(/\?.*$/, '');
  const match = cleaned.match(/\/attachments\/([0-9a-f-]{36})(?:\/(?:download|content))?$/i);
  return match?.[1];
}

export function isAttachmentReference(reference?: string): boolean {
  return !!parseAttachmentId(reference);
}

export function resolveLegacyAssetUrl(reference?: string): string | undefined {
  if (!reference) return undefined;
  if (reference.startsWith('blob:')) return reference;
  if (reference.startsWith('http://') || reference.startsWith('https://')) return reference;
  if (isAttachmentReference(reference)) return undefined;
  return `${getAssetBase()}${reference}`;
}

async function fetchAttachmentBlob(
  apiBase: string,
  attachmentId: string,
  accessToken: string | null,
): Promise<Blob> {
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const response = await fetch(`${apiBase}/attachments/${attachmentId}/content`, { headers });
  if (!response.ok) {
    throw new Error('Failed to download media');
  }
  return response.blob();
}

async function downloadLegacyBlob(url: string, accessToken: string | null): Promise<Blob> {
  const headers: Record<string, string> = {};
  if (accessToken && url.includes('/api/v1/')) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error('Failed to download media');
  }
  return response.blob();
}

async function resolveCachedOrDownload(
  reference: string,
  apiBase: string,
  accessToken: string | null,
): Promise<string | undefined> {
  const cacheKey = buildMediaCacheKey(reference);
  if (!cacheKey) return undefined;

  const cached = await getCachedMedia(cacheKey);
  if (cached) {
    return getCachedObjectUrl(cacheKey, cached.blob);
  }

  const legacy = resolveLegacyAssetUrl(reference);
  const attachmentId = parseAttachmentId(reference);
  const blob = legacy
    ? await downloadLegacyBlob(legacy, accessToken)
    : attachmentId
      ? await fetchAttachmentBlob(apiBase, attachmentId, accessToken)
      : null;

  if (!blob) return undefined;

  await putCachedMedia(cacheKey, blob);
  return getCachedObjectUrl(cacheKey, blob);
}

export function useStorageUrl(reference?: string): string | undefined {
  const [resolved, setResolved] = useState<string | undefined>(() =>
    resolveLegacyAssetUrl(reference),
  );

  useEffect(() => {
    let cancelled = false;

    const reload = () => {
      if (!reference) {
        setResolved(undefined);
        return;
      }

      if (reference.startsWith('blob:')) {
        setResolved(reference);
        return;
      }

      resolveStorageReference(reference, api.getApiBase(), api.getAccessToken())
        .then((url) => {
          if (!cancelled) setResolved(url);
        })
        .catch(() => {
          const legacy = resolveLegacyAssetUrl(reference);
          if (!cancelled) setResolved(legacy);
        });
    };

    reload();

    const onCacheCleared = () => reload();
    window.addEventListener('chatapp-media-cache-cleared', onCacheCleared);

    return () => {
      cancelled = true;
      window.removeEventListener('chatapp-media-cache-cleared', onCacheCleared);
    };
  }, [reference]);

  return resolved;
}

export async function resolveStorageReference(
  reference: string | undefined,
  apiBase: string,
  accessToken: string | null,
): Promise<string | undefined> {
  if (!reference) return undefined;

  if (reference.startsWith('blob:')) return reference;

  const legacyDirect = resolveLegacyAssetUrl(reference);
  const cacheKey = buildMediaCacheKey(reference);
  if (!cacheKey) return legacyDirect;

  const existing = inflightDownloads.get(cacheKey);
  if (existing) return existing;

  const promise = resolveCachedOrDownload(reference, apiBase, accessToken).finally(() => {
    inflightDownloads.delete(cacheKey);
  });
  inflightDownloads.set(cacheKey, promise);
  return promise;
}
