import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

import type { IpcMainInvokeEvent } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceManagementCapability } from '../src/workspaces/management/workspaceManagementCapability.js';
import type { WorkspaceDeletionPreparationLifetime, WorkspaceDeletionPreparationOutcome } from '../src/workspaces/management/workspaceManagementTypes.js';
import { readSelectorTestRelease, usesSelectorTestBackend } from './electronSelectorTestRelease.js';
import type { ElectronE2eConfig } from './electronE2eConfig.js';
import { createElectronE2eNativeAdapters, workspaceDeletionProofBackupPath } from './electronE2eNativeAdapters.js';
import { createWorkspaceDeletionProof } from './workspaceDeletionProof.js';
import { isWorkspaceDeletionProofScenario, workspaceDeletionProofChannel,
  workspaceDeletionProofPreload, workspaceDeletionProofScenarioIds,
  workspaceDeletionBackupProofScenarioIds } from './workspaceDeletionProofProtocol.js';

const request = { formatVersion: 1, workspaceId: '11111111-1111-4111-8111-111111111111',
  typedLabel: 'Synthetic deletion proof', backupChoice: 'explicitDataLoss' };
const fixtures: ReturnType<typeof fixture>[] = [];
const work: Promise<unknown>[] = [];

afterEach(async () => {
  for (const f of fixtures) { f.proof.release(); f.proof.closeChannel(); }
  await Promise.allSettled(work.splice(0));
  await Promise.all(fixtures.splice(0).map(f => f.capability.shutdown()));
});

describe('W7.3 E2E-only preparation assembly', () => {
  it.each(workspaceDeletionBackupProofScenarioIds)('selects only the owned encrypted export for %s', async scenarioId => {
    await withNativeFixture(scenarioId, async (adapter, config) => {
      const selected = await adapter.showSaveDialog({} as never, backupSaveOptions);
      expect(selected).toEqual({ canceled: false, filePath: workspaceDeletionProofBackupPath(config.paths.supportBundlePath) });
      expect(adapter.snapshot().saveDialogCount).toBe(1);
      expect(JSON.parse(readFileSync(config.paths.observationsPath, 'utf8').trim())).toEqual({ operation: 'showSaveDialog' });
    });
  });

  it('rejects other save purposes in the named backup proof before recording or returning a path', async () => {
    await withNativeFixture('DESK-DELETE-BACKUP-001', async (adapter, config) => {
      for (const options of [{}, { ...backupSaveOptions, title: 'Other' },
        { ...backupSaveOptions, filters: [{ name: 'Other', extensions: ['zip'] }] },
        { ...backupSaveOptions, defaultPath: 'other.zip' }]) {
        await expect(adapter.showSaveDialog({} as never, options)).rejects.toThrow('ELECTRON_E2E_SAVE_DIALOG_REJECTED');
      }
      expect(adapter.snapshot().saveDialogCount).toBe(0);
    });
  });

  it('keeps the ordinary support target unchanged for a non-backup scenario', async () => {
    await withNativeFixture('DESK-RESTART-001', async (adapter, config) => {
      expect(await adapter.showSaveDialog({} as never, {})).toEqual({ canceled: false, filePath: config.paths.supportBundlePath });
    });
  });

  it.each(workspaceDeletionProofScenarioIds)('opts only %s into the real backend and copied-preload bridge', scenario => {
    expect(isWorkspaceDeletionProofScenario(scenario)).toBe(true);
    expect(usesSelectorTestBackend(scenario)).toBe(true);
    expect(readSelectorTestRelease(scenario)?.appVersion).toBe('0.2.0');
    const invoke = vi.fn(async () => 'cancelled');
    const exposed = new Map<string, Record<string, (...args: unknown[]) => unknown>>();
    runInNewContext(workspaceDeletionProofPreload(scenario), { require: (name: string) => {
      expect(name).toBe('electron');
      return { contextBridge: { exposeInMainWorld: (key: string, value: Record<string, (...args: unknown[]) => unknown>) => {
        exposed.set(key, value);
      } }, ipcRenderer: { invoke } };
    } });
    expect([...exposed.keys()]).toEqual(['ekyWorkspaceDeletionProof']);
    const api = exposed.get('ekyWorkspaceDeletionProof')!;
    expect(Object.keys(api)).toEqual(['prepareDeletion']);
    expect(Object.isFrozen(api)).toBe(true);
    void api.prepareDeletion!(request, 'extra');
    expect(invoke).toHaveBeenCalledExactlyOnceWith(workspaceDeletionProofChannel, request, 'extra');
  });

  it.each(['DESK-RESTART-001', 'DESK-SELECTOR-CREATE-001', 'DESK-DELETE-NATIVE-DRAIN-002', ''])
    ('does not install a preload bridge for %s', scenario => {
      expect(workspaceDeletionProofPreload(scenario)).toBe('');
      expect(() => createWorkspaceDeletionProof({ scenarioId: scenario, ipcMain: {} as never,
        showMessageBox: vi.fn(), sessionSecret: 'synthetic' })).toThrow('E2E_WORKSPACE_DELETION_SCENARIO_INVALID');
    });

  it('registers only after the actual capability exists and preserves its strict parsing', async () => {
    const f = fixture();
    expect(() => f.proof.register()).toThrow('E2E_WORKSPACE_DELETION_REGISTRATION_INVALID');
    f.install();
    expect(() => f.proof.register()).toThrow('E2E_WORKSPACE_DELETION_REGISTRATION_INVALID');
    expect(() => f.proof.createCapability(f.options)).toThrow('E2E_WORKSPACE_DELETION_CAPABILITY_REUSED');
    await expect(track(f.invoke(f.event, request, 'extra'))).rejects.toThrow('E2E_WORKSPACE_DELETION_PREPARATION_FAILED');
    expect(f.prepare).not.toHaveBeenCalled();
    await expect(track(f.invoke(f.event, { ...request, path: 'not accepted' }))).rejects.toThrow('E2E_WORKSPACE_DELETION_PREPARATION_FAILED');
    expect(f.prepare).not.toHaveBeenCalled();
    await expect(track(f.invoke(f.event, request))).resolves.toBe('cancelled');
    expect(f.prepare).toHaveBeenCalledOnce();
    expect(f.prepare.mock.calls[0]![0]).toEqual(request);
    expect(Object.isFrozen(f.prepare.mock.calls[0]![0])).toBe(true);
  });

  it.each(['sender', 'frame', 'navigation'] as const)('does not replace a forbidden %s with the main window identity', async invalid => {
    const f = fixture(); f.install();
    let event = f.event;
    if (invalid === 'sender') event = { ...event, sender: {} } as IpcMainInvokeEvent;
    if (invalid === 'frame') event = { ...event, senderFrame: {} } as IpcMainInvokeEvent;
    if (invalid === 'navigation') {
      f.prepare.mockImplementationOnce(async (_request, lifetime) => {
        f.webContents.emit('did-start-loading'); lifetime.assertCurrent(); return 'prepared';
      });
    }
    await expect(track(f.invoke(event, request))).rejects.toThrow('E2E_WORKSPACE_DELETION_PREPARATION_FAILED');
    if (invalid !== 'navigation') expect(f.prepare).not.toHaveBeenCalled();
    expect(f.proof.snapshot().published).toBe(false);
  });

  it('removes transport without independently draining or mutating the production capability', async () => {
    const f = fixture(); f.install();
    f.proof.closeChannel();
    expect(f.handlers.has(workspaceDeletionProofChannel)).toBe(false);
    await expect(track(f.capability.prepareDeletion(f.event, request))).resolves.toBe('cancelled');
    await expect(track(f.invoke(f.event, request))).rejects.toThrow('E2E_WORKSPACE_DELETION_UNAVAILABLE');
    expect(() => f.proof.register()).toThrow('E2E_WORKSPACE_DELETION_REGISTRATION_INVALID');
  });

  it('forwards the real lifecycle shutdown without settling a held request on its behalf', async () => {
    const f = fixture(); f.install(); f.proof.arm('confirmation');
    f.prepare.mockImplementationOnce(async () => {
      await f.proof.showMessageBox(undefined, { title: 'Poisto ilman varmuuskopiota', message: 'Synthetic confirmation' });
      return 'cancelled';
    });
    const pending = track(f.invoke(f.event, request));
    await vi.waitFor(() => expect(f.proof.snapshot().entered).toBe(true));
    const shutdown = vi.fn(() => f.capability.shutdown());
    f.proof.beginShutdown({ shutdown });
    await Promise.resolve();
    expect(shutdown).toHaveBeenCalledOnce();
    expect(f.proof.snapshot()).toMatchObject({ request: 'pending', shutdown: 'pending', registered: false });
    expect(() => f.proof.beginShutdown({ shutdown })).toThrow('E2E_WORKSPACE_DELETION_SHUTDOWN_REUSED');
    f.proof.release();
    await expect(pending).rejects.toThrow('E2E_WORKSPACE_DELETION_PREPARATION_FAILED');
    await f.proof.waitForShutdown();
    expect(f.proof.snapshot()).toMatchObject({ request: 'failed', shutdown: 'completed' });
  });

  it('rechecks publication authority after a hold and never supplies a deletion-completed result', async () => {
    const f = fixture(); f.install(); f.proof.arm('publication');
    let active = true;
    const guard = () => { if (!active) throw new Error('SYNTHETIC_AUTHORITY_REVOKED'); };
    const selection = vi.fn(async () => { guard(); });
    const pending = track(f.proof.publish(guard, selection, {} as never));
    await vi.waitFor(() => expect(f.proof.snapshot().entered).toBe(true));
    active = false; f.proof.release();
    await expect(pending).rejects.toThrow('SYNTHETIC_AUTHORITY_REVOKED');
    expect(selection).toHaveBeenCalledOnce();
    expect(f.proof.snapshot().published).toBe(false);
  });

  it('retains the bounded original cause before the safe IPC error and redacts the current session', async () => {
    const f = fixture(); f.install();
    const original = new Error(`SYNTHETIC_FIRST ${f.secret}`, { cause: new Error('SYNTHETIC_CAUSE') });
    f.prepare.mockRejectedValueOnce(original);
    await expect(track(f.invoke(f.event, request))).rejects.toThrow('E2E_WORKSPACE_DELETION_PREPARATION_FAILED');
    const failure = f.proof.readFailures().request;
    expect(failure?.chain[0]?.message).toBe('WORKSPACE_MANAGEMENT_CAPABILITY_FAILED');
    expect(failure?.chain[1]?.message).toBe('SYNTHETIC_FIRST [redacted]');
    expect(failure?.chain[2]?.message).toBe('SYNTHETIC_CAUSE');
    expect(failure?.chain[1]?.stack?.includes('workspaceDeletionProof.test.ts')).toBe(true);
    expect(JSON.stringify(failure).includes(f.secret)).toBe(false);
    f.prepare.mockRejectedValueOnce(new Error('SYNTHETIC_LATER'));
    await expect(track(f.invoke(f.event, request))).rejects.toThrow('E2E_WORKSPACE_DELETION_PREPARATION_FAILED');
    expect(f.proof.readFailures().request).toEqual(failure);
  });

  it('keeps a later shutdown cause separate from the expected revoked-request failure', async () => {
    const f = fixture(); f.install();
    f.prepare.mockRejectedValueOnce(new Error('SYNTHETIC_REQUEST_REVOKED'));
    await expect(track(f.invoke(f.event, request))).rejects.toThrow('E2E_WORKSPACE_DELETION_PREPARATION_FAILED');
    const shutdownError = new Error('SYNTHETIC_SHUTDOWN_FAILURE', { cause: new Error('SYNTHETIC_SHUTDOWN_CAUSE') });
    f.proof.beginShutdown({ async shutdown() { throw shutdownError; } });
    await expect(track(f.proof.waitForShutdown())).rejects.toBe(shutdownError);
    const failures = f.proof.readFailures();
    expect(failures.request?.chain.some(part => part.message === 'SYNTHETIC_REQUEST_REVOKED')).toBe(true);
    expect(failures.shutdown?.chain[0]?.message).toBe('SYNTHETIC_SHUTDOWN_FAILURE');
    expect(failures.shutdown?.chain[1]?.message).toBe('SYNTHETIC_SHUTDOWN_CAUSE');
  });
});

const backupSaveOptions = { title: 'Tallenna salattu Eky-varmuuskopio',
  defaultPath: 'synthetic.ekybackup', filters: [{ name: 'Salattu Eky-varmuuskopio', extensions: ['ekybackup'] }] };

async function withNativeFixture(scenarioId: string,
  run: (adapter: ReturnType<typeof createElectronE2eNativeAdapters>, config: ElectronE2eConfig) => Promise<void>) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'eky-deletion-native-')));
  const config: ElectronE2eConfig = {
    backend: { configPath: join(root, 'backend.json'), port: 12345, sessionSecret: 's'.repeat(43) },
    dialogMode: 'accept', formatVersion: 2, marker: 'EKY_E2E',
    nativeOpenDialog: { mode: 'accept', purpose: 'invoicePdfArchive' },
    paths: { applicationPath: root, invoicePdfArchiveDirectoryPath: root,
      observationsPath: join(root, 'observations.jsonl'), resourcesPath: root,
      supportBundlePath: join(root, 'support.zip'), userDataPath: root, workspaceBackupPath: null },
    relaunchMode: 'playwrightManaged', runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
    runtimeRoot: root, scenarioId, startupMode: 'normal',
  };
  await run(createElectronE2eNativeAdapters(config), config);
  rmSync(root, { recursive: true });
}

function track<T>(promise: Promise<T>): Promise<T> {
  work.push(promise); void promise.catch(() => undefined); return promise;
}

function fixture() {
  const secret = 's'.repeat(43);
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>();
  const ipcMain = { handle: (channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>) => {
    handlers.set(channel, handler);
  }, removeHandler: (channel: string) => { handlers.delete(channel); } };
  const proof = createWorkspaceDeletionProof({ scenarioId: 'DESK-DELETE-PREPARE-001',
    ipcMain: ipcMain as never, sessionSecret: secret,
    showMessageBox: async () => ({ response: 1, checkboxChecked: false }) });
  const webContents = Object.assign(new EventEmitter(), { mainFrame: {}, isDestroyed: () => false });
  const mainWindow = Object.assign(new EventEmitter(), { webContents, isDestroyed: () => false });
  const event = { sender: webContents, senderFrame: webContents.mainFrame } as unknown as IpcMainInvokeEvent;
  const unused = async (): Promise<never> => { throw new Error('UNEXPECTED_FIXTURE_OPERATION'); };
  const prepare = vi.fn(async (_request: unknown, _lifetime: WorkspaceDeletionPreparationLifetime): Promise<WorkspaceDeletionPreparationOutcome> => 'cancelled');
  const options: Parameters<typeof proof.createCapability>[0] = {
    ipcMain: ipcMain as never, mainWindow: mainWindow as never, passwordWindow: { requestPassword: unused },
    confirmActiveWorkspaceReplacement: unused, selectBackupSource: unused,
    selectReplacementBackupSource: unused, showSafeError() {},
    service: { createEmpty: unused, getStatus: unused, importBackupAsNew: unused, rename: unused,
      replaceActiveFromBackup: unused, switchTo: unused, prepareDeletion: prepare },
  };
  const f = { secret, proof, options, prepare, event, webContents, handlers,
    capability: undefined as unknown as WorkspaceManagementCapability,
    invoke: undefined as unknown as (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>,
    install() {
      f.capability = proof.createCapability(options);
      proof.register(); f.invoke = handlers.get(workspaceDeletionProofChannel)!;
      fixtures.push(f);
    },
  };
  return f;
}
