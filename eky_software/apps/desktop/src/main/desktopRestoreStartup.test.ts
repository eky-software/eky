import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProfileSnapshotBrokerClient } from '../profileBackup/profileSnapshotBrokerClient.js';
import { createProfileSnapshotRuntimePaths } from '../profileBackup/profileSnapshotRuntimePaths.js';
import { RecoveryPointScheduler } from '../profileBackup/recoveryPoint/recoveryPointScheduler.js';
import { RecoveryPointCleanShutdownMarker } from '../profileBackup/recoveryPoint/recoveryPointCleanShutdownMarker.js';
import { BackendShutdownExitError, type BackendShutdownOutcome } from '../runtime/backendShutdown.js';
import { startDesktopBackend, type StartDesktopBackendOptions } from '../runtime/backendProcess.js';
import { DesktopBackendStartupError } from '../runtime/backendStartupFailure.js';
import {
  createWorkspaceCandidateCompletedStatus,
  createWorkspaceCandidateFailedStatus,
  createWorkspaceCandidateReadyStatus,
  createWorkspaceCandidateReservationReadyStatus,
  parseWorkspaceCandidateProcessCommand,
} from '../runtime/workspaceCandidateMessages.js';
import { AcceptedBuildMetadataStore } from '../update/acceptedBuildMetadataStore.js';
import { createLocalUpdateRuntimePaths } from '../update/localUpdateRuntimePaths.js';
import { LocalUpdatePackageCache } from '../update/localUpdatePackageCache.js';
import * as updateFoundation from '../update/localUpdateFoundationComposition.js';
import * as profileProtection from '../update/profileProtectionComposition.js';
import * as updateObservation from '../update/updateOperationalObserver.js';
import { launchWindowsInstallerForUpdate } from '../update/windowsInstallerHandoff.js';
import { UpdateJournalStore } from '../update/updateJournalStore.js';
import { ProfileRestoreActivationJournalStore } from '../profileBackup/restore/profileRestoreActivationJournalStore.js';
import { ProfileRestoreActivationTransaction } from '../profileBackup/restore/profileRestoreActivationTransaction.js';
import { createDesktopProfilePaths } from '../runtime/desktopProfilePaths.js';
import { createTestJournal } from '../workspaces/creation/emptyWorkspaceCreationTestSupport.js';
import { createWorkspaceCreationJournalPaths, WORKSPACE_CREATION_JOURNAL_FILE_NAME } from '../workspaces/creation/workspaceCreationJournalPaths.js';
import { WorkspaceCreationJournalStore } from '../workspaces/creation/workspaceCreationJournalStore.js';
import { deriveWorkspaceCreationPaths } from '../workspaces/creation/workspaceCreationPaths.js';
import { createWorkspaceBackupImportJournalPaths, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME } from '../workspaces/import/workspaceBackupImportJournalPaths.js';
import { WorkspaceBackupImportJournalStore } from '../workspaces/import/workspaceBackupImportJournalStore.js';
import { deriveWorkspaceBackupImportPaths } from '../workspaces/import/workspaceBackupImportPaths.js';
import { createTestImportJournal } from '../workspaces/import/workspaceBackupImportTestSupport.js';
import { WorkspaceBackupPlaintextQuarantine } from '../workspaces/import/workspaceBackupPlaintextQuarantine.js';
import { deriveWorkspaceRoot } from '../workspaces/registry/deriveWorkspaceRoot.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../workspaces/registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../workspaces/registry/workspaceRegistryStore.js';
import { validateWorkspaceId } from '../workspaces/registry/workspaceIdValidation.js';
import { deriveWorkspaceBackupReplacementRuntimePaths } from '../workspaces/replacement/workspaceBackupReplacementPaths.js';
import { WorkspaceSwitchJournalStore } from '../workspaces/switch/workspaceSwitchJournal.js';
import { startDesktopComposition, type StartDesktopCompositionOptions } from './desktopComposition.js';
import { BackendRequestQuiescence } from './backendRequestQuiescence.js';

const electronBoundary = vi.hoisted(() => ({
  fetch: vi.fn(),
  createWindow: vi.fn(),
  fork: vi.fn(),
  removeHandler: vi.fn(),
  portClosed: vi.fn(),
  reservationReleased: vi.fn(),
}));

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class Port extends EventEmitter {
    start() {}
    postMessage() {}
    close() {
      electronBoundary.portClosed();
      this.emit('close');
    }
  }
  return {
    BrowserWindow: class {},
    MessageChannelMain: class {
      port1 = new Port();
      port2 = new Port();
    },
    dialog: {},
    ipcMain: { handle: vi.fn(), removeHandler: electronBoundary.removeHandler },
    net: { fetch: electronBoundary.fetch },
    safeStorage: {},
    session: { defaultSession: {} },
    shell: {},
    utilityProcess: { fork: electronBoundary.fork },
  };
});
vi.mock('./applicationProtocol.js', () => ({
  registerApplicationProtocol: vi.fn(),
}));
vi.mock('../security/electronPermissionPolicy.js', () => ({
  registerElectronPermissionPolicy: vi.fn(),
}));
vi.mock('./applicationWindow.js', () => ({
  createApplicationWindow: electronBoundary.createWindow,
  loadApplicationWindow: vi.fn(async () => undefined),
}));
vi.mock('../update/windowsInstallerHandoff.js', () => ({
  launchWindowsInstallerForUpdate: vi.fn(async () => undefined),
}));
vi.mock('../runtime/workspaceProcessReservation.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../runtime/workspaceProcessReservation.js')>(),
  readWorkspaceProcessReservationIdentity: async () => 'a'.repeat(64),
  async acquireWorkspaceProcessReservation() {
    const released = new AbortController();
    return {
      identity: 'a'.repeat(64), invalidated: released.signal,
      async assertOwned() { if (released.signal.aborted) throw new Error('synthetic reservation released'); },
      async release() { electronBoundary.reservationReleased(); released.abort(); },
    };
  },
}));

const roots: string[] = [];
const clients: ProfileSnapshotBrokerClient[] = [];
const workspaceId = validateWorkspaceId('11111111-1111-4111-8111-111111111111');
const operationId = '22222222-2222-4222-8222-222222222222';
const originalProfileId = 'a'.repeat(64);
const foreignProfileId = 'b'.repeat(64);
const windowBoundary = 'DESKTOP_SMOKE_TEST_WINDOW_BOUNDARY';

beforeEach(() => {
  electronBoundary.reservationReleased.mockReset();
  electronBoundary.removeHandler.mockReset();
  electronBoundary.portClosed.mockReset();
  vi.mocked(launchWindowsInstallerForUpdate).mockClear();
  electronBoundary.fork.mockReset();
  electronBoundary.fetch.mockReset().mockImplementation(async () =>
    new Response(JSON.stringify({ status: 'ok' })),
  );
  // Stop at the real business-window boundary; this is not an Electron UI test.
  electronBoundary.createWindow.mockReset().mockImplementation(() => {
    throw new Error(windowBoundary);
  });
  vi.spyOn(ProfileSnapshotBrokerClient.prototype, 'waitUntilReady')
    .mockImplementation(async function (this: ProfileSnapshotBrokerClient) {
      clients.push(this);
    });
  vi.spyOn(ProfileSnapshotBrokerClient.prototype, 'getStatus')
    .mockResolvedValue('normal');
  vi.spyOn(RecoveryPointScheduler.prototype, 'start').mockResolvedValue('clean');
  vi.spyOn(RecoveryPointScheduler.prototype, 'stopChecks').mockResolvedValue();
});

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe('desktop restore startup composition', () => {
  it.each(['WORKSPACE_PROCESS_RESERVATION_FAILED', 'BACKEND_PROCESS_RESERVATION_FAILED'])(
    'preserves %s through real composition logging without starting recovery', async code => {
      const fixture = await createFixture(originalProfileId, {
        async inspectBackendStartup() {
          throw new DesktopBackendStartupError('BACKEND_PROCESS_RESERVATION_FAILED', {
            processState: 'unknown', migrationGateSettled: true, reservationReclaimed: false,
          });
        },
      });
      if (code === 'WORKSPACE_PROCESS_RESERVATION_FAILED') {
        fixture.assertSingleInstanceOwnership.mockImplementation(() => { throw new Error(code); });
      }
      await expect(fixture.start()).rejects.toThrow(code);
      expect(fixture.relaunch).not.toHaveBeenCalled();
      expect(electronBoundary.createWindow).not.toHaveBeenCalled();
      await fixture.assertPendingRestoreRetained();
      expect(electronBoundary.reservationReleased).not.toHaveBeenCalled();
      const directory = join(fixture.root, 'runtime', 'logs', 'desktop');
      const events = [];
      for (const file of await readdir(directory)) {
        for (const line of (await readFile(join(directory, file), 'utf8')).trim().split('\n')) {
          events.push(JSON.parse(line));
        }
      }
      expect(events).toContainEqual(expect.objectContaining({
        eventName: 'desktop.bootstrapFailed', errorCode: code, sideEffectState: 'unknown',
        stage: 'startup', retryable: false,
      }));
      expect(JSON.stringify(events)).not.toContain(fixture.root);
      expect(JSON.stringify(events)).not.toContain('d'.repeat(64));
      const incidentRoot = join(fixture.root, 'runtime', 'logs', 'incident-index');
      const incidents = [];
      for (const file of await readdir(incidentRoot)) {
        for (const line of (await readFile(join(incidentRoot, file), 'utf8')).trim().split('\n')) {
          incidents.push(JSON.parse(line));
        }
      }
      expect(incidents).toContainEqual(expect.objectContaining({
        eventName: 'desktop.bootstrapFailed', errorCode: code,
        fingerprint: `desktop.bootstrapFailed:${code}`,
      }));
      expect(JSON.stringify(incidents)).not.toContain(fixture.root);
      expect(JSON.stringify(incidents)).not.toMatch(/runtimeInstanceId|correlationId|operationId/u);
    },
  );

  it.each(['observedExit', 'uncertainFork'] as const)(
    'consumes real startup ownership and preserves the safe log (%s)', async (mode) => {
      const process = new EventEmitter();
      const kill = vi.fn(() => { process.emit('exit', 1); return true; });
      const postMessage = vi.fn(message => {
        if (message.type === 'prepare') {
          process.emit('message', { type: 'reservationReady', reservation: message.reservation });
        }
        if (message.type === 'start') {
          process.emit('message', { type: 'failed', code: 'BACKEND_MODULE_IMPORT_FAILED' });
        }
      });
      electronBoundary.fork.mockImplementation(() => {
        if (mode === 'uncertainFork') throw new Error('synthetic-private-fork-detail');
        queueMicrotask(() => process.emit('spawn'));
        return Object.assign(process, { kill, postMessage });
      });
      const fixture = await createFixture(originalProfileId, {
        replacementTarget: true, realBackend: true,
      });
      if (mode === 'observedExit') {
        await expect(fixture.start()).resolves.toBeUndefined();
        expect(kill).toHaveBeenCalledOnce();
        expect(fixture.relaunch).toHaveBeenCalledOnce();
        const logDirectory = join(fixture.root, 'runtime', 'logs', 'desktop');
        const records: { eventName: string; errorCode?: string }[] = [];
        for (const file of await readdir(logDirectory)) {
          const lines = (await readFile(join(logDirectory, file), 'utf8')).trim().split('\n');
          for (const line of lines) records.push(JSON.parse(line));
        }
        expect(records).toContainEqual(expect.objectContaining({
          eventName: 'backendProcess.healthFailed', errorCode: 'BACKEND_MODULE_IMPORT_FAILED',
        }));
        expect(records.some(record => record.eventName === 'backendProcess.started')).toBe(false);
      } else {
        await expect(fixture.start()).rejects.toThrow('DESKTOP_START_FAILED');
        expect(kill).not.toHaveBeenCalled();
        expect(fixture.relaunch).not.toHaveBeenCalled();
        await fixture.assertPendingRestoreRetained();
      }
      expect(electronBoundary.createWindow).not.toHaveBeenCalled();
    },
  );

  it.each(['unknownExit', 'pendingGate', 'reservationNotReclaimed', 'unclassified'] as const)(
    'retains pending restore, switch and profile files when startup ownership is %s', async (failureKind) => {
      const fixture = await createFixture(originalProfileId, {
        replacementTarget: true,
        async inspectBackendStartup() {
          if (failureKind === 'unclassified') throw new Error('BACKEND_READINESS_TIMEOUT');
          throw new DesktopBackendStartupError('BACKEND_READINESS_TIMEOUT', {
            processState: failureKind === 'unknownExit' ? 'unknown' : 'absent',
            migrationGateSettled: failureKind !== 'pendingGate',
            reservationReclaimed: failureKind !== 'reservationNotReclaimed',
          });
        },
      });

      await expect(fixture.start()).rejects.toThrow('BACKEND_READINESS_TIMEOUT');
      expect(fixture.stop).not.toHaveBeenCalled();
      expect(fixture.events).toEqual(['backendStarted']);
      expect(fixture.relaunch).not.toHaveBeenCalled();
      expect(electronBoundary.createWindow).not.toHaveBeenCalled();
      await fixture.assertPendingRestoreRetained();
    },
  );

  it.each([false, true])('retains reclaimed ownership when the real startup callback outlives its deadline (broker failure: %s)', async brokerFailure => {
    const callbackStoppedBackend = createCompletionGate();
    const releaseCallback = createCompletionGate();
    const callbackSettled = createCompletionGate();
    if (brokerFailure) vi.spyOn(ProfileSnapshotBrokerClient.prototype, 'close')
      .mockImplementationOnce(() => { throw new Error('synthetic cleanup failure'); });
    const originalSetTimeout = globalThis.setTimeout;
    let expireMigration: (() => void) | undefined;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, timeout, ...args) => {
      if (timeout === 5 * 60_000) expireMigration = () => callback(...args);
      return originalSetTimeout(callback, timeout, ...args);
    });
    const child = new EventEmitter();
    const postMessage = vi.fn(message => {
      if (message.type === 'prepare') child.emit('message', { type: 'reservationReady', reservation: message.reservation });
      if (message.type === 'start') child.emit('message', {
        type: 'migrationGateReady', inspection: {
          appliedMigrationCount: 1, migrationChainIdentity: 'c'.repeat(64),
          pendingMigrationCount: 0, profileState: 'existing',
        },
      });
      if (message.type === 'shutdown') child.emit('exit', 0);
    });
    electronBoundary.fork.mockImplementation(() => {
      queueMicrotask(() => child.emit('spawn'));
      return Object.assign(child, { postMessage, kill: vi.fn() });
    });
    const fixture = await createFixture(originalProfileId, {
      replacementTarget: true, realBackend: true,
      async beforeMigrations(_inspection, control) {
        await control.stopStartupRuntime();
        callbackStoppedBackend.resolve();
        await releaseCallback.promise;
        callbackSettled.resolve();
      },
    });
    const observed = fixture.start().then(() => undefined, (error: unknown) => error);
    try {
      await callbackStoppedBackend.promise;
      expect(electronBoundary.reservationReleased).toHaveBeenCalledOnce();
      expect(expireMigration).toBeDefined();
      expireMigration!();
      expect(await observed).toMatchObject({ message: 'BACKEND_READINESS_TIMEOUT' });
      expect(electronBoundary.reservationReleased).toHaveBeenCalledOnce();
      expect(fixture.relaunch).not.toHaveBeenCalled();
      expect(electronBoundary.createWindow).not.toHaveBeenCalled();
      expect(electronBoundary.portClosed.mock.calls.length).toBeGreaterThanOrEqual(2);
      await fixture.assertPendingRestoreRetained();
      releaseCallback.resolve();
      await callbackSettled.promise;
      expect(electronBoundary.reservationReleased).toHaveBeenCalledOnce();
      expect(fixture.relaunch).not.toHaveBeenCalled();
      await fixture.assertPendingRestoreRetained();
    } finally {
      releaseCallback.resolve();
    }
  });

  it.each(['beforeStart', 'provenExit'] as const)(
    'permits existing source-workspace recovery only with %s ownership proof', async (proof) => {
      const fixture = await createFixture(originalProfileId, {
        replacementTarget: true,
        async inspectBackendStartup() {
          throw new DesktopBackendStartupError('BACKEND_READINESS_TIMEOUT', {
            processState: 'absent', migrationGateSettled: true, reservationReclaimed: true,
          });
        },
      });

      await expect(fixture.start(undefined, async stage => {
        if (proof === 'beforeStart' && (stage === 'backend' || stage === 'restoredBackend')) {
          throw new Error('BACKEND_READINESS_TIMEOUT');
        }
      })).resolves.toBeUndefined();
      expect(fixture.events).toEqual(proof === 'beforeStart' ? [] : ['backendStarted']);
      expect(fixture.stop).not.toHaveBeenCalled();
      expect(fixture.relaunch).toHaveBeenCalledOnce();
      expect(electronBoundary.createWindow).not.toHaveBeenCalled();
      await expect(fixture.registry.read()).resolves.toMatchObject({
        activeWorkspaceId: '44444444-4444-4444-8444-444444444444',
      });
    },
  );

  it.each(['creation', 'import'] as const)(
    'rejects an invalid active database after cold %s reconciliation removed its journal', async (kind) => {
      const fixture = await createFixture(originalProfileId, { skipRestore: true, completeStartup: true });
      const { journal } = await prepareColdJournal(fixture.root, kind);
      // The existing broker test boundary reads this synthetic database as JSON.
      await writeFile(fixture.databasePath, 'invalid synthetic database');
      await expect(fixture.start()).rejects.toThrow();
      expect(ProfileSnapshotBrokerClient.prototype.validateActiveProfile).toHaveBeenCalledOnce();
      expect(electronBoundary.createWindow).not.toHaveBeenCalled();
      expect(fixture.relaunch).not.toHaveBeenCalled();
      await expect(journal.read()).resolves.toBeUndefined();
      await fixture.assertRegistryUnchanged();
    },
  );

  describe.each(['creation', 'import'] as const)('cold %s production wiring', (kind) => {
    it.each(['completed', 'failed'] as const)(
      'waits for candidate exit after a %s terminal before changing published recovery state', async terminal => {
        const fixture = await createFixture(originalProfileId, { skipRestore: true, completeStartup: true });
        const pending = await prepareColdJournal(fixture.root, kind, { state: 'rootPublished' });
        const child = new EventEmitter();
        let signalShutdownRequested!: () => void;
        const shutdownRequested = new Promise<void>(resolve => { signalShutdownRequested = resolve; });
        const operations: string[] = [];
        let exited = false;
        const exit = () => {
          if (!exited) { exited = true; child.emit('exit', 0); }
        };
        const kill = vi.fn(exit);
        electronBoundary.fork.mockImplementation(() => {
          queueMicrotask(() => child.emit('message', createWorkspaceCandidateReadyStatus()));
          return Object.assign(child, {
            kill,
            postMessage(raw: unknown) {
              const command = parseWorkspaceCandidateProcessCommand(raw);
              if (command === undefined) throw new Error('TEST_CANDIDATE_COMMAND_INVALID');
              if (command.type === 'prepare') {
                queueMicrotask(() => child.emit('message', createWorkspaceCandidateReservationReadyStatus(command)));
              } else if (command.type === 'start') {
                operations.push(command.operation.operation);
                const status = terminal === 'failed'
                  ? createWorkspaceCandidateFailedStatus(command)
                  : createWorkspaceCandidateCompletedStatus({
                    ...command,
                    result: {
                      actorId: 'local-owner', artifactRootHealth: 'ready',
                      companyId: 'local-company-1234567890abcdef1234567890abcdef',
                      databaseHealth: 'healthy', foreignKeyHealth: 'healthy', kind: 'readiness',
                      migrationChainIdentity: 'c'.repeat(64), profileId: foreignProfileId,
                    },
                  });
                queueMicrotask(() => child.emit('message', status));
              } else {
                signalShutdownRequested();
              }
            },
          });
        });
        const started = fixture.start().then(
          lifecycle => ({ status: 'completed' as const, lifecycle }),
          error => ({ status: 'failed' as const, error }),
        );
        try {
          await Promise.race([
            shutdownRequested,
            started.then(() => { throw new Error('TEST_RECOVERY_RETURNED_BEFORE_EXIT'); }),
          ]);
          expect(operations).toEqual(['validatePublished']);
          await expect(pending.journal.read()).resolves.toMatchObject({ state: 'rootPublished' });
          await expect(readFile(pending.publishedFile, 'utf8')).resolves.toBe('synthetic published');
          await fixture.assertRegistryUnchanged();
          expect(fixture.events).toEqual([]);
          expect(electronBoundary.createWindow).not.toHaveBeenCalled();
          expect(kill).not.toHaveBeenCalled();
          exit();
          const result = await started;
          expect(result.status).toBe(terminal);
          if (result.status === 'completed') {
            expect(result.lifecycle).toBeDefined();
            await expect(pending.journal.read()).resolves.toBeUndefined();
            const registry = await fixture.registry.read();
            expect(registry?.activeWorkspaceId).toBe(workspaceId);
            expect(registry?.workspaces).toHaveLength(2);
            expect(electronBoundary.createWindow).toHaveBeenCalledOnce();
          } else {
            await expect(pending.journal.read()).resolves.toMatchObject({ state: 'rootPublished' });
            await fixture.assertRegistryUnchanged();
            expect(fixture.events).toEqual([]);
            expect(electronBoundary.createWindow).not.toHaveBeenCalled();
          }
          await expect(readFile(pending.publishedFile, 'utf8')).resolves.toBe('synthetic published');
        } finally {
          exit();
          const result = await started;
          if (result.status === 'completed') await result.lifecycle?.shutdown();
        }
      },
    );

    it.each(['currentPath', 'backupPath', 'nextPath'] as const)(
      'rejects a legacy %s before repair, cleanup or backend startup', async slot => {
        const fixture = await createFixture(originalProfileId, { skipRestore: true });
        const pending = await prepareColdJournal(fixture.root, kind, { formatVersion: 1, slot });
        const before = await readFile(pending.paths[slot]);
        const payload = await preparePlaintext(fixture.root);
        await expect(fixture.start()).rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
        await expect(readFile(pending.paths[slot])).resolves.toEqual(before);
        await expect(readFile(pending.candidateFile, 'utf8')).resolves.toBe('synthetic candidate');
        await expect(readFile(payload, 'utf8')).resolves.toBe('synthetic plaintext');
        if (slot !== 'currentPath') await expect(readFile(pending.paths.currentPath)).rejects.toMatchObject({ code: 'ENOENT' });
        expect(fixture.events).toEqual([]);
        expect(electronBoundary.fork).not.toHaveBeenCalled();
        expect(electronBoundary.createWindow).not.toHaveBeenCalled();
        await fixture.assertRegistryUnchanged();
      },
    );

    it.each(['currentPath', 'backupPath', 'nextPath'] as const)(
      'recovers guarded %s before normal startup and remains idempotent', async slot => {
        const fixture = await createFixture(originalProfileId, {
          skipRestore: true, completeStartup: true,
          async inspectBackendStartup() {
            await expect(pending.journal.read()).resolves.toBeUndefined();
            await expect(readFile(pending.candidateFile)).rejects.toMatchObject({ code: 'ENOENT' });
          },
        });
        const pending = await prepareColdJournal(fixture.root, kind, { slot });
        const payload = kind === 'import' ? await preparePlaintext(fixture.root) : undefined;
        const lifecycle = await fixture.start();
        expect(lifecycle).toBeDefined();
        expect(electronBoundary.createWindow).toHaveBeenCalledOnce();
        expect(ProfileSnapshotBrokerClient.prototype.validateActiveProfile).toHaveBeenCalledOnce();
        expect(electronBoundary.fork).not.toHaveBeenCalled();
        if (payload !== undefined) await expect(readFile(payload)).rejects.toMatchObject({ code: 'ENOENT' });
        await fixture.assertRegistryUnchanged();
        await lifecycle!.shutdown();
        const restarted = await fixture.start();
        expect(restarted).toBeDefined();
        await restarted!.shutdown();
        await fixture.assertRegistryUnchanged();
      },
    );

    it('preserves the journal and candidate when the continuation is missing', async () => {
      const fixture = await createFixture(originalProfileId, { skipRestore: true, completeStartup: true });
      const pending = await prepareColdJournal(fixture.root, kind);
      await rm(deriveWorkspaceRoot(fixture.root, workspaceId, 1).workspaceRoot, { recursive: true });
      await expect(fixture.start()).rejects.toThrow(kind === 'creation'
        ? 'WORKSPACE_CREATION_RECOVERY_REQUIRED' : 'WORKSPACE_IMPORT_RECOVERY_REQUIRED');
      await expect(pending.journal.read()).resolves.toMatchObject({ formatVersion: 2, state: 'prepared' });
      await expect(readFile(pending.candidateFile, 'utf8')).resolves.toBe('synthetic candidate');
      expect(fixture.events).toEqual([]);
      expect(electronBoundary.createWindow).not.toHaveBeenCalled();
      await fixture.assertRegistryUnchanged();
    });

    it('blocks conflicting restore ownership before repairing the pending journal', async () => {
      const fixture = await createFixture(originalProfileId);
      const pending = await prepareColdJournal(fixture.root, kind, { slot: 'backupPath' });
      const before = await readFile(pending.paths.backupPath);
      await expect(fixture.start()).rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
      await expect(readFile(pending.paths.backupPath)).resolves.toEqual(before);
      await expect(readFile(pending.paths.currentPath)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(fixture.events).toEqual([]);
      await fixture.assertPendingRestoreRetained();
    });
  });

  it('preserves journal-free plaintext without inferring old writer absence', async () => {
    const fixture = await createFixture(originalProfileId, { skipRestore: true });
    const payload = await preparePlaintext(fixture.root);
    await expect(fixture.start()).rejects.toThrow('WORKSPACE_IMPORT_RECOVERY_REQUIRED');
    await expect(readFile(payload, 'utf8')).resolves.toBe('synthetic plaintext');
    expect(fixture.events).toEqual([]);
    await fixture.assertRegistryUnchanged();
  });

  it.each([false, true])('wires private gate observation with the session secret only when enabled (enabled: %s)', async enabled => {
    const original = new Error('synthetic private migration rejection');
    let installedObserver: StartDesktopBackendOptions['observeStartupException'];
    const fixture = await createFixture(originalProfileId, {
      async inspectBackendStartup(input) {
        installedObserver = input.observeStartupException;
        input.observeStartupException?.(original);
        throw new Error('BACKEND_MIGRATION_STARTUP_GATE_FAILED');
      },
    });
    const observe = vi.fn();
    await expect(fixture.start(enabled ? observe : undefined)).rejects.toThrow('DESKTOP_START_FAILED');
    if (enabled) {
      expect(installedObserver).toBeTypeOf('function');
      expect(observe.mock.calls[0]).toEqual([original, 'runtimeStartup', ['d'.repeat(64)]]);
    } else {
      expect(installedObserver).toBeUndefined();
      expect(observe).not.toHaveBeenCalled();
    }
    expect(RecoveryPointScheduler.prototype.stopChecks).toHaveBeenCalled();
  });

  it('observes the first runtime startup exception before recovery cleanup', async () => {
    const fixture = await createFixture(originalProfileId);
    const original = new Error('synthetic-original-before-backend', { cause: new Error('synthetic cause') });
    const observations: { error: unknown; stage: string; cleanupCalls: number }[] = [];
    await expect(fixture.start((error, stage) => {
      observations.push({ error, stage, cleanupCalls: vi.mocked(RecoveryPointScheduler.prototype.stopChecks).mock.calls.length });
    }, async stage => { if (stage === 'backend') throw original; })).rejects.toThrow('DESKTOP_START_FAILED');
    expect(observations[0]?.error).toBe(original);
    expect(observations[0]?.stage).toBe('runtimeStartup');
    expect(observations[0]?.cleanupCalls).toBe(0);
    expect(RecoveryPointScheduler.prototype.stopChecks).toHaveBeenCalled();
  });
  it('observes the original window exception and session secret before safe-code replacement', async () => {
    const fixture = await createFixture(originalProfileId);
    const original = new Error('synthetic-original-window-failure', { cause: new Error('synthetic-root-cause') });
    electronBoundary.createWindow.mockImplementationOnce(() => { throw original; });
    const observed: { error: unknown; stage: string; secrets: readonly string[] | undefined; stopCount: number }[] = [];
    await expect(fixture.start((error, stage, secrets) => {
      observed.push({ error, stage, secrets, stopCount: fixture.stop.mock.calls.length });
    })).rejects.toThrow('DESKTOP_START_FAILED');
    expect(observed[0]?.error).toBe(original);
    expect(observed[0]?.stage).toBe('compositionStartup');
    expect(observed[0]?.secrets).toEqual(['d'.repeat(64)]);
    expect(observed[0]?.stopCount).toBe(0);
    expect(fixture.stop).not.toHaveBeenCalled();
  });
  it.each(['exited', 'forced'] as const)(
    'marks only a graceful backend shutdown clean after restored startup (%s)',
    async (outcome) => {
      const fixture = await createFixture(originalProfileId, { completeStartup: true });
      fixture.stop.mockResolvedValue(outcome);
      const lifecycle = await fixture.start();
      expect(lifecycle).toBeDefined();

      await lifecycle!.shutdown();

      expect(fixture.stop).toHaveBeenCalledOnce();
      await expect(fixture.marker.consume()).resolves.toBe(
        outcome === 'exited' ? 'clean' : 'unclean',
      );
      await fixture.assertRegistryUnchanged();
    },
  );

  it.each([false, true])(
    'ordinary shutdown waits for the in-flight update stop (failure: %s)', async failure => {
      const fixture = await createFixture(originalProfileId, {
        completeStartup: true, skipRestore: true, update: true,
      });
      const readHandoff = prepareUpdateBoundary(fixture.root);
      const lifecycle = (await fixture.start())!;
      const handoff = readHandoff();
      await handoff.prepareConfirmedUpdate();
      const entered = createCompletionGate();
      const release = createCompletionGate();
      fixture.stopForUpdate.mockImplementation(async () => {
        entered.resolve();
        await release.promise;
        if (failure) throw new BackendShutdownExitError();
      });
      const update = handoff.handoffPreparedUpdate();
      await entered.promise;
      const ordinary = lifecycle.shutdown();
      let settled = false;
      void ordinary.then(() => { settled = true; }, () => { settled = true; });
      const results = Promise.allSettled([update, ordinary]);
      await Promise.resolve();
      const settledBeforeExit = settled;
      release.resolve();
      expect((await results).map(result => result.status)).toEqual(
        failure ? ['rejected', 'rejected'] : ['fulfilled', 'fulfilled'],
      );
      expect(settledBeforeExit).toBe(false);
      expect(fixture.stopForUpdate).toHaveBeenCalledOnce();
      expect(fixture.stop).not.toHaveBeenCalled();
      expect(launchWindowsInstallerForUpdate).toHaveBeenCalledTimes(failure ? 0 : 1);
      await expect(fixture.marker.consume()).resolves.toBe(failure ? 'unclean' : 'clean');
    },
  );

  it.each([false, true])(
    'shares pending shutdown completion and failure between callers (failure: %s)',
    async (failure) => {
      const fixture = await createFixture(originalProfileId, { completeStartup: true });
      const gate = createCompletionGate();
      const entered = createCompletionGate();
      vi.mocked(RecoveryPointScheduler.prototype.stopChecks).mockImplementationOnce(() => {
        entered.resolve();
        return gate.promise;
      });
      if (failure) fixture.stop.mockRejectedValue(new Error('SYNTHETIC_STOP_FAILED'));
      const lifecycle = (await fixture.start())!;
      const first = lifecycle.shutdown();
      await entered.promise;
      let secondSettled = false;
      const second = lifecycle.shutdown();
      void second.then(() => { secondSettled = true; }, () => { secondSettled = true; });
      const results = Promise.allSettled([first, second]);
      await Promise.resolve();
      const settledBeforeRelease = secondSettled;
      gate.resolve();
      const actual = await results;

      expect(settledBeforeRelease).toBe(false);
      expect(actual.map(({ status }) => status)).toEqual(
        failure ? ['rejected', 'rejected'] : ['fulfilled', 'fulfilled'],
      );
      if (failure) {
        for (const result of actual) {
          expect(result).toMatchObject({
            status: 'rejected', reason: new Error('DESKTOP_SHUTDOWN_FAILED'),
          });
        }
        await expect(lifecycle.shutdown()).rejects.toThrow('DESKTOP_SHUTDOWN_FAILED');
      } else {
        await lifecycle.shutdown();
        expect(fixture.stop).toHaveBeenCalledOnce();
      }
      await expect(fixture.marker.consume()).resolves.toBe(failure ? 'unclean' : 'clean');
      await fixture.assertRegistryUnchanged();
    },
  );

  it('does not mark an unsuccessful backend exit as a clean shutdown', async () => {
    const fixture = await createFixture(originalProfileId, { completeStartup: true });
    fixture.stop.mockRejectedValue(new BackendShutdownExitError());
    const lifecycle = (await fixture.start())!;

    await expect(lifecycle.shutdown()).rejects.toThrow('DESKTOP_SHUTDOWN_FAILED');

    await expect(fixture.marker.consume()).resolves.toBe('unclean');
    await fixture.assertRegistryUnchanged();
  });

  it.each(['none', 'backend', 'backendAndBroker', 'capability', 'broker', 'scheduler', 'quiescence'] as const)(
    'uses the real update handoff with strict shutdown (failure: %s)', async failure => {
      const fixture = await createFixture(originalProfileId, {
        completeStartup: true, skipRestore: true, update: true,
      });
      const readHandoff = prepareUpdateBoundary(fixture.root);
      const lifecycle = (await fixture.start())!;
      const handoff = readHandoff();
      await handoff.prepareConfirmedUpdate();
      const privateDetail = 'synthetic-private-shutdown-detail';
      fixture.stopForUpdate.mockImplementation(async () => {
        expect(electronBoundary.removeHandler).toHaveBeenCalled();
        if (failure === 'backendAndBroker') throw new BackendShutdownExitError();
        if (failure === 'backend') throw new Error(privateDetail);
      });
      if (failure === 'capability') electronBoundary.removeHandler.mockImplementationOnce(() => {
        throw new Error(privateDetail);
      });
      if (failure === 'broker' || failure === 'backendAndBroker') vi.spyOn(ProfileSnapshotBrokerClient.prototype, 'close')
        .mockImplementationOnce(() => { throw new Error(privateDetail); });
      if (failure === 'scheduler') vi.mocked(RecoveryPointScheduler.prototype.stopChecks)
        .mockRejectedValueOnce(new Error(privateDetail));
      if (failure === 'quiescence') vi.spyOn(BackendRequestQuiescence.prototype, 'quiesceAndWait')
        .mockRejectedValueOnce(new Error(privateDetail));
      let admission: BackendRequestQuiescence | undefined;
      const realStop = BackendRequestQuiescence.prototype.stop;
      vi.spyOn(BackendRequestQuiescence.prototype, 'stop').mockImplementation(function (this: BackendRequestQuiescence) {
        admission = this;
        realStop.call(this);
      });
      const expectedSuccess = failure === 'none';
      if (expectedSuccess) {
        await handoff.handoffPreparedUpdate();
        await lifecycle.shutdown();
      } else {
        await expect(handoff.handoffPreparedUpdate()).rejects.toThrow(
          'The local update could not be handed off safely.',
        );
        await expect(lifecycle.shutdown()).rejects.toThrow('DESKTOP_SHUTDOWN_FAILED');
        if (failure === 'backendAndBroker') {
          await expect(lifecycle.shutdown()).rejects.toMatchObject({
            cause: {
              runtimeFailure: {
                firstFailure: { phase: 'backend', reason: 'unsuccessfulExit' },
                cleanupFailures: [{ phase: 'brokers', reason: 'operationFailed' }],
              },
              cleanupFailures: ['brokers'],
            },
          });
        }
      }

      expect(fixture.stop).not.toHaveBeenCalled();
      expect(fixture.stopForUpdate).toHaveBeenCalledTimes(
        failure === 'scheduler' || failure === 'quiescence' ? 0 : 1,
      );
      expect(launchWindowsInstallerForUpdate).toHaveBeenCalledTimes(expectedSuccess ? 1 : 0);
      await expect(fixture.marker.consume()).resolves.toBe(expectedSuccess ? 'clean' : 'unclean');
      await expect(fixture.updateJournal.read()).resolves.toMatchObject({
        state: expectedSuccess ? 'awaitingFirstStart' : 'failed',
      });
      expect(admission?.begin('POST')).toBeUndefined();
      expect(admission?.readState()).toBe('stopped');
      expect(electronBoundary.removeHandler.mock.calls.length).toBeGreaterThan(1);
      expect(electronBoundary.portClosed.mock.calls.length).toBeGreaterThanOrEqual(2);
      const logs = join(fixture.root, 'runtime', 'logs', 'desktop');
      const records = [];
      for (const file of await readdir(logs)) {
        if (!file.endsWith('.jsonl')) continue;
        const content = await readFile(join(logs, file), 'utf8');
        expect(content).not.toContain(privateDetail);
        records.push(...content.trim().split('\n').map(line => JSON.parse(line)));
      }
      if (!expectedSuccess) {
        expect(records).toContainEqual(expect.objectContaining({
          eventName: 'desktop.shutdownFailed', errorCode: 'DESKTOP_SHUTDOWN_FAILED',
        }));
      }
      await fixture.assertRegistryUnchanged();
    },
  );

  it.each(['exited', 'forced'] as const)(
    'checks the actual outcome when update joins ordinary composition shutdown (%s)', async outcome => {
      const fixture = await createFixture(originalProfileId, {
        completeStartup: true, skipRestore: true, update: true,
      });
      const updateEntered = createCompletionGate();
      const readHandoff = prepareUpdateBoundary(fixture.root, () => updateEntered.resolve());
      const lifecycle = (await fixture.start())!;
      const handoff = readHandoff();
      await handoff.prepareConfirmedUpdate();
      const entered = createCompletionGate();
      const release = createCompletionGate();
      fixture.stop.mockImplementation(async () => {
        entered.resolve();
        await release.promise;
        return outcome;
      });
      const ordinary = lifecycle.shutdown();
      await entered.promise;
      const update = handoff.handoffPreparedUpdate();
      const results = Promise.allSettled([ordinary, update]);
      let updateSettled = false;
      void update.then(() => { updateSettled = true; }, () => { updateSettled = true; });
      await updateEntered.promise;
      const settledBeforeExit = updateSettled;
      const installerCallsBeforeExit = vi.mocked(launchWindowsInstallerForUpdate).mock.calls.length;
      release.resolve();
      expect((await results).map(result => result.status)).toEqual([
        'fulfilled', 'rejected',
      ]);
      expect(settledBeforeExit).toBe(false);
      expect(installerCallsBeforeExit).toBe(0);
      expect(fixture.stop).toHaveBeenCalledOnce();
      expect(fixture.stopForUpdate).not.toHaveBeenCalled();
      expect(launchWindowsInstallerForUpdate).not.toHaveBeenCalled();
      await expect(fixture.marker.consume()).resolves.toBe(outcome === 'exited' ? 'clean' : 'unclean');
    },
  );

  it('rejects foreign restored lineage, restores original bytes and validates them on restart', async () => {
    const fixture = await createFixture(foreignProfileId);

    await expect(fixture.start()).resolves.toBeUndefined();

    expect(fixture.relaunch).toHaveBeenCalledTimes(1);
    expect(electronBoundary.createWindow).not.toHaveBeenCalled();
    expect(fixture.events).toEqual(['backendStarted', 'backendStopped', 'rollback']);
    await fixture.assertOriginalRestored();

    await expect(fixture.start()).rejects.toThrow(windowBoundary);
    expect(electronBoundary.createWindow).toHaveBeenCalledTimes(1);
    await expect(fixture.journal.read()).resolves.toBeUndefined();
    await fixture.assertRegistryUnchanged();
  });

  it('rolls back if health fails after deferred restore validation but before acceptance', async () => {
    const fixture = await createFixture(originalProfileId);
    electronBoundary.fetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok' })))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));

    await expect(fixture.start()).resolves.toBeUndefined();

    expect(electronBoundary.fetch).toHaveBeenCalledTimes(2);
    expect(electronBoundary.createWindow).not.toHaveBeenCalled();
    expect(fixture.relaunch).toHaveBeenCalledTimes(1);
    expect(fixture.events).toEqual(['backendStarted', 'backendStopped', 'rollback']);
    await fixture.assertOriginalRestored();
  });

  it('does not swap files or relaunch when backend shutdown is unverified', async () => {
    const fixture = await createFixture(foreignProfileId);
    fixture.stop.mockRejectedValueOnce(new Error('SYNTHETIC_STOP_FAILED'));

    await expect(fixture.start()).rejects.toThrow('WORKSPACE_SWITCH_INVALID');

    expect(fixture.events).toEqual(['backendStarted']);
    expect(fixture.relaunch).not.toHaveBeenCalled();
    expect(electronBoundary.createWindow).not.toHaveBeenCalled();
    await fixture.assertPendingRestoreRetained();
  });

  it('keeps the journal and rollback bytes when rollback itself fails', async () => {
    const fixture = await createFixture(foreignProfileId);
    vi.spyOn(ProfileRestoreActivationTransaction.prototype, 'rollback')
      .mockRejectedValueOnce(new Error('SYNTHETIC_ROLLBACK_FAILED'));

    await expect(fixture.start()).rejects.toThrow('WORKSPACE_SWITCH_RECOVERY_REQUIRED');

    expect(fixture.relaunch).not.toHaveBeenCalled();
    expect(electronBoundary.createWindow).not.toHaveBeenCalled();
    await fixture.assertPendingRestoreRetained();
  });

  it.each([false, true])(
    'retains recovery evidence when validation and shutdown fail (replacement: %s)',
    async (replacementTarget) => {
      const fixture = await createFixture(originalProfileId, { replacementTarget });
      electronBoundary.fetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
      fixture.stop.mockRejectedValue(new Error('SYNTHETIC_STOP_FAILED'));

      await expect(fixture.start()).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');

      expect(fixture.events).toEqual(['backendStarted']);
      expect(fixture.relaunch).not.toHaveBeenCalled();
      expect(electronBoundary.createWindow).not.toHaveBeenCalled();
      await fixture.assertPendingRestoreRetained();
    },
  );

  it('accepts same-lineage restored bytes only after validation and reaches the window boundary', async () => {
    const fixture = await createFixture(originalProfileId);

    await expect(fixture.start()).rejects.toThrow(windowBoundary);

    expect(electronBoundary.fetch).toHaveBeenCalledTimes(2);
    expect(electronBoundary.createWindow).toHaveBeenCalledTimes(1);
    expect(fixture.relaunch).not.toHaveBeenCalled();
    expect(fixture.events).toEqual(['backendStarted', 'accept']);
    await expect(fixture.journal.read()).resolves.toBeUndefined();
    await expect(readFile(fixture.databasePath, 'utf8')).resolves.toBe(fixture.restoredBytes);
    await expect(readFile(fixture.pdfPath, 'utf8')).resolves.toBe('restored pdf');
    await fixture.assertRegistryUnchanged();
  });
});

function createCompletionGate() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function prepareUpdateBoundary(root: string, onShutdownStarted?: () => void) {
  // Only path validation runs; the installer boundary below is never executed.
  vi.stubEnv('SystemRoot', 'C:\\Windows');
  electronBoundary.fetch.mockImplementation(async (url: string) =>
    url.endsWith('/customers')
      ? new Response(null, { status: 401 })
      : new Response(JSON.stringify({ status: 'ok' })),
  );
  const realObserver = updateObservation.createUpdateOperationalObserver;
  vi.spyOn(updateObservation, 'createUpdateOperationalObserver').mockImplementation(options => {
    const observer = realObserver(options);
    return {
      ...observer,
      operationStarted(input) {
        observer.operationStarted(input);
        if (input.stage === 'runtimeShutdown') onShutdownStarted?.();
      },
    };
  });
  let handoff: Parameters<typeof updateFoundation.createLocalUpdateFoundationComposition>[0]['handoffCoordinator'] | undefined;
  const realFoundation = updateFoundation.createLocalUpdateFoundationComposition;
  vi.spyOn(updateFoundation, 'createLocalUpdateFoundationComposition').mockImplementation(options => {
    handoff = options.handoffCoordinator;
    return realFoundation(options);
  });
  const realProtection = profileProtection.createProfileProtectionComposition;
  vi.spyOn(profileProtection, 'createProfileProtectionComposition').mockImplementation(options => ({
    ...realProtection(options),
    createValidatedPreUpdatePoint: async () => operationId,
  }));
  vi.spyOn(ProfileSnapshotBrokerClient.prototype, 'beginMaintenance').mockResolvedValue('busy');
  vi.spyOn(ProfileSnapshotBrokerClient.prototype, 'endMaintenance').mockResolvedValue('normal');
  vi.spyOn(ProfileSnapshotBrokerClient.prototype, 'beginUpdateMaintenance').mockResolvedValue('busy');
  vi.spyOn(ProfileSnapshotBrokerClient.prototype, 'assertUpdateMaintenance').mockResolvedValue('busy');
  vi.spyOn(ProfileSnapshotBrokerClient.prototype, 'endUpdateMaintenance').mockResolvedValue('normal');
  vi.spyOn(LocalUpdatePackageCache.prototype, 'readExpectedPackageIdentity').mockImplementation(async role => ({
    appVersion: role === 'current' ? '0.2.8' : '0.2.9',
    buildRevision: (role === 'current' ? 'a' : 'b').repeat(12),
    msiProductVersion: role === 'current' ? '0.2.8' : '0.2.9',
    packageSha256: (role === 'current' ? 'a' : 'b').repeat(64),
    packageSize: 1024,
  }));
  vi.spyOn(LocalUpdatePackageCache.prototype, 'revalidateJournalPackage').mockResolvedValue({
    appVersion: '0.2.9', buildRevision: 'b'.repeat(12), msiProductVersion: '0.2.9',
    packagePath: join(root, 'synthetic-never-launched.msi'),
    productCode: '{22222222-2222-4222-8222-222222222222}',
  });
  return () => {
    if (handoff === undefined) throw new Error('TEST_HANDOFF_NOT_WIRED');
    return handoff;
  };
}

async function prepareColdJournal(root: string, kind: 'creation' | 'import', options: {
  formatVersion?: 1 | 2;
  slot?: 'currentPath' | 'backupPath' | 'nextPath';
  state?: 'prepared' | 'rootPublished';
} = {}) {
  const input = {
    state: options.state ?? 'prepared',
    workspaceId: validateWorkspaceId('55555555-5555-4555-8555-555555555555'),
    previousActiveWorkspaceId: workspaceId,
  };
  const creationValue = createTestJournal({ ...input, profileCharacter: 'b' });
  const importValue = createTestImportJournal({ ...input, profileId: foreignProfileId });
  const value = { ...(kind === 'creation' ? creationValue : importValue),
    formatVersion: options.formatVersion ?? 2 };
  const filePath = join(root, kind === 'creation' ? WORKSPACE_CREATION_JOURNAL_FILE_NAME : WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME);
  const journal = kind === 'creation'
    ? new WorkspaceCreationJournalStore({ installationRoot: root, filePath })
    : new WorkspaceBackupImportJournalStore({ installationRoot: root, filePath });
  const paths = kind === 'creation'
    ? createWorkspaceCreationJournalPaths(root, filePath)
    : createWorkspaceBackupImportJournalPaths(root, filePath);
  await writeFile(paths[options.slot ?? 'currentPath'], JSON.stringify(value), { mode: 0o600 });
  const candidate = kind === 'creation'
    ? deriveWorkspaceCreationPaths(root, creationValue.operationId, input.workspaceId)
    : deriveWorkspaceBackupImportPaths(root, importValue.operationId, input.workspaceId);
  await mkdir(dirname(candidate.databaseFilePath), { recursive: true, mode: 0o700 });
  await writeFile(candidate.databaseFilePath, 'synthetic candidate', { mode: 0o600 });
  const published = createDesktopProfilePaths(deriveWorkspaceRoot(root, input.workspaceId, 1).workspaceRoot);
  if (options.state === 'rootPublished') {
    await mkdir(dirname(published.databaseFilePath), { recursive: true, mode: 0o700 });
    await mkdir(published.invoiceDocumentStorageRoot, { recursive: true, mode: 0o700 });
    await writeFile(published.databaseFilePath, 'synthetic published', { mode: 0o600 });
    await rm(candidate.candidateRoot, { recursive: true, force: true });
  }
  return { journal, paths, candidateFile: candidate.databaseFilePath, publishedFile: published.databaseFilePath };
}

async function preparePlaintext(root: string) {
  const path = await new WorkspaceBackupPlaintextQuarantine({ userDataRoot: root }).createPayloadPath();
  await writeFile(path, 'synthetic plaintext', { mode: 0o600 });
  return path;
}

async function createFixture(
  restoredProfileId: string,
  options: {
    replacementTarget?: boolean;
    completeStartup?: boolean;
    skipRestore?: boolean;
    inspectBackendStartup?(input: StartDesktopBackendOptions): Promise<void>;
    realBackend?: boolean;
    beforeMigrations?: StartDesktopBackendOptions['beforeMigrations'];
    update?: boolean;
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'eky-desktop-restore-startup-'));
  roots.push(root);
  const releaseInfo = options.update ? {
    appIdentity: 'Eky' as const,
    appVersion: '0.2.8',
    architecture: 'x64' as const,
    buildRevision: 'a'.repeat(12),
    msiProductVersion: '0.2.8',
    platform: 'win32' as const,
    releaseChannel: 'pilot' as const,
    schemaVersion: 1 as const,
    upgradeCode: '11111111-1111-4111-8111-111111111111',
  } : undefined;
  const updatePaths = createLocalUpdateRuntimePaths({
    userDataPath: root, legacyRuntimeRoot: createDesktopProfilePaths(root).runtimeRoot,
  });
  if (releaseInfo !== undefined) {
    await new AcceptedBuildMetadataStore(updatePaths.acceptedBuildMetadataPath).write({
      acceptedAt: '2026-08-18T10:00:00.000Z',
      appVersion: releaseInfo.appVersion,
      buildRevision: releaseInfo.buildRevision,
      formatVersion: 1,
      releaseChannel: 'pilot',
    });
  }
  if (options.completeStartup) {
    electronBoundary.createWindow.mockReturnValue({} as BrowserWindow);
    const candidateRunner = join(root, 'resources', 'desktop-runtime', 'runtime', 'workspaceCandidateRunner.js');
    await mkdir(dirname(candidateRunner), { recursive: true });
    await writeFile(candidateRunner, '// Synthetic boundary; never executed.\n');
    await mkdir(join(root, 'resources', 'backend', 'dist', 'database', 'migrations'), { recursive: true });
  }
  const { workspaceRoot } = deriveWorkspaceRoot(root, workspaceId, 1);
  const paths = createDesktopProfilePaths(workspaceRoot);
  const backupPaths = createProfileSnapshotRuntimePaths(paths.runtimeRoot);
  if (options.replacementTarget) {
    const replacement = deriveWorkspaceBackupReplacementRuntimePaths(root, workspaceId);
    backupPaths.restoreActivationJournalPath = replacement.activationJournalPath;
    backupPaths.restoreFailedRoot = replacement.activationFailedRoot;
    backupPaths.restoreRollbackRoot = replacement.activationRollbackRoot;
    backupPaths.stagingRoot = replacement.activationStagingRoot;
  }
  const registryPath = join(root, WORKSPACE_REGISTRY_FILE_NAME);
  const registry = new WorkspaceRegistryStore({ installationRoot: root, filePath: registryPath });
  const originalBytes = JSON.stringify({ profileId: originalProfileId, value: 'original' });
  const restoredBytes = JSON.stringify({ profileId: restoredProfileId, value: 'restored' });
  const pdfPath = join(paths.invoiceDocumentStorageRoot, 'company-1', 'invoice-1', 'approved-invoice.pdf');
  const staging = join(backupPaths.stagingRoot, operationId);
  const stagedPdf = join(
    staging, 'activation', 'storage', 'invoices',
    'company-1', 'invoice-1', 'approved-invoice.pdf',
  );
  for (const [file, bytes] of [
    [paths.databaseFilePath, originalBytes],
    [pdfPath, 'original pdf'],
    [join(staging, 'profile.sqlite'), restoredBytes],
    [stagedPdf, 'restored pdf'],
  ] as const) {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, bytes, { mode: 0o600 });
  }
  await registry.write({
    formatVersion: 1,
    activeWorkspaceId: workspaceId,
    workspaces: [{
      workspaceId,
      workspaceLabel: 'Synthetic restore test',
      lineageIdentity: { formatVersion: 1, profileId: originalProfileId },
      layoutVersion: 1,
      lifecycleState: 'ready',
      createdAt: '2026-08-18T10:00:00.000Z',
    }],
  });
  const switchJournal = new WorkspaceSwitchJournalStore(root);
  if (options.replacementTarget) {
    const sourceId = validateWorkspaceId('44444444-4444-4444-8444-444444444444');
    const current = (await registry.read())!;
    await mkdir(deriveWorkspaceRoot(root, sourceId, 1).workspaceRoot, { recursive: true });
    await registry.write({
      ...current,
      workspaces: [...current.workspaces, {
        ...current.workspaces[0]!,
        workspaceId: sourceId,
        workspaceLabel: 'Synthetic previous workspace',
        lineageIdentity: { formatVersion: 1, profileId: foreignProfileId },
      }],
    });
    const switching = {
      formatVersion: 1,
      operationId,
      sourceWorkspaceId: sourceId,
      targetWorkspaceId: workspaceId,
      createdAt: '2026-08-18T10:00:00.000Z',
    };
    await switchJournal.write({ ...switching, state: 'prepared' });
    await switchJournal.write({ ...switching, state: 'targetSelected' });
  }
  const pendingSwitch = await switchJournal.read();
  const registryBytes = await readFile(registryPath);
  const journal = new ProfileRestoreActivationJournalStore(backupPaths.restoreActivationJournalPath);
  const transaction = new ProfileRestoreActivationTransaction({
    journalStore: journal,
    paths: {
      activeDatabasePath: paths.databaseFilePath,
      activeDocumentsRoot: paths.invoiceDocumentStorageRoot,
      failedRoot: backupPaths.restoreFailedRoot,
      rollbackRoot: backupPaths.restoreRollbackRoot,
      stagingRoot: backupPaths.stagingRoot,
    },
  });
  if (!options.skipRestore) {
    await transaction.prepare(operationId);
    await transaction.advanceToValidation();
  }
  const pendingJournal = await journal.read();
  const events: string[] = [];
  const realRollback = ProfileRestoreActivationTransaction.prototype.rollback;
  vi.spyOn(ProfileRestoreActivationTransaction.prototype, 'rollback')
    .mockImplementation(async function (this: ProfileRestoreActivationTransaction) {
      events.push('rollback');
      return realRollback.call(this);
    });
  const realAccept = ProfileRestoreActivationTransaction.prototype.accept;
  vi.spyOn(ProfileRestoreActivationTransaction.prototype, 'accept')
    .mockImplementation(async function (this: ProfileRestoreActivationTransaction) {
      events.push('accept');
      return realAccept.call(this);
    });
  vi.spyOn(ProfileSnapshotBrokerClient.prototype, 'validateActiveProfile')
    .mockImplementation(async () => ({
      type: 'activeProfileValidation',
      artifactCount: 1,
      artifactTotalByteSize: 12,
      databaseHealth: 'healthy',
      migrationChainIdentity: 'c'.repeat(64),
      profileId: (JSON.parse(await readFile(paths.databaseFilePath, 'utf8')) as { profileId: string }).profileId,
    }));
  const stop = vi.fn(async (): Promise<BackendShutdownOutcome> => {
    events.push('backendStopped');
    return 'exited';
  });
  const relaunch = vi.fn();
  const assertSingleInstanceOwnership = vi.fn();
  const stopForUpdate = vi.fn(async () => undefined);
  const createRuntimeSession = options.update
    ? vi.fn(() => 'e'.repeat(64)).mockReturnValueOnce('d'.repeat(64))
    : () => 'd'.repeat(64);
  const assertRegistryUnchanged = async () => {
    await expect(readFile(registryPath)).resolves.toEqual(registryBytes);
  };
  return {
    root,
    registry,
    databasePath: paths.databaseFilePath,
    events,
    journal,
    marker: new RecoveryPointCleanShutdownMarker(backupPaths.recoveryPointCleanShutdownMarkerPath),
    pdfPath,
    relaunch,
    assertSingleInstanceOwnership,
    restoredBytes,
    stop,
    stopForUpdate,
    updateJournal: new UpdateJournalStore(updatePaths.journalPath),
    assertRegistryUnchanged,
    async assertOriginalRestored() {
      await expect(readFile(paths.databaseFilePath, 'utf8')).resolves.toBe(originalBytes);
      await expect(readFile(pdfPath, 'utf8')).resolves.toBe('original pdf');
      await expect(journal.read()).resolves.toMatchObject({ phase: 'rolledBack' });
      await assertRegistryUnchanged();
    },
    async assertPendingRestoreRetained() {
      await expect(switchJournal.read()).resolves.toEqual(pendingSwitch);
      await expect(journal.read()).resolves.toEqual(pendingJournal);
      await expect(readFile(paths.databaseFilePath, 'utf8')).resolves.toBe(restoredBytes);
      const rollbackRoot = join(backupPaths.restoreRollbackRoot, operationId);
      await expect(readFile(join(rollbackRoot, 'data', 'eky.sqlite'), 'utf8'))
        .resolves.toBe(originalBytes);
      await expect(readFile(join(
        rollbackRoot, 'storage', 'invoices', 'company-1', 'invoice-1',
        'approved-invoice.pdf',
      ), 'utf8')).resolves.toBe('original pdf');
      await assertRegistryUnchanged();
    },
    start: (observeStartupException?: StartDesktopCompositionOptions['observeStartupException'],
      reportSmokeStage: StartDesktopCompositionOptions['reportSmokeStage'] = async () => undefined) => startDesktopComposition({
      ...(observeStartupException === undefined ? {} : { observeStartupException }),
      assertSingleInstanceOwnership,
      appVersion: '0.2.8',
      applicationPath: join(root, 'app'),
      buildInfo: {
        appVersion: '0.2.8',
        buildCreatedAt: '2026-08-18T10:00:00.000Z',
        buildDirty: false,
        buildRevision: 'a'.repeat(12),
        schemaVersion: 1,
      },
      releaseInfo,
      dependencies: {
        createRuntimeSession,
        async startBackend(input) {
          events.push('backendStarted');
          try {
            await options.inspectBackendStartup?.(input);
          } catch (error) {
            if (error instanceof DesktopBackendStartupError && error.ownership.processState === 'absent' &&
                error.ownership.reservationReclaimed) {
              await input.reservationTransfer.reclaimAfterExit(new AbortController().signal);
            } else {
              input.reservationTransfer.invalidate();
            }
            throw error;
          }
          if (options.realBackend) return startDesktopBackend({
            ...input,
            ...(options.beforeMigrations === undefined ? {} : { beforeMigrations: options.beforeMigrations }),
          });
          const signal = new AbortController().signal;
          await input.reservationTransfer.prepare(signal);
          await input.reservationTransfer.assertGrant(signal);
          input.reservationTransfer.assertCurrent();
          let reclaim: Promise<void> | undefined;
          const reclaimAfterExit = () => reclaim ??= input.reservationTransfer.reclaimAfterExit(signal);
          const stopOwnedBackend = async () => {
            const outcome = await stop();
            await reclaimAfterExit();
            return outcome;
          };
          const stopOwnedBackendForUpdate = async () => {
            await stopForUpdate();
            await reclaimAfterExit();
          };
          if (options.update) {
            await input.beforeMigrations({
              appliedMigrationCount: 1,
              migrationChainIdentity: 'c'.repeat(64),
              pendingMigrationCount: 0,
              profileState: 'existing',
            }, { stopStartupRuntime: stopOwnedBackendForUpdate });
          }
          return { port: 12345, stop: stopOwnedBackend, onUnexpectedExit: vi.fn(), stopForUpdate: stopOwnedBackendForUpdate };
        },
      },
      quitApplication: vi.fn(),
      relaunchApplication: relaunch,
      resourcesPath: join(root, 'resources'),
      runtimeInstanceId: '33333333-3333-4333-8333-333333333333',
      reportSmokeStage,
      smokeConfiguration: {
        enabled: false,
        phase: 'initial',
        root: undefined,
        userDataPath: undefined,
      },
      userDataPath: root,
    }),
  };
}
