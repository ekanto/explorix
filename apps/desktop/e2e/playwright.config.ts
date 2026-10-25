import { defineConfig } from '@playwright/test';

/**
 * Explorix Desktop end-to-end suite. Launches the real Electron app (development build, or a
 * packaged build when EXPLORIX_E2E_EXE points at Explorix.exe) against a throwaway data folder.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 20_000 },
  outputDir: './test-results',
  reporter: [['list']],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
