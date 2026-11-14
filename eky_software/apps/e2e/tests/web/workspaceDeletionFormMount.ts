import type { Page } from '@playwright/test';
import type { WorkspaceDeletionRequest } from '../../../web/src/app/desktopWorkspaceManagement.js';
import { expect } from '../../src/fixtures/isolatedWebTest.js';

interface DeletionFormProbe {
  read(): { requests: Readonly<WorkspaceDeletionRequest>[]; backs: number };
  configure(input: { busy?: boolean; backupAvailable?: boolean; label?: string; showIdentifier?: boolean }): Promise<void>;
  close(): Promise<void>;
}

export async function mountWorkspaceDeletionForm(page: Page) {
  await expect(page.getByRole('heading', { name: 'Asiakkaat', exact: true })).toBeVisible();
  const handle = await page.evaluateHandle(async () => {
    const modulePath = '/src/features/workspaces/WorkspaceDeletionForm.testMount.ts';
    const { mountWorkspaceDeletionFormProbe } = await import(modulePath) as {
      mountWorkspaceDeletionFormProbe(): Promise<DeletionFormProbe>;
    };
    return mountWorkspaceDeletionFormProbe();
  });
  return {
    view: page.getByRole('region', { name: 'Workspace deletion form probe' }),
    read: () => handle.evaluate(probe => probe.read()),
    configure: (input: { busy?: boolean; backupAvailable?: boolean; label?: string; showIdentifier?: boolean }) =>
      handle.evaluate((probe, value) => probe.configure(value), input),
    async close() {
      let failure: { error: unknown } | undefined;
      try { await handle.evaluate(probe => probe.close()); }
      catch (error) { failure = { error }; }
      try { await handle.dispose(); }
      catch (error) { failure ??= { error }; }
      if (failure !== undefined) throw failure.error;
    },
  };
}
