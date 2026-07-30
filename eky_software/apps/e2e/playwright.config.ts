import { defineConfig } from '@playwright/test';

const isCi = Boolean(
  (
    globalThis as typeof globalThis & {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env?.CI,
);
const isDesktopSoak = process.argv.some((argument) =>
  argument.includes('@soak'),
);

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  forbidOnly: isCi,
  fullyParallel: false,
  workers: 1,
  retries: isCi ? 1 : 0,
  failOnFlakyTests: isCi,
  timeout: 60_000,
  globalTimeout: isDesktopSoak ? 40 * 60_000 : 30 * 60_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  use: {
    headless: true,
    locale: 'fi-FI',
    timezoneId: 'Europe/Helsinki',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'system-api',
      testMatch: /system\/.*\.spec\.ts/,
    },
    {
      name: 'web-chromium',
      testMatch: /web\/.*\.spec\.ts/,
      use: {
        browserName: 'chromium',
      },
    },
    {
      name: 'electron-development',
      testMatch: /electron\/.*\.spec\.ts/,
    },
    {
      name: 'electron-endurance',
      testMatch: /electron-stress\/.*\.spec\.ts/,
    },
    {
      name: 'endurance-baseline',
      testMatch: /stress\/.*\.spec\.ts/,
    },
  ],
});
