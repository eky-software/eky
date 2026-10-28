import { createHash } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { ElectronApplication } from '@playwright/test';

import type { createWorkspaceDeletionProof } from '../../../desktop/e2e/workspaceDeletionProof.js';
import { workspaceDeletionProofBackupPath } from '../../../desktop/e2e/electronE2eNativeAdapters.js';
import { decryptBackupPayload } from '../../../desktop/src/profileBackup/container/decryptBackupPayload.js';
import { readDecryptedBackupPayload } from '../../../desktop/src/profileBackup/container/backupContainerReader.js';
import { createProfileSnapshotRuntimePaths } from '../../../desktop/src/profileBackup/profileSnapshotRuntimePaths.js';
import { acquireWorkspaceProcessReservation, WorkspaceProcessReservationError } from '../../../desktop/src/runtime/workspaceProcessReservation.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../../../desktop/src/workspaces/registry/workspaceRegistryPaths.js';
import { createSyntheticCustomerInput } from '../../src/data/syntheticBusinessInputs.js';
import { readElectronE2eActiveWorkspace } from '../../src/environment/readElectronE2eActiveWorkspace.js';
import { ELECTRON_E2E_PROCESS_CONNECT_TIMEOUT_MILLISECONDS } from '../../src/fixtures/electronLaunchBudgets.js';
import { expect, test, type IsolatedElectronHarness } from '../../src/fixtures/isolatedElectronTest.js';

type Proof = Pick<ReturnType<typeof createWorkspaceDeletionProof>, 'arm' | 'release' | 'snapshot' | 'waitForShutdown' | 'readFailures'> & {
  beginShutdown(): void;
};
type MainGlobal = typeof globalThis & { __EKY_ELECTRON_E2E__: {
  workspaceDeletionProof: Proof;
  backendIsRunning(): boolean;
} };
type RequestResult = { state: 'pending' | 'completed' | 'failed'; outcome?: string; safeError?: boolean };
type RendererGlobal = typeof globalThis & {
  ekyWorkspaceDeletionProof: { prepareDeletion(input: unknown): Promise<string> };
  deletionProofResult?: RequestResult;
};

test.use({ e2eSelectorProfile: 'empty' });

test.describe('cancelled deletion consent', () => {
  test.use({ e2eDialogMode: 'cancel' });
  test('DESK-DELETE-CANCEL-001 @critical @security keeps the real company running when data-loss consent is declined', async ({ e2eElectron }) => {
    // This scenario uses the existing native adapter's cancel choice.
    await openSyntheticCompany(e2eElectron);
    const before = registryBytes(e2eElectron);
    await startPreparation(e2eElectron);
    await expect.poll(() => readRequest(e2eElectron)).toMatchObject({ state: 'completed', outcome: 'cancelled' });
    expect((await readProof(e2eElectron.electronApp)).backendRunning).toBe(true);
    expect(registryBytes(e2eElectron).equals(before)).toBe(true);
    expect(await e2eElectron.page.evaluate(async () => (await fetch('/health')).status)).toBe(200);
  });
});

for (const [scenario, phase] of [
  ['DESK-DELETE-NATIVE-DRAIN-001', 'confirmation'],
  ['DESK-DELETE-PUBLISH-DRAIN-001', 'publication'],
] as const) {
  test(`${scenario} @critical @security @recovery joins the held ${phase} after the real backend exits`, async ({ e2eElectron }) => {
    const active = await openSyntheticCompany(e2eElectron);
    const before = registryBytes(e2eElectron);
    const marker = createProfileSnapshotRuntimePaths(active.runtimeRoot).recoveryPointCleanShutdownMarkerPath;
    expect(existsSync(marker)).toBe(false);
    await e2eElectron.electronApp.evaluate((_electron, point) => {
      (globalThis as MainGlobal).__EKY_ELECTRON_E2E__.workspaceDeletionProof.arm(point);
    }, phase);
    let firstFailure: { error: unknown } | undefined;
    try {
      await startPreparation(e2eElectron);
      await expect.poll(() => readProof(e2eElectron.electronApp)).toMatchObject({ entered: true, request: 'pending' });
      if (phase === 'publication') {
        expect((await readProof(e2eElectron.electronApp)).backendRunning).toBe(false);
      }
      await e2eElectron.electronApp.evaluate(() => {
        (globalThis as MainGlobal).__EKY_ELECTRON_E2E__.workspaceDeletionProof.beginShutdown();
      });
      await expect.poll(() => readProof(e2eElectron.electronApp)).toMatchObject({ backendRunning: false });
      // The real exclusion endpoint remains owned after backend exit. An early
      // external-main completion would release it while the request is held.
      expect(await reservationIsBusy(e2eElectron.runtime.userDataPath)).toBe(true);
      expect(await readProof(e2eElectron.electronApp)).toMatchObject({ request: 'pending', shutdown: 'pending', published: false });
      expect(existsSync(marker)).toBe(false);
      await releaseHold(e2eElectron.electronApp);
      await expect.poll(() => readRequest(e2eElectron)).toMatchObject({ state: 'failed', safeError: true });
      await e2eElectron.electronApp.evaluate(() =>
        (globalThis as MainGlobal).__EKY_ELECTRON_E2E__.workspaceDeletionProof.waitForShutdown());
      expect(await readProof(e2eElectron.electronApp)).toMatchObject({ shutdown: 'completed', published: false });
      expect(await reservationIsBusy(e2eElectron.runtime.userDataPath)).toBe(false);
      expect(existsSync(marker)).toBe(true);
      expect(registryBytes(e2eElectron).equals(before)).toBe(true);
    } catch (error) { firstFailure = { error }; throw error; }
    finally {
      try { await releaseHold(e2eElectron.electronApp); }
      catch (cleanup) {
        if (firstFailure !== undefined) throw new AggregateError([firstFailure.error, cleanup], 'E2E_DELETION_PROOF_CLEANUP_FAILED', { cause: firstFailure.error });
        throw cleanup;
      }
    }
    await e2eElectron.restart();
    await assertCustomerRetained(e2eElectron);
    expect(registryBytes(e2eElectron).equals(before)).toBe(true);
  });
}

test('DESK-DELETE-PREPARE-001 @critical @security reaches guarded publication without deleting any data', async ({ e2eElectron }) => {
  await openSyntheticCompany(e2eElectron);
  const before = registryBytes(e2eElectron);
  await startPreparation(e2eElectron);
  await expect.poll(() => readRequest(e2eElectron)).toMatchObject({ state: 'completed', outcome: 'prepared' });
  expect(await readProof(e2eElectron.electronApp)).toMatchObject({ backendRunning: false, published: true });
  expect(registryBytes(e2eElectron).equals(before)).toBe(true);
  await e2eElectron.restart();
  await assertCustomerRetained(e2eElectron);
  expect(registryBytes(e2eElectron).equals(before)).toBe(true);
});

for (const changed of [false, true]) {
  const scenario = changed ? 'DESK-DELETE-BACKUP-CHANGED-001' : 'DESK-DELETE-BACKUP-001';
  test(`${scenario} @critical @security @recovery ${changed ? 'rejects a changed encrypted export' : 'verifies the real encrypted export before preparation'}`, async ({ e2eElectron }) => {
    const active = await openSyntheticCompany(e2eElectron);
    const before = registryBytes(e2eElectron);
    await e2eElectron.electronApp.evaluate(() => {
      (globalThis as MainGlobal).__EKY_ELECTRON_E2E__.workspaceDeletionProof.arm('publication');
    });
    let firstFailure: { error: unknown } | undefined;
    try {
      const passwordWindowReady = e2eElectron.electronApp.waitForEvent('window');
      void passwordWindowReady.catch(() => undefined);
      await startPreparation(e2eElectron, 'createBackup');
      const passwordWindow = await passwordWindowReady;
      await passwordWindow.locator('#password').fill('Synthetic deletion backup 2026!');
      await passwordWindow.locator('#confirmation').fill('Synthetic deletion backup 2026!');
      const passwordClosed = passwordWindow.waitForEvent('close');
      await passwordWindow.locator('#submit').click();
      await passwordClosed;
      await expect.poll(() => readProof(e2eElectron.electronApp)).toMatchObject({ entered: true, request: 'pending', backendRunning: false });
      const backupPath = workspaceDeletionProofBackupPath(e2eElectron.runtime.supportBundlePath);
      const original = readFileSync(backupPath);
      const digest = createHash('sha256').update(original).digest('hex');
      // This decrypts only the test-owned export; production inspection and its
      // source/export receipts already ran before the publication hold.
      const payloadPath = join(dirname(backupPath), 'deletion-backup.payload');
      const decrypted = await decryptBackupPayload({ containerPath: backupPath,
        password: 'Synthetic deletion backup 2026!', quarantinePath: payloadPath });
      expect(decrypted.containerSha256).toBe(digest);
      const content = await readDecryptedBackupPayload(payloadPath);
      expect(content.manifest.profileId).toBe(active.profileId);
      expect(content.entries.filter(entry => entry.type === 'database')).toHaveLength(1);
      expect(content.entries.some(entry => entry.type === 'artifactCatalog')).toBe(true);
      if (changed) {
        const altered = Buffer.from(original);
        altered[altered.length - 1] = altered[altered.length - 1]! ^ 1;
        // The real export is read-only; fault injection may alter only this
        // already-authenticated, test-owned destination, never the source DB.
        chmodSync(backupPath, 0o600);
        writeFileSync(backupPath, altered);
      }
      await releaseHold(e2eElectron.electronApp);
      await expect.poll(() => readRequest(e2eElectron)).toMatchObject(changed
        ? { state: 'failed', safeError: true } : { state: 'completed', outcome: 'prepared' });
      expect((await readProof(e2eElectron.electronApp)).published).toBe(!changed);
      if (changed) {
        const messages = await e2eElectron.electronApp.evaluate(() =>
          (globalThis as MainGlobal).__EKY_ELECTRON_E2E__.workspaceDeletionProof.readFailures()
            .request?.chain.map(entry => entry.message));
        expect(messages).toContain('WORKSPACE_DELETE_BACKUP_UNAVAILABLE');
      }
      expect(registryBytes(e2eElectron).equals(before)).toBe(true);
      if (!changed) expect(readFileSync(backupPath).equals(original)).toBe(true);
      await e2eElectron.restart();
      await assertCustomerRetained(e2eElectron);
      expect(registryBytes(e2eElectron).equals(before)).toBe(true);
      if (!changed) expect(readFileSync(backupPath).equals(original)).toBe(true);
    } catch (error) { firstFailure = { error }; throw error; }
    finally {
      try { await releaseHold(e2eElectron.electronApp); }
      catch (cleanup) {
        if (firstFailure !== undefined) throw new AggregateError([firstFailure.error, cleanup], 'E2E_DELETION_PROOF_CLEANUP_FAILED', { cause: firstFailure.error });
        throw cleanup;
      }
    }
  });
}

async function openSyntheticCompany(harness: IsolatedElectronHarness) {
  const label = 'Synthetic deletion preparation';
  await expect(harness.page.getByRole('heading', { name: 'Yritykset', exact: true })).toBeVisible();
  await harness.page.getByRole('button', { name: 'Lisää yritys Ekyyn' }).click();
  await harness.page.getByRole('textbox', { name: 'Yrityksen nimi' }).fill(label);
  await harness.performRelaunchingOperation(async () => {
    await harness.page.getByRole('button', { name: 'Luo yritys', exact: true }).click();
  });
  await expect(harness.page.getByText(label, { exact: true })).toBeVisible();
  await harness.page.getByRole('button', { name: 'Avaa yritys', exact: true }).click();
  await harness.performRelaunchingOperation(async () => {
    await harness.page.getByRole('button', { name: 'Vaihda yritys', exact: true }).click();
  });
  await expect(harness.page.getByRole('button', {
    name: `Vaihda yritystä. Aktiivinen yritys: ${label}`, exact: true,
  })).toBeVisible();
  expect(await harness.page.evaluate(async data => (await fetch('/customers', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  })).status, createSyntheticCustomerInput({ customerNumber: 'DELETE-PROOF-1' }))).toBe(201);
  return readElectronE2eActiveWorkspace(harness.runtime.userDataPath);
}

async function startPreparation(harness: IsolatedElectronHarness,
  backupChoice: 'createBackup' | 'explicitDataLoss' = 'explicitDataLoss'): Promise<void> {
  await harness.page.evaluate(async choice => {
    const target = globalThis as RendererGlobal;
    const desktop = (globalThis as unknown as { ekyDesktop: { getWorkspaceManagementStatus(): Promise<{
      activeWorkspaceId: string; workspaces: Array<{ workspaceId: string; workspaceLabel: string }>;
    }> } }).ekyDesktop;
    const status = await desktop.getWorkspaceManagementStatus();
    const active = status.workspaces.find(entry => entry.workspaceId === status.activeWorkspaceId);
    if (active === undefined) throw new Error('E2E_DELETION_TARGET_MISSING');
    target.deletionProofResult = { state: 'pending' };
    void target.ekyWorkspaceDeletionProof.prepareDeletion({ formatVersion: 1,
      workspaceId: active.workspaceId, typedLabel: active.workspaceLabel, backupChoice: choice }).then(
      outcome => { target.deletionProofResult = { state: 'completed', outcome }; },
      error => { target.deletionProofResult = { state: 'failed',
        safeError: error instanceof Error && error.message.includes('E2E_WORKSPACE_DELETION_PREPARATION_FAILED') }; },
    );
  }, backupChoice);
}

function readRequest(harness: IsolatedElectronHarness) {
  return harness.page.evaluate(() => (globalThis as RendererGlobal).deletionProofResult);
}

function readProof(application: ElectronApplication) {
  return application.evaluate(() => {
    const owner = (globalThis as MainGlobal).__EKY_ELECTRON_E2E__;
    return { ...owner.workspaceDeletionProof.snapshot(), backendRunning: owner.backendIsRunning() };
  });
}

function releaseHold(application: ElectronApplication) {
  return application.evaluate(() => (globalThis as MainGlobal).__EKY_ELECTRON_E2E__.workspaceDeletionProof.release());
}

function registryBytes(harness: IsolatedElectronHarness): Buffer {
  return readFileSync(join(harness.runtime.userDataPath, WORKSPACE_REGISTRY_FILE_NAME));
}

async function reservationIsBusy(userDataRoot: string): Promise<boolean> {
  let acquired: Awaited<ReturnType<typeof acquireWorkspaceProcessReservation>> | undefined;
  try {
    acquired = await acquireWorkspaceProcessReservation({ userDataRoot,
      signal: AbortSignal.timeout(ELECTRON_E2E_PROCESS_CONNECT_TIMEOUT_MILLISECONDS) });
    return false;
  } catch (error) {
    if (error instanceof WorkspaceProcessReservationError && error.reason === 'busy' && !error.cleanupFailed) return true;
    throw error;
  } finally { await acquired?.release(); }
}

async function assertCustomerRetained(harness: IsolatedElectronHarness): Promise<void> {
  const result = await harness.page.evaluate(async () => {
    const response = await fetch('/customers'); return { status: response.status, text: await response.text() };
  });
  expect(result.status).toBe(200);
  expect(result.text).toContain('DELETE-PROOF-1');
}
