import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // Bound jsdom/Recharts concurrency for the project's 16 GB Windows machine.
    maxWorkers: 2,
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
    clearMocks: true,
  },
});
