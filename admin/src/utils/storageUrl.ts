import { useEffect, useState } from 'react';
import { getApiBase } from '../config/endpoints';
import { api } from '../services/api';

const presignedCache = new Map<string, { url: string; expiresAt: number }>();

export function getAssetBase() {
  return getApiBase().replace(/\/api\/v1\/?$/, '');
}

export function parseAttachmentId(reference?: string): string | undefined {
  if (!reference) return undefined;
  const cleaned = reference.replace(/\?.*$/, '');
  const match = cleaned.match(/\/attachments\/([0-9a-f-]{36})(?:\/download)?$/i);
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
  return `${getAssetBase()}${reference.startsWith('/') ? reference : `/${reference}`}`;
}

async function fetchPresignedUrl(attachmentId: string): Promise<string> {
  const cached = presignedCache.get(attachmentId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.url;
  }

  const payload = await api.getAttachmentDownloadUrl(attachmentId);
  presignedCache.set(attachmentId, {
    url: payload.url,
    expiresAt: Date.now() + Math.max(0, payload.expiresInSeconds - 15) * 1000,
  });

  return payload.url;
}

export async function resolveStorageReference(
  reference?: string,
): Promise<string | undefined> {
  if (!reference) return undefined;

  const legacy = resolveLegacyAssetUrl(reference);
  if (legacy) return legacy;

  const attachmentId = parseAttachmentId(reference);
  if (!attachmentId) return undefined;

  return fetchPresignedUrl(attachmentId);
}

export function useStorageUrl(reference?: string): string | undefined {
  const [resolved, setResolved] = useState<string | undefined>(() =>
    resolveLegacyAssetUrl(reference),
  );

  useEffect(() => {
    let cancelled = false;
    const legacy = resolveLegacyAssetUrl(reference);
    if (legacy) {
      setResolved(legacy);
      return;
    }

    if (!reference) {
      setResolved(undefined);
      return;
    }

    resolveStorageReference(reference)
      .then((url) => {
        if (!cancelled) setResolved(url);
      })
      .catch(() => {
        if (!cancelled) setResolved(undefined);
      });

    return () => {
      cancelled = true;
    };
  }, [reference]);

  return resolved;
}
