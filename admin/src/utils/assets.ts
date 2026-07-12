import { resolveLegacyAssetUrl } from './storageUrl';

/** @deprecated Prefer useStorageUrl or UserAvatar for MinIO-backed assets */
export function getAssetUrl(path?: string) {
  return resolveLegacyAssetUrl(path);
}
