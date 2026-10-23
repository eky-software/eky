import type { Page } from '@playwright/test';

import { expect, test } from '../../src/fixtures/isolatedWebTest.js';

const notice = 'Lokituksessa havaittiin häiriö. Osa teknisistä tapahtumista voi puuttua.';

interface NoticeProbe {
  active(): number;
  callOrder(): string[];
  queryCount(): number;
  emit(): void;
  release(failureObserved: boolean): void;
}

test('OBS-LOG-NOTICE-UI-001 @critical @fault keeps an observed failure across a late false snapshot and view navigation', async ({ e2eWeb }) => {
  const { page } = e2eWeb;
  await installBridge(page, false);
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { __ekyH5NoticeProbe: NoticeProbe }).__ekyH5NoticeProbe.active())).toBe(1);
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { __ekyH5NoticeProbe: NoticeProbe }).__ekyH5NoticeProbe.callOrder().slice(0, 2)))
    .toEqual(['subscribe', 'getStatus']);
  await page.evaluate(() =>
    (window as typeof window & { __ekyH5NoticeProbe: NoticeProbe }).__ekyH5NoticeProbe.emit());
  await expect(page.getByText(notice, { exact: true })).toBeVisible();
  await page.evaluate(() =>
    (window as typeof window & { __ekyH5NoticeProbe: NoticeProbe }).__ekyH5NoticeProbe.release(false));
  await page.getByRole('button', { name: 'Oma yritys', exact: true }).click();
  await expect(page.getByText(notice, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Diagnostiikka', exact: true }).click();
  await expect(page.getByText(notice, { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('OBS-LOG-NOTICE-UI-002 @critical @fault still reads a retained failure if notification subscription throws', async ({ e2eWeb }) => {
  const { page } = e2eWeb;
  await installBridge(page, true);
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { __ekyH5NoticeProbe: NoticeProbe }).__ekyH5NoticeProbe.queryCount()))
    .toBeGreaterThan(0);
  await page.evaluate(() =>
    (window as typeof window & { __ekyH5NoticeProbe: NoticeProbe }).__ekyH5NoticeProbe.release(true));
  await expect(page.getByText(notice, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Oma yritys', exact: true })).toBeEnabled();
  expect((await page.content()).includes('synthetic private subscription failure')).toBe(false);
});

async function installBridge(page: Page, subscriptionFails: boolean): Promise<void> {
  await page.addInitScript((failSubscription: boolean) => {
    const listeners = new Set<() => void>();
    const pending: Array<(value: { failureObserved: boolean }) => void> = [];
    const calls: string[] = [];
    let queries = 0;
    const target = window as typeof window & {
      ekyDesktop: unknown;
      __ekyH5NoticeProbe: NoticeProbe;
    };
    target.ekyDesktop = Object.freeze({
      getOperationalLogFailureStatus() {
        calls.push('getStatus');
        queries++;
        return new Promise<{ failureObserved: boolean }>(resolve => pending.push(resolve));
      },
      onOperationalLogFailure(callback: () => void) {
        calls.push('subscribe');
        if (failSubscription) throw new Error('synthetic private subscription failure');
        listeners.add(callback);
        return () => { listeners.delete(callback); };
      },
    });
    target.__ekyH5NoticeProbe = {
      active: () => listeners.size,
      callOrder: () => [...calls],
      queryCount: () => queries,
      emit() { for (const callback of listeners) callback(); },
      release(failureObserved) {
        for (const resolve of pending.splice(0)) resolve({ failureObserved });
      },
    };
  }, subscriptionFails);
  await page.reload();
}
