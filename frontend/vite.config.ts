import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import type { ProxyOptions } from 'vite';
import { isLocalFrontendOrigin } from './dev/local-proxy.ts';

// Preserve Starlette's Host/Origin checks while forwarding legitimate local POSTs.
const localProxy: ProxyOptions = {
    target: 'http://127.0.0.1:8000',
    changeOrigin: true,
    configure(proxy) {
      // Vite's default upstream error is an empty text/plain HTTP 500.
      // Keep the same restricted routes and return a useful API error instead.
      proxy.on('error', (_error, _request, response) => {
        if ('writeHead' in response && !response.headersSent && !response.writableEnded) {
          response.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
          response.end(JSON.stringify({ error: 'No se pudo comunicar con el backend local en 127.0.0.1:8000. Comprueba que Uvicorn siga ejecutándose.' }));
        }
      });
      proxy.on('proxyReq', (proxyRequest, request) => {
        if (isLocalFrontendOrigin(request.headers.origin, request.headers.host)) {
          proxyRequest.setHeader('Origin', 'http://127.0.0.1:8000');
        }
      });
    },
};
const apiProxy = {
  '/api/health': localProxy,
  '/api/dashboard/summary': localProxy,
  '/api/import': localProxy,
  '/api/events': localProxy,
  '/api/detections/preview': localProxy,
  '/api/reports/': localProxy,
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: apiProxy,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    proxy: apiProxy,
  },
});
