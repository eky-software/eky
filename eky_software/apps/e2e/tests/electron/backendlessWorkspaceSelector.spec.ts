import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { request as requestFactory } from '@playwright/test';

import { WORKSPACE_REGISTRY_FILE_NAME } from '../../../desktop/src/workspaces/registry/workspaceRegistryPaths.js';
import { acceptedBuildMetadataFileName } from '../../../desktop/src/update/acceptedBuildMetadataStore.js';
import { createSyntheticCustomerInput } from '../../src/data/syntheticBusinessInputs.js';
import { readSelectorTestBackendPort } from '../../src/electron/readElectronMainState.js';
import { readElectronE2eActiveWorkspace } from '../../src/environment/readElectronE2eActiveWorkspace.js';
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

test.describe('selector business opening', () => {
  test.use({ e2eSelectorProfile: 'empty' });

  test('DESK-SELECTOR-CREATE-001 @critical @recovery @security creates without selecting and preserves explicit business opening across process restart', async ({ e2eElectron }) => {
    const label = 'Synthetic selector business';
    await expect(e2eElectron.page.getByRole('heading', { name: 'Yritykset', exact: true })).toBeVisible();
    await assertNoBusinessRuntime(e2eElectron);
    const metadataPath = join(e2eElectron.runtime.userDataPath, 'update-state', acceptedBuildMetadataFileName);
    const metadataBefore = readFileSync(metadataPath);
    await e2eElectron.page.getByRole('button', { name: 'Lisää yritys Ekyyn' }).click();
    await e2eElectron.page.getByRole('textbox', { name: 'Yrityksen nimi' }).fill(label);
    await e2eElectron.performRelaunchingOperation(async () => {
      await e2eElectron.page.getByRole('button', { name: 'Luo yritys', exact: true }).click();
    });
    await expect(e2eElectron.page.getByRole('heading', { name: 'Yritykset', exact: true })).toBeVisible();
    await expect(e2eElectron.page.getByText(label, { exact: true })).toBeVisible();
    await expectBusinessRuntime(e2eElectron, false);
    const createdRegistry = JSON.parse(readRegistry(e2eElectron));
    expect(createdRegistry).toMatchObject({ formatVersion: 2, activeWorkspaceId: null });
    expect(createdRegistry.workspaces).toHaveLength(1);
    expect(createdRegistry.workspaces[0]).toMatchObject({ workspaceLabel: label, lifecycleState: 'ready' });
    expect(readFileSync(metadataPath).equals(metadataBefore)).toBe(true);
    expect(await e2eElectron.page.evaluate(async () => (await fetch('/health')).status)).toBe(503);
    const selectorPid = await e2eElectron.electronApp.evaluate(() => process.pid);

    await e2eElectron.page.getByRole('button', { name: 'Avaa yritys', exact: true }).click();
    const selector = await e2eElectron.performRelaunchingOperation(async () => {
      await e2eElectron.page.getByRole('button', { name: 'Vaihda yritys', exact: true }).click();
    });
    const brand = () => e2eElectron.page.getByRole('button', {
      name: `Vaihda yritystä. Aktiivinen yritys: ${label}`, exact: true,
    });
    await expect(brand()).toBeVisible();
    await expectBusinessRuntime(e2eElectron, true);
    expect(await e2eElectron.page.evaluate(async () => (await fetch('/health')).status)).toBe(200);
    const businessPid = await e2eElectron.electronApp.evaluate(() => process.pid);
    expect(businessPid).not.toBe(selectorPid);
    expect(e2eElectron.runtime.runtimeInstanceId).not.toBe(selector.previousRuntimeInstanceId);
    expect(e2eElectron.runtime.sessionSecret !== selector.previousSessionSecret).toBe(true);
    const active = readElectronE2eActiveWorkspace(e2eElectron.runtime.userDataPath);
    expect(active.workspaceId).toBe(createdRegistry.workspaces[0].workspaceId);
    const selectedRegistry = readRegistry(e2eElectron);
    expect(JSON.parse(selectedRegistry)).toEqual({ ...createdRegistry, activeWorkspaceId: active.workspaceId });
    expect(readFileSync(metadataPath).equals(metadataBefore)).toBe(true);
    const customerNumber = 'SELECTOR-RESTART-1';
    expect(await e2eElectron.page.evaluate(async data => (await fetch('/customers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    })).status, createSyntheticCustomerInput({ customerNumber }))).toBe(201);

    const business = await e2eElectron.restart();
    await expect(brand()).toBeVisible();
    await expectBusinessRuntime(e2eElectron, true);
    expect(await e2eElectron.electronApp.evaluate(() => process.pid)).not.toBe(businessPid);
    expect(e2eElectron.runtime.runtimeInstanceId).not.toBe(business.previousRuntimeInstanceId);
    expect(e2eElectron.runtime.sessionSecret !== business.previousSessionSecret).toBe(true);
    expect(readRegistry(e2eElectron)).toBe(selectedRegistry);
    expect(readFileSync(metadataPath).equals(metadataBefore)).toBe(true);
    expect(readElectronE2eActiveWorkspace(e2eElectron.runtime.userDataPath)).toEqual(active);
    const customers = await e2eElectron.page.evaluate(async () => {
      const response = await fetch('/customers');
      return { status: response.status, text: await response.text() };
    });
    expect(customers.status).toBe(200);
    expect(customers.text).toContain(customerNumber);
    const backendPort = await readSelectorTestBackendPort(e2eElectron.electronApp);
    expect(backendPort !== undefined).toBe(true);
    for (const staleSecret of [selector.previousSessionSecret, business.previousSessionSecret]) {
      const stale = await requestFactory.newContext({
        baseURL: `http://127.0.0.1:${String(backendPort)}`,
        extraHTTPHeaders: { Accept: 'application/json', 'x-eky-local-session': staleSecret },
      });
      try { expect((await stale.get('/company-settings')).status()).toBe(401); }
      finally { await stale.dispose(); }
    }
  });
});

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
    expect(e2eElectron.runtime.sessionSecret !== previous.previousSessionSecret).toBe(true);
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
  await expectBusinessRuntime(harness, false);
  // The fixture intentionally has registry entries but no business roots.
  expect(existsSync(join(harness.runtime.userDataPath, 'workspaces'))).toBe(false);
  expect(existsSync(join(harness.runtime.userDataPath, 'runtime', 'data', 'eky.sqlite'))).toBe(false);
}

async function expectBusinessRuntime(harness: IsolatedElectronHarness, running: boolean): Promise<void> {
  const state = await harness.electronApp.evaluate(() => {
    const control = (globalThis as unknown as { __EKY_ELECTRON_E2E__: {
      backendIsRunning(): boolean; backendStartCount(): number; runtimeSessionCount(): number;
    } }).__EKY_ELECTRON_E2E__;
    return { running: control.backendIsRunning(), starts: control.backendStartCount(), sessions: control.runtimeSessionCount() };
  });
  // The accepted release performs one additional, deliberately rejected session probe.
  expect(state).toEqual({ running, starts: running ? 1 : 0, sessions: running ? 2 : 0 });
}

function readRegistry(harness: IsolatedElectronHarness): string {
  return readFileSync(join(harness.runtime.userDataPath, WORKSPACE_REGISTRY_FILE_NAME), 'utf8');
}
