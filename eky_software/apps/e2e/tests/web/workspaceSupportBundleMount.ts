import type { Page } from '@playwright/test';

import { expect } from '../../src/fixtures/isolatedWebTest.js';

interface SupportProbe {
  read(): number[];
  rememberHandler(): void;
  invokeRetained(twice: boolean): Promise<void>;
  configure(next: { creator?: number; disabled?: boolean; mounted?: boolean }): Promise<void>;
  release(index: number, outcome: 'created' | 'cancelled' | 'reject'): Promise<void>;
  close(): Promise<void>;
}

export async function mountWorkspaceSupportBundle(page: Page, startInLayoutEffect = false) {
  await expect(page.getByRole('heading', { name: 'Asiakkaat', exact: true })).toBeVisible();
  const handle = await page.evaluateHandle(async startInLayout => {
    const modulePath = '/src/features/workspaces/WorkspaceSupportBundleControl.testMount.ts';
    const { mountWorkspaceSupportBundleProbe } = await import(modulePath) as {
      mountWorkspaceSupportBundleProbe(start: boolean): Promise<SupportProbe>;
    };
    return mountWorkspaceSupportBundleProbe(startInLayout);
  }, startInLayoutEffect);
  return {
    view: page.getByRole('region', { name: 'Workspace support export probe' }),
    read: () => handle.evaluate(probe => probe.read()),
    rememberHandler: () => handle.evaluate(probe => probe.rememberHandler()),
    invokeRetained: (twice = false) => handle.evaluate((probe, value) => probe.invokeRetained(value), twice),
    configure: (next: { creator?: number; disabled?: boolean; mounted?: boolean }) =>
      handle.evaluate((probe, value) => probe.configure(value), next),
    release: (index: number, outcome: 'created' | 'cancelled' | 'reject') =>
      handle.evaluate((probe, value) => probe.release(value.index, value.outcome), { index, outcome }),
    async close() {
      let failure: { error: unknown } | undefined;
      try { await handle.evaluate(probe => probe.close()); } catch (error) { failure = { error }; }
      try { await handle.dispose(); } catch (error) { failure ??= { error }; }
      if (failure !== undefined) throw failure.error;
    },
  };
}
