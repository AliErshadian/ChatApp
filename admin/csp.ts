/**
 * Content-Security-Policy for the RELAY admin dashboard (production).
 */
export const ADMIN_CSP = [
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
