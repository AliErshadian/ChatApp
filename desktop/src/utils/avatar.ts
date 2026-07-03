import { getServiceUrls } from '../config/endpoints';

export function getAssetBase() {
  return getServiceUrls().apiBase.replace(/\/api\/v1\/?$/, '');
}

export function resolveAvatarUrl(url?: string) {
  if (!url) return undefined;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `${getAssetBase()}${url}`;
}

export function getInitials(name: string) {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}
