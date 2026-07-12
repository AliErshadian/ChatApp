export interface VoiceMessageMeta {
  peaks: number[];
  durationMs: number;
}

const metaByKey = new Map<string, VoiceMessageMeta>();

export function setVoiceMessageMeta(key: string, meta: VoiceMessageMeta) {
  metaByKey.set(key, meta);
}

export function getVoiceMessageMeta(key: string): VoiceMessageMeta | undefined {
  return metaByKey.get(key);
}

export function remapVoiceMessageMeta(fromKey: string, toKey: string) {
  const meta = metaByKey.get(fromKey);
  if (!meta) return;
  metaByKey.set(toKey, meta);
  metaByKey.delete(fromKey);
}

export function voiceMessageCacheKey(message: {
  id: string;
  clientMessageId?: string;
  attachmentId?: string;
}): string {
  return message.attachmentId ?? message.id ?? message.clientMessageId ?? '';
}
