import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { BackendRequestQuiescence } from '../../main/backendRequestQuiescence.js';
import { DeferredWorkspaceRuntimeRelaunch } from '../../workspaces/runtime/deferredWorkspaceRuntimeRelaunch.js';
import { WorkspaceRegistryStore } from '../../workspaces/registry/workspaceRegistryStore.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../../workspaces/registry/workspaceRegistryPaths.js';
import { deriveWorkspaceRoot } from '../../workspaces/registry/deriveWorkspaceRoot.js';
import { inspectWorkspaceRoot } from '../../workspaces/registry/inspectWorkspaceRoot.js';
import { validateWorkspaceId } from '../../workspaces/registry/workspaceIdValidation.js';
import { MainOwnedWorkspaceManagementOperationGuard, createReadOnlyJournalSlotPaths } from '../../workspaces/management/mainOwnedWorkspaceManagementOperationGuard.js';
import { startSecretBrokerMain } from '../../secrets/secretBrokerMain.js';
import { CompanyEmailSecretBrokerClient } from '../../secrets/secretBrokerClient.js';
import { EncryptedSecretFile } from '../../secrets/encryptedSecretFile.js';
import { createLinkedSecretTransports } from '../../secrets/secretBrokerTestSupport.js';
import { InvoicePdfArchiveService } from '../../invoicePdfArchive/invoicePdfArchiveService.js';
import { InvoicePdfArchiveConfigStore } from '../../invoicePdfArchive/invoicePdfArchiveConfig.js';
import { InvoicePdfArchiveJournalStore } from '../../invoicePdfArchive/invoicePdfArchiveJournal.js';
import { createInvoicePdfArchiveRuntimePaths } from '../../invoicePdfArchive/invoicePdfArchivePaths.js';
import { WorkspaceManagementService } from './workspaceManagementService.js';
import { createWorkspaceManagementCapability } from './workspaceManagementCapability.js';
import type { WorkspaceDeletionPreparationLifetime, WorkspaceManagementObserver } from './workspaceManagementTypes.js';
import { MainOwnedActiveWorkspaceLifecycle } from '../runtime/mainOwnedActiveWorkspaceLifecycle.js';
import { MainOwnedSelectorWorkspaceLifecycle } from '../runtime/mainOwnedSelectorWorkspaceLifecycle.js';
import { prepareWorkspaceDeletion, WorkspaceDeletionPreparationFailure } from './workspaceDeletionPreparation.js';
import * as backupProof from '../../profileBackup/deletionBackupReceipt.js';
import { readDeletionBackupExportIdentity } from '../../profileBackup/readDeletionBackupExportIdentity.js';
import { fixture as backupFixture, deferred, sourceId, profileId, processBoundary } from '../../profileBackup/portableDeletionBackupTestSupport.js';

const workspaceId = validateWorkspaceId(sourceId);
const label = 'Synthetic company';
type Options = { holdSecret?: boolean; holdArchive?: boolean; holdInspectionClose?: boolean;
  holdExit?: boolean; holdReclaim?: boolean; cancel?: boolean; returnChoice?: boolean;
  holdReturn?: boolean; holdPublication?: boolean; failStop?: boolean; failArchive?: boolean;
  failConfirmation?: boolean; failBackup?: boolean; backupChoice?: 'createBackup' | 'explicitDataLoss';
  otherTarget?: boolean; selector?: boolean; recoveryRequired?: boolean; rejectLoss?: boolean;
  holdLoss?: boolean; cancelBackup?: boolean; holdFence?: boolean; failFence?: boolean; };

it('joins the admitted request, real target/export and named stop before one-shot publication', async () => {
  await exercise({}, async f => {
    expect(await f.start()).toBe('prepared');
    expect(f.publications).toHaveLength(1);
    expect(f.lifecycle.readState()).toBe('stopped');
    expect(() => f.base.broker.captureInspectionAuthority()).toThrow();
    expect(f.events.indexOf('exit')).toBeLessThan(f.events.indexOf('reclaim'));
    expect(f.events.indexOf('reclaim')).toBeLessThan(f.events.indexOf('publish'));
    expect(f.events.indexOf('inspection.closed')).toBeLessThan(f.events.indexOf('exit'));
    expect(f.events).toContain('capabilities.delete');
    expect(f.savedGuard()).toThrow();
    expect(f.relaunch).not.toHaveBeenCalled();
    // Admission, the publisher's two explicit checks and settlement only.
    expect(f.events.filter(event => event === 'export.recheck')).toHaveLength(4);
    await expect(fs.readFile(f.sentinel)).resolves.toEqual(Buffer.from('company retained'));
    await expect(fs.stat(f.base.destinationPath)).resolves.toBeDefined();
    await expect(f.start()).rejects.toThrow();
  });
});

it.each(['secret', 'archive'] as const)('does not snapshot before the actual %s owner settles', async owner => {
  await exercise({ holdSecret: owner === 'secret', holdArchive: owner === 'archive' }, async f => {
    const operation = f.start();
    await f.drainStarted.promise;
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(processBoundary.run).not.toHaveBeenCalled();
    expect(f.events).not.toContain('exit');
    f.gates[owner].resolve();
    expect(await operation).toBe('prepared');
  });
});

it('starts both main I/O drains without waiting for the backend fence acknowledgement', async () => {
  await exercise({ holdFence: true }, async f => {
    const operation = f.start();
    try {
      await f.entered.fence.promise;
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(f.events).toContain('secret.drain.started');
      expect(f.events).toContain('archive.drained');
      expect(f.publications).toHaveLength(0);
      expect(processBoundary.run).not.toHaveBeenCalled();
    } finally { f.gates.fence.resolve(); await operation; }
  });
});

it.each(['mainDrain', 'fence'] as const)('joins the other owner after %s fails during paired preparation', async failed => {
  await exercise({ holdFence: failed === 'mainDrain', failArchive: failed === 'mainDrain',
    failFence: failed === 'fence', holdSecret: failed === 'fence' }, async f => {
    let settled = false;
    const operation = f.start().catch(error => error).finally(() => { settled = true; });
    try {
      if (failed === 'mainDrain') await f.entered.fence.promise;
      else await f.drainStarted.promise;
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(settled).toBe(false);
      expect(f.publications).toHaveLength(0);
      expect(processBoundary.run).not.toHaveBeenCalled();
    } finally { f.gates.fence.resolve(); f.gates.secret.resolve(); await operation; }
    expect(await operation).toBeInstanceOf(Error);
    expect(f.publications).toHaveLength(0);
    expect(f.relaunch).not.toHaveBeenCalled();
    expect(f.events).toContain('brokers.closed');
    expect(f.lifecycle.readState()).toBe('stopFailed');
    if (failed === 'fence') expect(f.originalFailures[0]).toMatchObject({ firstFailure: f.firstFailure });
    else expect(f.originalFailures[0]).toMatchObject({
      firstFailure: { phase: 'archive', reason: 'operationFailed' },
    });
  });
});

it.each(['inspection', 'exit', 'reclaim'] as const)('does not publish or return before %s completion', async owner => {
  await exercise({ holdInspectionClose: owner === 'inspection', holdExit: owner === 'exit', holdReclaim: owner === 'reclaim' }, async f => {
    const operation = f.start();
    await f.entered[owner].promise;
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(f.publications).toHaveLength(0);
    expect(f.relaunch).not.toHaveBeenCalled();
    await expect(f.lifecycle.assertNoActiveWorkspaceRuntime()).rejects.toThrow();
    f.gates[owner].resolve();
    expect(await operation).toBe('prepared');
  });
});

it.each(['navigation', 'external', 'lease', 'registry', 'reservation'] as const)(
  'does not revive %s revocation after the expected own-stop finishes', async kind => {
    await exercise({ holdExit: true }, async f => {
      const result = f.start().catch(error => error);
      await f.entered.exit.promise;
      if (kind === 'navigation') f.navigate();
      if (kind === 'external') f.externalShutdown();
      if (kind === 'lease') await f.base.handle.release();
      if (kind === 'registry') await f.registry.write({ ...f.initial, activeWorkspaceId: null });
      if (kind === 'reservation') f.loseReservation();
      f.gates.exit.resolve();
      expect(await result).toBeInstanceOf(Error);
      expect(f.publications).toHaveLength(0);
      expect(f.relaunch).not.toHaveBeenCalled();
      await expect(fs.stat(f.base.destinationPath)).resolves.toBeDefined();
    });
  },
);

it('rejects a named-fence loss even with a live channel and preserved request', async () => {
  await exercise({ holdExit: true }, async f => {
    const result = f.start().catch(error => error);
    await f.entered.exit.promise;
    await f.base.broker.invalidateDeleteMaintenance(sourceId);
    f.gates.exit.resolve();
    expect(await result).toBeInstanceOf(Error);
    expect(f.lifecycle.readState()).toBe('stopFailed');
    expect(f.publications).toHaveLength(0);
  });
});

it('closes owned resources after a native confirmation failure without publishing', async () => {
  await exercise({ failConfirmation: true }, async f => {
    await expect(f.start()).rejects.toThrow();
    expect(f.originalFailures[0]).toBe(f.firstFailure);
    expect(f.events).toContain('brokers.closed');
    expect(f.lifecycle.readState()).toBe('stopped');
    expect(f.publications).toHaveLength(0);
    expect(f.relaunch).not.toHaveBeenCalled();
    await expect(fs.stat(f.base.destinationPath)).resolves.toBeDefined();
  });
});

it('does not open a confirmation after revocation at receipt settlement', async () => {
  await exercise({}, async f => {
    const original = backupProof.beginDeletionBackupProof;
    const spy = vi.spyOn(backupProof, 'beginDeletionBackupProof').mockImplementation((...args) => {
      const proof = original(...args);
      return { ...proof, issue: content => proof.issue(content).then(receipt => {
        queueMicrotask(f.navigate);
        return receipt;
      }) };
    });
    try {
      await expect(f.start()).rejects.toThrow();
      expect(f.events).not.toContain('confirm.delete');
      expect(f.events).toContain('brokers.closed');
      expect(f.publications).toHaveLength(0);
    } finally { spy.mockRestore(); }
  });
});

it('keeps the initial backup error when cleanup strict-stop also fails', async () => {
  await exercise({ failBackup: true, failStop: true }, async f => {
    await expect(f.start()).rejects.toThrow();
    expect(f.originalFailures[0]).toBeInstanceOf(WorkspaceDeletionPreparationFailure);
    expect(f.originalFailures[0]).toMatchObject({ firstFailure: f.firstFailure,
      cleanupFailure: { firstFailure: { phase: 'backend', reason: 'operationFailed' } } });
    expect(f.events).toContain('brokers.closed');
    expect(f.lifecycle.readState()).toBe('stopFailed');
    expect(f.publications).toHaveLength(0);
    expect(f.relaunch).not.toHaveBeenCalled();
  });
});

it('does not let update or another delete owner join the selected delete stop', async () => {
  await exercise({ holdExit: true }, async f => {
    const operation = f.start();
    await f.entered.exit.promise;
    await expect(f.lifecycle.stopForUpdate(workspaceId, sourceId)).rejects.toThrow();
    await expect(f.lifecycle.stopForDelete(workspaceId, randomUUID())).rejects.toThrow();
    const ordinaryFollower = f.lifecycle.stopAndProveHandlesClosed(workspaceId);
    try {
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(f.events).not.toContain('exit');
    } finally { f.gates.exit.resolve(); await ordinaryFollower; }
    expect(await operation).toBe('prepared');
    expect(f.events.filter(value => value === 'exit')).toHaveLength(1);
  });
});

it('does not treat an unsuccessful strict backend stop as return or publication', async () => {
  await exercise({ failStop: true, cancel: true, returnChoice: true }, async f => {
    await expect(f.start()).rejects.toThrow();
    expect(f.lifecycle.readState()).toBe('stopFailed');
    expect(f.events).toContain('brokers.closed');
    expect(f.events).not.toContain('clean');
    expect(f.publications).toHaveLength(0);
    expect(f.relaunch).not.toHaveBeenCalled();
  });
});

it('joins a still-running secret drain when archive drain already failed', async () => {
  await exercise({ failArchive: true, holdSecret: true }, async f => {
    const result = f.start().catch(error => error);
    await f.drainStarted.promise;
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(f.events).not.toContain('exit');
    f.gates.secret.resolve();
    expect(await result).toBeInstanceOf(Error);
    expect(f.lifecycle.readState()).toBe('stopFailed');
    expect(f.publications).toHaveLength(0);
    expect(f.events).not.toContain('clean');
  });
});

it.each([false, true])('cancellation requests return only for explicit choice %s', async returnChoice => {
  await exercise({ cancel: true, returnChoice, holdReturn: true }, async f => {
    const operation = f.start();
    await f.entered.return.promise;
    expect(f.relaunch).not.toHaveBeenCalled();
    expect(f.lifecycle.readState()).toBe('stopped');
    f.gates.return.resolve();
    expect(await operation).toBe(returnChoice ? 'returnRequested' : 'cancelled');
    expect(f.relaunch).toHaveBeenCalledTimes(returnChoice ? 1 : 0);
    expect(f.base.lease.readState()).toBe('idle');
    expect(f.publications).toHaveLength(0);
    await expect(fs.stat(f.base.destinationPath)).resolves.toBeDefined();
    await expect(fs.readFile(f.sentinel)).resolves.toEqual(Buffer.from('company retained'));
  });
});

it('rejects external invalidation while the explicit return choice is pending', async () => {
  await exercise({ cancel: true, returnChoice: true, holdReturn: true }, async f => {
    const result = f.start().catch(error => error);
    await f.entered.return.promise;
    f.navigate(); f.gates.return.resolve();
    expect(await result).toBeInstanceOf(Error);
    expect(f.relaunch).not.toHaveBeenCalled();
  });
});

it('rechecks request and reservation in the final deferred return callback', async () => {
  await exercise({ cancel: true, returnChoice: true }, async f => {
    f.beforeCompletion.mockImplementationOnce(() => f.loseReservation());
    await expect(f.start()).rejects.toThrow();
    expect(f.relaunch).not.toHaveBeenCalled();
    expect(f.events).toContain('return.revoked');
    expect(f.base.lease.readState()).toBe('idle');
    expect(f.observer.record).toHaveBeenCalledTimes(1);
    expect(f.observer.record).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'failed', retryable: false, sideEffectState: 'unknown', stage: 'deletePreparation',
    }));
    expect(JSON.stringify(f.observer.record.mock.calls)).not.toContain('SYNTHETIC_RESERVATION_LOST');
  });
});

it('revokes a publisher guard when the window navigates during publication', async () => {
  await exercise({ holdPublication: true }, async f => {
    const result = f.start().catch(error => error);
    await f.entered.publish.promise;
    f.navigate(); f.gates.publish.resolve();
    expect(await result).toBeInstanceOf(Error);
    expect(f.savedGuard()).toThrow();
  });
});

it('keeps the backup receipt guard attached to the final publication callback', async () => {
  await exercise({ holdPublication: true }, async f => {
    const original = backupProof.beginDeletionBackupProof;
    let invalidate: (() => void) | undefined;
    const spy = vi.spyOn(backupProof, 'beginDeletionBackupProof').mockImplementation((...args) => {
      const proof = original(...args);
      invalidate = proof.invalidate;
      return proof;
    });
    try {
      const operation = f.start().catch(error => error);
      await f.entered.publish.promise;
      expect(invalidate).toBeTypeOf('function');
      invalidate!();
      expect(f.savedGuard()).toThrow();
      f.gates.publish.resolve();
      expect(await operation).toBeInstanceOf(Error);
      expect(f.events).not.toContain('publish');
    } finally { spy.mockRestore(); }
  });
});

it('rejects an export changed during publication without publishing or deleting company data', async () => {
  await exercise({ holdPublication: true }, async f => {
    const operation = f.start().catch(error => error);
    await f.entered.publish.promise;
    const changed = await fs.readFile(f.base.destinationPath);
    changed[changed.length - 1]! ^= 1;
    await fs.chmod(f.base.destinationPath, 0o600);
    await fs.writeFile(f.base.destinationPath, changed);
    f.gates.publish.resolve();
    expect(await operation).toBeInstanceOf(Error);
    expect(f.originalFailures[0]).toMatchObject({ message: 'WORKSPACE_DELETE_BACKUP_UNAVAILABLE' });
    expect(f.events).not.toContain('publish');
    expect(f.savedGuard()).toThrow();
    expect(f.relaunch).not.toHaveBeenCalled();
    await expect(fs.readFile(f.sentinel)).resolves.toEqual(Buffer.from('company retained'));
    await expect(fs.readFile(f.base.destinationPath)).resolves.toEqual(changed);
  });
});

it.each([false, true])('uses explicit loss consent without a backup for other target %s', async otherTarget => {
  await exercise({ backupChoice: 'explicitDataLoss', otherTarget, recoveryRequired: otherTarget }, async f => {
    expect(await f.start()).toBe('prepared');
    expect(f.events).not.toContain('export.recheck');
    expect(f.events.indexOf('confirm.loss')).toBeLessThan(f.events.indexOf('confirm.delete'));
    expect(f.events).toContain('exit');
    expect(processBoundary.run).not.toHaveBeenCalled();
    expect(f.publications).toHaveLength(1);
    expect(f.savedGuard()).toThrow();
    await expect(fs.readFile(f.sentinel)).resolves.toEqual(Buffer.from('company retained'));
  });
});

it.each([false, true])('cannot substitute the active backup for unavailable target, selector %s', async selector => {
  await exercise({ otherTarget: true, selector }, async f => {
    await expect(f.start()).rejects.toThrow();
    expect(f.events).not.toContain('confirm.loss');
    expect(f.events).not.toContain('confirm.delete');
    expect(f.events).not.toContain('exit');
    expect(f.publications).toHaveLength(0);
    expect(processBoundary.run).not.toHaveBeenCalled();
    expect(f.base.state.getStatus()).toBe('normal');
  });
});

it('cancels declined loss consent without sealing or stopping the current runtime', async () => {
  await exercise({ backupChoice: 'explicitDataLoss', rejectLoss: true }, async f => {
    expect(await f.start()).toBe('cancelled');
    expect(f.lifecycle.readState()).toBe('active');
    expect(f.events).not.toContain('confirm.delete');
    expect(f.events).not.toContain('exit');
    expect(f.publications).toHaveLength(0);
    expect(f.base.state.getStatus()).toBe('normal');
  });
});

it('rejects a stale loss dialog before starting maintenance', async () => {
  await exercise({ backupChoice: 'explicitDataLoss', holdLoss: true }, async f => {
    const operation = f.start().catch(error => error);
    await f.entered.loss.promise;
    f.navigate(); f.gates.loss.resolve();
    expect(await operation).toBeInstanceOf(Error);
    expect(f.events).not.toContain('exit');
    expect(f.base.state.getStatus()).toBe('normal');
    expect(f.publications).toHaveLength(0);
  });
});

it('does not silently convert a cancelled backup into data-loss consent', async () => {
  await exercise({ cancelBackup: true }, async f => {
    expect(await f.start()).toBe('cancelled');
    expect(f.events).not.toContain('confirm.loss');
    expect(f.events).not.toContain('confirm.delete');
    expect(f.events).toContain('exit');
    expect(f.publications).toHaveLength(0);
    expect(processBoundary.run).not.toHaveBeenCalled();
  });
});

it.each([false, true])('preserves the selector null return and explicit choice %s', async returnChoice => {
  await exercise({ selector: true, backupChoice: 'explicitDataLoss', cancel: true, returnChoice }, async f => {
    expect(await f.start()).toBe(returnChoice ? 'returnRequested' : 'cancelled');
    expect(f.relaunch).toHaveBeenCalledTimes(returnChoice ? 1 : 0);
    expect(f.events).not.toContain('exit');
    expect(f.events).not.toContain('clean');
    expect(f.base.state.getStatus()).toBe('normal');
    expect(processBoundary.run).not.toHaveBeenCalled();
    expect((await f.registry.read())?.activeWorkspaceId).toBeNull();
  });
});

it('prepares a selector target without fabricating a backend exit or a backup', async () => {
  await exercise({ selector: true, backupChoice: 'explicitDataLoss' }, async f => {
    expect(await f.start()).toBe('prepared');
    expect(f.publications).toHaveLength(1);
    expect(f.events).not.toContain('exit');
    expect(f.events).not.toContain('clean');
    expect(f.savedGuard()).toThrow();
    expect(f.base.state.getStatus()).toBe('normal');
  });
});

async function exercise(options: Options, run: (f: Awaited<ReturnType<typeof fixture>>) => Promise<void>) {
  const f = await fixture(options);
  let initial: { error: unknown } | undefined;
  try { await run(f); }
  catch (error) { initial = { error }; }
  try { await f.close(); }
  catch (cleanupFailure) {
    if (initial !== undefined) throw new AggregateError([initial.error, cleanupFailure],
      'SYNTHETIC_HANDOFF_TEST_AND_CLEANUP_FAILED', { cause: initial.error });
    throw cleanupFailure;
  }
  if (initial !== undefined) throw initial.error;
}

async function fixture(options: Options) {
  const tasks: Promise<unknown>[] = [];
  const track = <T>(task: Promise<T>) => { tasks.push(task); void task.catch(() => undefined); return task; };
  const events: string[] = [];
  const firstFailure = new Error('SYNTHETIC_INITIAL_FAILURE');
  const originalFailures: unknown[] = [];
  const gateNames = ['secret', 'archive', 'inspection', 'exit', 'reclaim', 'return', 'publish', 'loss', 'fence'] as const;
  const gates = Object.fromEntries(gateNames.map(name => [name, deferred()])) as Record<typeof gateNames[number], ReturnType<typeof deferred>>;
  const entered = Object.fromEntries(gateNames.map(name => [name, deferred()])) as typeof gates;
  const drainStarted = deferred();
  let lifetime: WorkspaceDeletionPreparationLifetime | undefined;
  const base = await backupFixture({ beginDeleteMaintenance: false, deferMaintenanceLease: true,
    assertValid: () => lifetime?.assertCurrent(),
    retainEvidence: () => originalFailures.length !== 0 });
  if (options.holdFence) {
    const begin = base.broker.beginDeleteMaintenance.bind(base.broker);
    vi.spyOn(base.broker, 'beginDeleteMaintenance').mockImplementation(async id => {
      entered.fence.resolve(); await gates.fence.promise; return begin(id);
    });
  }
  if (options.failFence) vi.spyOn(base.broker, 'beginDeleteMaintenance').mockRejectedValue(firstFailure);
  const registry = new WorkspaceRegistryStore({ installationRoot: base.root, filePath: join(base.root, WORKSPACE_REGISTRY_FILE_NAME) });
  const targetWorkspaceId = options.otherTarget ? validateWorkspaceId('44444444-4444-4444-8444-444444444444') : workspaceId;
  const initial = { formatVersion: 2 as const, activeWorkspaceId: options.selector ? null : workspaceId, workspaces: [{
    workspaceId, workspaceLabel: label, lineageIdentity: { formatVersion: 1 as const, profileId },
    layoutVersion: 1 as const, lifecycleState: 'ready' as const, createdAt: '2026-10-27T00:00:00.000Z',
  }, ...(options.otherTarget ? [{
    workspaceId: targetWorkspaceId, workspaceLabel: label, lineageIdentity: { formatVersion: 1 as const, profileId: 'e'.repeat(64) },
    layoutVersion: 1 as const, lifecycleState: options.recoveryRequired ? 'recoveryRequired' as const : 'ready' as const,
    createdAt: '2026-10-27T00:00:00.000Z',
  }] : [])] };
  await registry.write(initial);
  const companyPaths = deriveWorkspaceRoot(base.root, workspaceId, 1);
  const companyRoot = companyPaths.workspaceRoot;
  await fs.mkdir(companyRoot, { recursive: true, mode: 0o700 });
  await expect(inspectWorkspaceRoot(companyPaths)).resolves.toBe(companyPaths);
  const sentinel = join(companyRoot, 'sentinel'); await fs.writeFile(sentinel, 'company retained', { flag: 'wx' });
  if (options.otherTarget) {
    const targetPaths = deriveWorkspaceRoot(base.root, targetWorkspaceId, 1);
    await fs.mkdir(targetPaths.workspaceRoot, { recursive: true, mode: 0o700 });
    await expect(inspectWorkspaceRoot(targetPaths)).resolves.toBe(targetPaths);
  }
  let reservationCurrent = true;
  const assertReservation = () => { if (!reservationCurrent) throw new Error('SYNTHETIC_RESERVATION_LOST'); };
  const beforeCompletion = vi.fn<() => void>();
  const relaunch = vi.fn();
  let returnGuard: (() => void) | undefined;
  const deferredReturn = new DeferredWorkspaceRuntimeRelaunch(() => {
    try {
      if (!returnGuard) throw new Error('NO_RETURN_AUTHORITY');
      returnGuard();
      expect(base.lease.readState()).toBe('busy');
      relaunch();
    } catch (cause) { events.push('return.revoked'); throw cause; }
  });
  const secretFile = new EncryptedSecretFile(join(companyRoot, 'company-email-smtp-v1.dat'));
  const [secretClientTransport, secretMainTransport] = createLinkedSecretTransports();
  const secretGeneration = randomUUID();
  const secretMain = startSecretBrokerMain({ generationId: secretGeneration,
    encryptedSecretFile: { ...secretFile, confirm: value => secretFile.confirm(value), remove: () => secretFile.remove(),
      write: value => secretFile.write(value), async readCandidate() {
        entered.secret.resolve(); if (options.holdSecret) await gates.secret.promise;
        return secretFile.readCandidate();
      } },
    protector: { encrypt: async () => { throw new Error('UNEXPECTED_ENCRYPT'); },
      decrypt: async () => { throw new Error('UNEXPECTED_DECRYPT'); } }, transport: secretMainTransport,
  });
  const secretClient = new CompanyEmailSecretBrokerClient(secretClientTransport, { generationId: secretGeneration });
  if (options.holdSecret) { track(secretClient.hasSecret('synthetic-company')); await entered.secret.promise; }
  const archivePaths = createInvoicePdfArchiveRuntimePaths(companyRoot);
  const archive = new InvoicePdfArchiveService({
    configStore: new InvoicePdfArchiveConfigStore(archivePaths.configFilePath),
    journalStore: new InvoicePdfArchiveJournalStore(archivePaths.journalFilePath),
    loadDocument: async () => { throw new Error('UNEXPECTED_DOCUMENT'); },
    async probeDirectory() { entered.archive.resolve(); await gates.archive.promise; },
  });
  if (options.holdArchive) {
    const external = join(base.root, 'user-selected-archive'); await fs.mkdir(external);
    track(archive.chooseDirectory(external)); await entered.archive.promise;
  }
  const slot = (name: string) => createReadOnlyJournalSlotPaths(join(base.root, name));
  const guard = new MainOwnedWorkspaceManagementOperationGuard({ adoptionJournal: slot('adoption'), creationJournal: slot('creation'),
    directSetupRecovery: slot('setup'), importJournal: slot('import'), profileRestoreJournal: slot('restore'),
    replacementJournal: slot('replacement'), switchJournal: slot('switch'), updateJournal: slot('update') });
  const requestQuiescence = new BackendRequestQuiescence();
  let capability!: ReturnType<typeof createWorkspaceManagementCapability>;
  let service!: WorkspaceManagementService;
  const lifecycle = new MainOwnedActiveWorkspaceLifecycle(workspaceId, requestQuiescence, {
    async sealAndDrainSecrets() { events.push('secret.drain.started'); drainStarted.resolve(); await secretMain.sealAndDrain(); events.push('secret.drained'); },
    async stopRecoveryPointScheduler() { events.push('scheduler.stopped'); },
    async disposeCapabilities(purpose) {
      if (purpose !== 'delete') capability.dispose();
      service.closeAdmission();
      events.push(`capabilities.${purpose ?? 'ordinary'}`);
      entered.inspection.resolve(); if (options.holdInspectionClose) await gates.inspection.promise;
      await base.client.shutdown(); events.push('inspection.closed');
    },
    async stopBackend() { throw new Error('UNEXPECTED_ORDINARY_STOP'); },
    async stopBackendForUpdate() { throw new Error('UNEXPECTED_UPDATE_STOP'); },
    deletion: {
      async sealAndDrainArchive() {
        if (await archive.sealAndDrain() !== 'drained' || options.failArchive) throw new Error('SYNTHETIC_ARCHIVE_DRAIN_UNCERTAIN');
        events.push('archive.drained');
      },
      async stopBackend(id) {
        // Controlled process/HTTP/reservation boundary, not a real utility process.
        await base.broker.assertDeleteMaintenance(id);
        entered.exit.resolve(); if (options.holdExit) await gates.exit.promise;
        await base.broker.assertDeleteMaintenance(id);
        if (options.failStop) throw new Error('SYNTHETIC_STRICT_EXIT_FAILED');
        base.backend.close(); events.push('exit');
        entered.reclaim.resolve(); if (options.holdReclaim) await gates.reclaim.promise;
        assertReservation(); events.push('reclaim');
      },
    },
    async closeBrokers() { base.broker.close(); base.backend.close(); await secretMain.close(); secretClient.close(); events.push('brokers.closed'); },
    async markCleanShutdown() { events.push('clean'); },
  }, deferredReturn);
  const selectorLifecycle = options.selector ? new MainOwnedSelectorWorkspaceLifecycle({
    assertSelectorCurrent: assertReservation, reservation: {
      assertMainCurrent: assertReservation, async assertMainOwned() { assertReservation(); },
    }, maintenanceLease: base.lease, runtimeRelaunch: deferredReturn,
  }) : undefined;
  const publications: string[] = [];
  const observer = { record: vi.fn<WorkspaceManagementObserver['record']>() };
  let savedGuard: (() => void) | undefined;
  const unexpected = async (): Promise<never> => { throw new Error('UNEXPECTED_COMMAND'); };
  service = new WorkspaceManagementService({
    createEmpty: { create: unexpected }, importBackup: { import: unexpected }, renameWorkspace: { rename: unexpected },
    switchWorkspace: { switchTo: unexpected }, operationGuard: guard, registry, maintenanceState: base.lease, observer,
    runtimeRelaunchCompletion: { complete(assertCurrent) { beforeCompletion(); deferredReturn.complete(assertCurrent); } },
    deletionPreparation: {
      maintenanceLease: { acquire: base.acquireLease,
        captureCurrentOwner: purposes => base.lease.captureCurrentOwner(purposes) },
      async prepare(selected, authority, assertLease) {
      lifetime = authority;
      return prepareWorkspaceDeletion({ operationId: sourceId, request: selected,
        installationRoot: base.root, runtimeGeneration: secretGeneration, lifetime: authority, registry,
        assertLease, async assertMainReservation() { assertReservation(); }, assertMainReservationCurrent: assertReservation,
        closeServiceAdmission: () => service.closeAdmission(),
        runtime: selectorLifecycle !== undefined ? { kind: 'selector', lifecycle: selectorLifecycle } : { kind: 'active', workspaceId, lifecycle, broker: base.broker,
        createBackup: owner => {
          if (options.failBackup) throw firstFailure;
          if (options.cancelBackup) return Promise.resolve(null);
          return base.service.createForDeletion({ destinationPath: base.destinationPath, password: 'Synthetic bound inspection 2026!' }, owner);
        },
        recheckExport: () => {
          events.push('export.recheck');
          return readDeletionBackupExportIdentity(base.destinationPath, () => {
            authority.assertCurrent(); assertLease(); assertReservation();
          });
        },
        },
        async confirmDataLoss() {
          events.push('confirm.loss'); entered.loss.resolve();
          if (options.holdLoss) await gates.loss.promise;
          return !options.rejectLoss;
        },
        async confirmDeletion() { events.push('confirm.delete'); if (options.failConfirmation) throw firstFailure; return !options.cancel; },
        async confirmReturn() { entered.return.resolve(); if (options.holdReturn) await gates.return.promise; return options.returnChoice ?? false; },
        setReturnGuard(value) { returnGuard = value; },
        async publish(check, selection, target) {
          expect(target.workspaceId).toBe(targetWorkspaceId);
          expect(target.previousActiveWorkspaceId).toBe(initial.activeWorkspaceId);
          expect(Object.isFrozen(target)).toBe(true);
          savedGuard = check; await selection(); check(); publications.push('attempt');
          entered.publish.resolve(); if (options.holdPublication) await gates.publish.promise;
          await selection(); check(); events.push('publish');
        },
      }).catch(error => { originalFailures.push(error); throw error; });
    } },
  });
  const handlers = new Map<string, unknown>();
  const webContents = Object.assign(new EventEmitter(), { mainFrame: {}, isDestroyed: () => false });
  const window = Object.assign(new EventEmitter(), { webContents, isDestroyed: () => false });
  const event = { sender: webContents, senderFrame: webContents.mainFrame } as unknown as IpcMainInvokeEvent;
  capability = createWorkspaceManagementCapability({ mainWindow: window as unknown as BrowserWindow, service,
    ipcMain: { handle(name, handler) { handlers.set(name, handler); }, removeHandler(name) { handlers.delete(name); } },
    passwordWindow: { requestPassword: unexpected }, confirmActiveWorkspaceReplacement: unexpected,
    selectBackupSource: unexpected, selectReplacementBackupSource: unexpected, showSafeError() {},
  });
  return { base, registry, initial, lifecycle, events, publications, relaunch, gates, entered, drainStarted, sentinel, beforeCompletion,
    firstFailure, originalFailures, observer,
    start: () => track(capability.prepareDeletion(event, { formatVersion: 1, workspaceId: targetWorkspaceId, typedLabel: label,
      backupChoice: options.backupChoice ?? 'createBackup' })),
    savedGuard: () => savedGuard!,
    navigate: () => webContents.emit('did-start-navigation', { isMainFrame: true }),
    loseReservation() { reservationCurrent = false; },
    externalShutdown() {
      capability.dispose(); guard.dispose();
      track(capability.shutdown()); track(service.shutdown());
      track(lifecycle.stopAndProveHandlesClosed(workspaceId));
    },
    async close() {
      for (const gate of Object.values(gates)) gate.resolve();
      await Promise.allSettled(tasks);
      const cleanup = await Promise.allSettled([base.client.shutdown(), capability.shutdown(), service.shutdown(), secretMain.close()]);
      secretClient.close(); guard.dispose(); requestQuiescence.stop();
      // All synthetic files and the first failure remain outside build outputs.
      const failures = cleanup.filter(result => result.status === 'rejected').map(result => result.reason);
      if (failures.length !== 0) throw new AggregateError(failures, 'SYNTHETIC_HANDOFF_CLEANUP_FAILED');
    },
  };
}
