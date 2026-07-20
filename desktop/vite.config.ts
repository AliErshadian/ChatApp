import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import path from 'path';
import { DESKTOP_CSP } from './csp';

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:3000';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    basicSsl(),
    {
      name: 'inject-csp-meta',
      transformIndexHtml(html) {
        if (mode !== 'production') return html;
        const meta = `<meta http-equiv="Content-Security-Policy" content="${DESKTOP_CSP}" />`;
        return html.replace(/<head>/i, `<head>\n    ${meta}`);
      },
    },
  ],
  base: './',
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
      '/socket.io': {
        target: apiProxyTarget,
        changeOrigin: true,
        ws: true,
        secure: false,
      },
    },
  },
  build: { outDir: 'dist' },
}));
