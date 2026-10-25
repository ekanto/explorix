import { defineConfig } from 'vitest/config';

// Unit tests only; e2e/ is the Playwright suite that drives the real app.
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
