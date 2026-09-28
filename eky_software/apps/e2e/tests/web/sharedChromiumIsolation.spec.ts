import { existsSync } from 'node:fs';
import type { Browser, BrowserContext } from '@playwright/test';
import { test, expect } from '../../src/fixtures/isolatedWebTest.js';

// This ordered pair proves the boundary between two real fixture lifetimes,
// not merely two manually created contexts inside a single test.
test.describe.serial('WEB-WORKER-ISOLATION-001 @critical @security', () => {
  let first: { browser: Browser; context: BrowserContext; root: string; closed: boolean } | undefined;

  test('WEB-WORKER-ISOLATION-001 first test uses the configured context and leaves a synthetic cookie', async ({ e2eWeb }) => {
    const browser = e2eWeb.context.browser();
    expect(browser).not.toBeNull();
    first = { browser: browser!, context: e2eWeb.context, root: e2eWeb.runRoot, closed: false };
    e2eWeb.context.once('close', () => { first!.closed = true; });
    expect(await e2eWeb.page.evaluate(() => navigator.language)).toBe('fi-FI');
    expect(await e2eWeb.page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe('Europe/Helsinki');
    await e2eWeb.context.addCookies([{ name: 'eky-isolation-canary', value: 'synthetic', domain: '127.0.0.1', path: '/' }]);
    expect((await e2eWeb.context.cookies()).some(cookie => cookie.name === 'eky-isolation-canary')).toBe(true);
  });

  test('WEB-WORKER-ISOLATION-002 second test shares only the browser and receives fresh context and data', async ({ e2eWeb }) => {
    expect(first).toBeDefined();
    expect(e2eWeb.context.browser() === first!.browser).toBe(true);
    expect(e2eWeb.context === first!.context).toBe(false);
    expect(first!.closed).toBe(true);
    expect(existsSync(first!.root)).toBe(false);
    expect(e2eWeb.runRoot === first!.root).toBe(false);
    expect((await e2eWeb.context.cookies()).some(cookie => cookie.name === 'eky-isolation-canary')).toBe(false);
    const response = await e2eWeb.api.get('/customers');
    expect(response.ok()).toBe(true);
    expect(await response.json()).toMatchObject({ customers: [] });
  });
});
