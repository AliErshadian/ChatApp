/**
 * Public assets (e.g. logo.png in /public) must use BASE_URL so packaged
 * Electron (`file://` + Vite `base: './'`) resolves them relative to index.html.
 * Absolute `/logo.png` breaks and loads from the filesystem root.
 */
export function publicAssetUrl(path: string): string {
  const normalized = path.replace(/^\//, '');
  const base = import.meta.env.BASE_URL || './';
  return `${base}${normalized}`;
}

export const APP_LOGO_URL = publicAssetUrl('logo.png');
