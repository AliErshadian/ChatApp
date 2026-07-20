/**
 * Content-Security-Policy for the ChatApp desktop / browser client (production).
 * Dev (Vite HMR) skips this so React Fast Refresh and WS HMR keep working.
 */
export const DESKTOP_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: http: https:",
  "media-src 'self' blob: http: https:",
  "connect-src 'self' http: https: ws: wss: blob:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join('; ');
