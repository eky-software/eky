import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { WORKSPACE_REGISTRY_FILE_NAME } from '../../../desktop/src/workspaces/registry/workspaceRegistryPaths.js';
import { acceptedBuildMetadataFileName } from '../../../desktop/src/update/acceptedBuildMetadataStore.js';
import { expect, test, type IsolatedElectronHarness } from '../../src/fixtures/isolatedElectronTest.js';

for (const state of ['empty', 'ready', 'recoveryRequired'] as const) {
  test.describe(`backendless ${state} selector`, () => {
    test.use({ e2eSelectorProfile: state });

    test(`DESK-SELECTOR-${state === 'recoveryRequired' ? 'RECOVERY' : state.toUpperCase()}-001 @critical @security preserves selection without creating a business runtime`, async ({ e2eElectron }) => {
      await expect(e2eElectron.page.getByRole('heading', { name: 'Yritykset', exact: true })).toBeVisible();
      await expect(e2eElectron.page.getByRole('button', { name: 'Lisää yritys Ekyyn' })).toBeVisible();
      await expect(e2eElectron.page.getByRole('button', { name: 'Tuo yritys varmuuskopiosta' })).toBeVisible();
      await expect(e2eElectron.page.getByRole('button', { name: 'Korvaa tiedot varmuuskopiosta' })).toHaveCount(0);
      await assertNoBusinessRuntime(e2eElectron);
      const originalRegistry = readRegistry(e2eElectron);
      expect(JSON.parse(originalRegistry)).toMatchObject({ formatVersion: 2, activeWorkspaceId: null });
      const denied = await e2eElectron.page.evaluate(async () => {
        const response = await fetch('/health');
        return { status: response.status, body: await response.text(), node: typeof (globalThis as { process?: unknown }).process };
      });
      expect(denied.status).toBe(503);
      expect(denied.body).toContain('Avaa yritys');
      expect(denied.node).toBe('undefined');

      if (state === 'empty') {
        await expect(e2eElectron.page.getByText('Ekyssä ei ole vielä paikallisia yrityksiä.')).toBeVisible();
        await expect(e2eElectron.page.getByRole('button', { name: 'Avaa yritys', exact: true })).toHaveCount(0);
      } else {
        await expect(e2eElectron.page.getByText('Synthetic selector company', { exact: true })).toBeVisible();
        const open = e2eElectron.page.getByRole('button', { name: 'Avaa yritys', exact: true });
        if (state === 'recoveryRequired') await expect(open).toBeDisabled();
        else {
          await expect(open).toBeEnabled();
          await e2eElectron.page.getByRole('button', { name: 'Nimeä uudelleen' }).click();
          await e2eElectron.page.getByRole('textbox', { name: 'Yrityksen nimi' }).fill('Renamed synthetic company');
          await e2eElectron.page.getByRole('button', { name: 'Tallenna nimi' }).click();
          await expect(e2eElectron.page.getByText('Renamed synthetic company', { exact: true })).toBeVisible();
        }
      }
      const registryBeforeRestart = readRegistry(e2eElectron);
      if (state !== 'ready') expect(registryBeforeRestart).toBe(originalRegistry);
      await e2eElectron.restart();
      await expect(e2eElectron.page.getByRole('heading', { name: 'Yritykset', exact: true })).toBeVisible();
      await assertNoBusinessRuntime(e2eElectron);
      expect(readRegistry(e2eElectron)).toBe(registryBeforeRestart);
      expect(JSON.parse(registryBeforeRestart).activeWorkspaceId).toBeNull();
    });
  });
}

test.describe('selector opening failure', () => {
  test.use({ e2eSelectorProfile: 'ready' });

  test('DESK-SELECTOR-RETURN-001 @critical @security returns to the selector in a new process after an absent workspace', async ({ e2eElectron }) => {
    await expect(e2eElectron.page.getByRole('heading', { name: 'Yritykset', exact: true })).toBeVisible();
    await assertNoBusinessRuntime(e2eElectron);
    const registryBefore = JSON.parse(readRegistry(e2eElectron));
    const metadataPath = join(e2eElectron.runtime.userDataPath, 'update-state', acceptedBuildMetadataFileName);
    const metadataBefore = readFileSync(metadataPath);
    const previousPid = await e2eElectron.electronApp.evaluate(() => process.pid);
    await e2eElectron.page.getByRole('button', { name: 'Avaa yritys', exact: true }).click();
    const previous = await e2eElectron.performRelaunchingOperation(async () => {
      await e2eElectron.page.getByRole('button', { name: 'Vaihda yritys', exact: true }).click();
    }, { expectSelectorRecovery: true });

    await expect(e2eElectron.page.getByRole('heading', { name: 'Yritykset', exact: true })).toBeVisible();
    await expect(e2eElectron.page.getByText('Synthetic selector company', { exact: true })).toBeVisible();
    await expect(e2eElectron.page.getByRole('button', { name: 'Avaa yritys', exact: true })).toBeDisabled();
    await assertNoBusinessRuntime(e2eElectron);
    expect(await e2eElectron.electronApp.evaluate(() => process.pid)).not.toBe(previousPid);
    expect(e2eElectron.runtime.runtimeInstanceId).not.toBe(previous.previousRuntimeInstanceId);
    expect(e2eElectron.runtime.sessionSecret).not.toBe(previous.previousSessionSecret);
    expect(readFileSync(metadataPath).equals(metadataBefore)).toBe(true);
    const registryAfter = readRegistry(e2eElectron);
    expect(JSON.parse(registryAfter)).toEqual({
      ...registryBefore, activeWorkspaceId: null,
      workspaces: registryBefore.workspaces.map((entry: Record<string, unknown>) => ({ ...entry, lifecycleState: 'recoveryRequired' })),
    });
    await e2eElectron.restart();
    await expect(e2eElectron.page.getByRole('heading', { name: 'Yritykset', exact: true })).toBeVisible();
    await assertNoBusinessRuntime(e2eElectron);
    expect(readRegistry(e2eElectron)).toBe(registryAfter);
    expect(readFileSync(metadataPath).equals(metadataBefore)).toBe(true);
  });
});

async function assertNoBusinessRuntime(harness: IsolatedElectronHarness): Promise<void> {
  const state = await harness.electronApp.evaluate(() => {
    const control = (globalThis as unknown as { __EKY_ELECTRON_E2E__: {
      backendIsRunning(): boolean; backendStartCount(): number; runtimeSessionCount(): number;
    } }).__EKY_ELECTRON_E2E__;
    return { running: control.backendIsRunning(), starts: control.backendStartCount(), sessions: control.runtimeSessionCount() };
  });
  expect(state).toEqual({ running: false, starts: 0, sessions: 0 });
  // The fixture intentionally has registry entries but no business roots.
  expect(existsSync(join(harness.runtime.userDataPath, 'workspaces'))).toBe(false);
  expect(existsSync(join(harness.runtime.userDataPath, 'runtime', 'data', 'eky.sqlite'))).toBe(false);
}

function readRegistry(harness: IsolatedElectronHarness): string {
  return readFileSync(join(harness.runtime.userDataPath, WORKSPACE_REGISTRY_FILE_NAME), 'utf8');
}
