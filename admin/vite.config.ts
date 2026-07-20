import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { ADMIN_CSP } from './csp';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    {
      name: 'inject-csp-meta',
      transformIndexHtml(html) {
        if (mode !== 'production') return html;
        const meta = `<meta http-equiv="Content-Security-Policy" content="${ADMIN_CSP}" />`;
        return html.replace(/<head>/i, `<head>\n    ${meta}`);
      },
    },
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 5174,
    host: true,
  },
  build: { outDir: 'dist' },
}));
