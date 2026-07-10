import { getApiBase } from '../config/endpoints';

export function getAssetUrl(path?: string) {
  if (!path) return undefined;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const apiBase = getApiBase();
  const origin = apiBase.replace(/\/api\/v1\/?$/, '');
  return `${origin}${path.startsWith('/') ? path : `/${path}`}`;
}
