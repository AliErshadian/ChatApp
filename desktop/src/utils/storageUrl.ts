import { useEffect, useState } from 'react';
import { getAssetBase } from './avatar';
import { api } from '../services/api';

const presignedCache = new Map<string, { url: string; expiresAt: number }>();

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
  return `${getAssetBase()}${reference}`;
}

export async function fetchPresignedUrl(
  apiBase: string,
  attachmentId: string,
  accessToken: string | null,
): Promise<string> {
  const cached = presignedCache.get(attachmentId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.url;
  }

  const response = await fetch(`${apiBase}/attachments/${attachmentId}/download`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });

  if (!response.ok) {
    throw new Error('Failed to resolve attachment download URL');
  }

  const payload = (await response.json()) as {
    url: string;
    expiresInSeconds: number;
  };

  presignedCache.set(attachmentId, {
    url: payload.url,
    expiresAt: Date.now() + Math.max(0, payload.expiresInSeconds - 15) * 1000,
  });

  return payload.url;
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

    resolveStorageReference(reference, api.getApiBase(), api.getAccessToken())
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

export async function resolveStorageReference(
  reference: string | undefined,
  apiBase: string,
  accessToken: string | null,
): Promise<string | undefined> {
  if (!reference) return undefined;

  const legacy = resolveLegacyAssetUrl(reference);
  if (legacy) return legacy;

  const attachmentId = parseAttachmentId(reference);
  if (!attachmentId) return undefined;

  return fetchPresignedUrl(apiBase, attachmentId, accessToken);
}
