/**
 * Content Security Policy helpers.
 *
 * - API (Helmet): deny-by-default for any HTML accidentally served from the API.
 * - Desktop / Admin SPAs: allow app assets, API/WS, blob media, and (desktop) Google Fonts.
 * - Electron applies the SPA policy as a response header (stronger than meta alone).
 */

export const API_CSP_DIRECTIVES: Record<string, string[] | string> = {
  defaultSrc: ["'none'"],
  baseUri: ["'none'"],
  formAction: ["'none'"],
  frameAncestors: ["'none'"],
  // Health/metrics may be opened in a browser tab — keep scripts off
  scriptSrc: ["'none'"],
  styleSrc: ["'none'"],
  imgSrc: ["'none'"],
  connectSrc: ["'none'"],
  objectSrc: ["'none'"],
};

/** Production CSP for the chat client (desktop Electron + browser). */
export function buildDesktopCspHeader(): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self'",
    // React inline style attributes require 'unsafe-inline' for style-src
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: http: https:",
    "media-src 'self' blob: http: https:",
    // LAN / Electron talk to configurable API hosts over http(s) and ws(s)
    "connect-src 'self' http: https: ws: wss: blob:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join('; ');
}

/** Production CSP for the admin dashboard. */
export function buildAdminCspHeader(): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob: http: https:",
    "media-src 'self' blob: http: https:",
    "connect-src 'self' http: https: ws: wss: blob:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join('; ');
}
