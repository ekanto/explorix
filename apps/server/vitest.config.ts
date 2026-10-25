import { defineConfig } from 'vitest/config';
import { testDatabaseUrl } from './test/testDb.ts';

export default defineConfig({
  test: {
    globalSetup: ['./test/globalSetup.ts'],
    include: ['test/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: testDatabaseUrl(),
      STORAGE_DIR: './.data/test-uploads',
      AI_PROVIDER: 'none',
      LOG_LEVEL: 'silent',
      APP_URL: 'http://localhost:5173',
      // Fixed, non-secret key used only by the test database.
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    },
    // All suites share one seeded database, so run files sequentially.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
