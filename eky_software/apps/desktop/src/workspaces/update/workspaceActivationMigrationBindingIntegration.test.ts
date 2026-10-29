import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi, type TestContext } from 'vitest';

import { createRestoreStartupTestLifetime } from '../../main/desktopRestoreStartupTestSupport.js';
import { RecoveryPointCleanupError } from '../../profileBackup/recoveryPoint/recoveryPointOperationError.js';
import { ProfileRestoreActivationJournalStore } from '../../profileBackup/restore/profileRestoreActivationJournalStore.js';
import { createWorkspaceRemnantBindingPaths } from '../deletion/workspaceRemnantBindingPaths.js';
import { validateWorkspaceBackupImportOperationId } from '../import/workspaceBackupImportOperationId.js';
import { InMemoryWorkspaceMaintenanceLease, type WorkspaceMaintenanceLeaseHandle } from '../maintenance/workspaceMaintenanceLease.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import { serializeWorkspaceRegistry } from '../registry/workspaceRegistrySerializer.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { ProfileRestoreWorkspaceReplacementActivationFactory } from '../replacement/workspaceBackupReplacementActivationFactory.js';
import { validateWorkspaceBackupReplacementOperationId } from '../replacement/workspaceBackupReplacementOperationId.js';
import { deriveWorkspaceBackupReplacementPaths } from '../replacement/workspaceBackupReplacementPaths.js';
import { NodeWorkspaceBackupReplacementRootStore } from '../replacement/workspaceBackupReplacementRootStore.js';
import { createWorkspaceSwitchJournalPaths, serializeVersionedWorkspaceSwitchJournal, WorkspaceSwitchJournalStore } from '../switch/workspaceSwitchJournal.js';
import { createWorkspaceSelectorSwitchJournal, createWorkspaceSelectorSwitchRegistryVariants } from '../switch/workspaceSelectorSwitchState.js';
import { createSwitchJournal, createSwitchRegistry, TEST_SOURCE_WORKSPACE_ID, TEST_SWITCH_CREATED_AT,
  TEST_SWITCH_OPERATION_ID, TEST_TARGET_WORKSPACE_ID } from '../switch/workspaceSwitchTestSupport.js';
import { NodeWorkspaceActivationMigrationStaging } from './nodeWorkspaceActivationMigrationStaging.js';
import { WorkspaceActivationMigrationBinding } from './workspaceActivationMigrationBinding.js';
import { WorkspaceActivationMigrationCoordinator } from './workspaceActivationMigrationCoordinator.js';
import { WorkspaceActivationMigrationGuard, type WorkspaceActivationMigrationProof } from './workspaceActivationMigrationGuard.js';
import { WorkspaceActivationMigrationRecoveryPoint } from './workspaceActivationMigrationRecoveryPoint.js';

const operationId = validateWorkspaceBackupImportOperationId(TEST_SWITCH_OPERATION_ID);
const profileId = 'b'.repeat(64);
const migrationChainIdentity = 'c'.repeat(64);
type Fault = 'lostAcknowledgement' | 'snapshotSelectionChanged' | 'candidateSelectionChanged' | 'cleanupUnverified';

describe('activation migration coordinator binding integration', () => {
  it.for([false, true])('publishes before snapshot and uses guarded real activation (selector: %s)', async (selector, context) => {
    await runFixture(context, selector, undefined, async (f, lifetime) => {
      await lifetime.step('startup', async () => {
        await expect(f.coordinator.migrateAndActivate(f.input)).resolves.toBe('relaunchRequired');
      });
      await lifetime.step('restoredContentCheck', async () => {
        expect(f.events.indexOf('binding.published')).toBeLessThan(f.events.indexOf('snapshot.create'));
        expect(f.events.indexOf('runtime.stop')).toBeLessThan(f.events.indexOf('candidate.migrate'));
        expect(f.maintenance.readState()).toBe('idle');
        expect(f.blockContinuation).not.toHaveBeenCalled();
        expect(f.requestRelaunch).toHaveBeenCalledOnce();
        expect(f.sourceRecovery.recoverFromFailure).not.toHaveBeenCalled();
        expect(f.legacyRegistryRead).not.toHaveBeenCalled();
        expect(f.legacySwitchRead).not.toHaveBeenCalled();
        expect(await f.activation.journalStore.peek()).toMatchObject({ operationId, phase: 'validationStarting' });
        expect(await readFile(f.paths.activeDatabasePath, 'utf8')).toBe('migrated candidate');
        expect(await readFile(join(f.paths.activeArtifactRoot, 'document.pdf'), 'utf8')).toBe('%PDF migrated');
        await expect(readFile(f.snapshotPath)).rejects.toMatchObject({ code: 'ENOENT' });
        expect(await readFile(f.registryPath)).toEqual(f.registryBytes);
        expect(await readFile(f.journalPath)).toEqual(f.journalBytes);
      });
    });
  });

  it.for(['lostAcknowledgement', 'snapshotSelectionChanged', 'candidateSelectionChanged', 'cleanupUnverified'] as const)(
    'retains real evidence and the original failure without recovery after %s', async (fault, context) => {
      await runFixture(context, false, fault, async (f, lifetime) => {
        const error = await lifetime.step('startup', () =>
          f.coordinator.migrateAndActivate(f.input).catch((failure: unknown) => failure));
        await lifetime.step('restoredContentCheck', async () => {
          expect(error).toMatchObject({ code: 'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED' });
          expect(containsCause(error, f.primary)).toBe(true);
          expect(f.blockContinuation).toHaveBeenCalled();
          expect(f.stop).toHaveBeenCalledTimes(fault === 'candidateSelectionChanged' ? 1 : 0);
          expect(f.migrate).toHaveBeenCalledTimes(fault === 'candidateSelectionChanged' ? 1 : 0);
          expect(f.activationRead).not.toHaveBeenCalled();
          expect(f.removeSnapshot).not.toHaveBeenCalled();
          expect(f.sourceRecovery.recoverFromFailure).not.toHaveBeenCalled();
          expect(f.sourceRecovery.requireRecovery).not.toHaveBeenCalled();
          expect(f.requestRelaunch).not.toHaveBeenCalled();
          expect(f.legacyRegistryRead).not.toHaveBeenCalled();
          expect(f.legacySwitchRead).not.toHaveBeenCalled();
          expect(await f.activation.journalStore.peek()).toBeUndefined();
          expect(await readFile(f.paths.activeDatabasePath, 'utf8')).toBe('original target');
          expect(await readFile(join(f.paths.activeArtifactRoot, 'document.pdf'), 'utf8')).toBe('%PDF original');
          expect(JSON.parse(await readFile(f.bindingPath, 'utf8'))).toMatchObject({
            owner: 'workspaceActivationMigration', operationId, workspaceId: TEST_TARGET_WORKSPACE_ID,
          });
          expect(await readFile(f.registryPath)).toEqual(fault === 'snapshotSelectionChanged' || fault === 'candidateSelectionChanged'
            ? Buffer.concat([f.registryBytes, Buffer.from('\n')]) : f.registryBytes);
          expect(await readFile(f.journalPath)).toEqual(f.journalBytes);
          if (fault !== 'lostAcknowledgement') expect(await readFile(f.snapshotPath, 'utf8')).toBe('retained snapshot');
          if (fault === 'candidateSelectionChanged') {
            expect(await readFile(f.paths.candidateDatabasePath, 'utf8')).toBe('migrated candidate');
            expect(await readFile(join(f.paths.candidateArtifactRoot, 'document.pdf'), 'utf8')).toBe('%PDF migrated');
          }
          expect(f.maintenance.readState()).toBe(fault === 'cleanupUnverified' ? 'busy' : 'idle');
        });
      });
    },
  );
});

async function runFixture(
  context: TestContext,
  selector: boolean,
  fault: Fault | undefined,
  body: (f: Awaited<ReturnType<typeof fixture>>, lifetime: ReturnType<typeof createRestoreStartupTestLifetime>) => Promise<void>,
) {
  const lifetime = createRestoreStartupTestLifetime(context, () => undefined);
  try {
    await lifetime.run(async () => {
      const f = await lifetime.step('fixturePreparation', () => fixture(context, lifetime.roots, selector, fault));
      try { await body(f, lifetime); }
      finally { await f.releaseTestLease(); }
    });
  } finally { lifetime.releaseWhenSettled(); }
}

async function fixture(context: TestContext, ownedRoots: string[], selector: boolean, fault?: Fault) {
  const root = await mkdtemp(join(tmpdir(), 'eky-migration-binding-integration-'));
  ownedRoots.push(root);
  const maintenance = new InMemoryWorkspaceMaintenanceLease();
  let held: WorkspaceMaintenanceLeaseHandle | undefined;
  const registryPath = join(root, WORKSPACE_REGISTRY_FILE_NAME);
  const journalPaths = createWorkspaceSwitchJournalPaths(root);
  const before = { ...createSwitchRegistry(), formatVersion: 2 as const, activeWorkspaceId: null };
  const registryValue = selector ? createWorkspaceSelectorSwitchRegistryVariants(before, TEST_TARGET_WORKSPACE_ID).selected
    : createSwitchRegistry(TEST_TARGET_WORKSPACE_ID);
  const journalValue = selector
    ? { ...createWorkspaceSelectorSwitchJournal(before, TEST_TARGET_WORKSPACE_ID, operationId, TEST_SWITCH_CREATED_AT), state: 'targetSelected' as const }
    : createSwitchJournal('targetSelected');
  const registryBytes = Buffer.from(serializeWorkspaceRegistry(registryValue));
  const journalBytes = Buffer.from(serializeVersionedWorkspaceSwitchJournal(journalValue));
  await mkdir(journalPaths.directoryPath, { recursive: true, mode: 0o700 });
  await writeFile(registryPath, registryBytes, { mode: 0o600 });
  await writeFile(journalPaths.currentPath, journalBytes, { mode: 0o600 });
  const registry = new WorkspaceRegistryStore({ installationRoot: root, filePath: registryPath });
  const switchJournal = new WorkspaceSwitchJournalStore(root);
  const state = { blocked: false, stopped: false };
  const assertStartup = () => {
    context.signal.throwIfAborted();
    if (state.blocked) throw new Error('SYNTHETIC_STARTUP_BLOCKED');
  };
  const assertStopped = () => { assertStartup(); if (!state.stopped) throw new Error('SYNTHETIC_TARGET_RUNNING'); };
  const blockContinuation = vi.fn(() => { state.blocked = true; });
  const guard = new WorkspaceActivationMigrationGuard(registry, switchJournal, selector ? {
    selection: { registrySlots: await registry.inspectSlots(), journalSlots: await switchJournal.inspectSlots(),
      readRegistrySlots: () => registry.inspectSlots(), assertAuthority: assertStartup },
    readJournalSlots: () => switchJournal.inspectSlots(),
  } : undefined);
  const proof: Readonly<WorkspaceActivationMigrationProof> = selector
    ? await guard.prove({ operationId, expectedProfileId: profileId, sourceWorkspaceId: null, targetWorkspaceId: TEST_TARGET_WORKSPACE_ID })
    : Object.freeze({ operationId, profileId, sourceWorkspaceId: TEST_SOURCE_WORKSPACE_ID,
      targetWorkspaceId: TEST_TARGET_WORKSPACE_ID, registrySnapshot: registryBytes, switchJournalSnapshot: journalBytes });
  const legacyRegistryRead = vi.spyOn(registry, 'read');
  const legacySwitchRead = vi.spyOn(switchJournal, 'read');
  const registryInspections = vi.spyOn(registry, 'inspectSlots');
  const journalInspections = vi.spyOn(switchJournal, 'inspectSlots');
  const paths = deriveWorkspaceBackupReplacementPaths(root, validateWorkspaceBackupReplacementOperationId(operationId), TEST_TARGET_WORKSPACE_ID);
  await mkdir(dirname(paths.activeDatabasePath), { recursive: true, mode: 0o700 });
  await mkdir(paths.activeArtifactRoot, { recursive: true, mode: 0o700 });
  await writeFile(paths.activeDatabasePath, 'original target', { mode: 0o600 });
  await writeFile(join(paths.activeArtifactRoot, 'document.pdf'), '%PDF original', { mode: 0o600 });
  const activation = new ProfileRestoreWorkspaceReplacementActivationFactory().create(paths);
  const activationRead = vi.spyOn(activation.journalStore, 'read');
  const snapshotRoot = join(root, 'snapshot-staging', operationId);
  const snapshotPath = join(snapshotRoot, 'profile.sqlite');
  const primary = new Error(fault === 'candidateSelectionChanged' ? 'SYNTHETIC_CANDIDATE_FAILURE' : 'SYNTHETIC_SNAPSHOT_FAILURE');
  const events: string[] = [];
  let bindingChecksStarted = 0;
  let bindingChecksSettled = 0;
  context.onTestFinished(({ task }) => {
    if (task.result?.state === 'pass') return;
    console.error(JSON.stringify({ diagnostic: 'workspaceActivationMigrationBindingTest',
      phase: events.at(-1) ?? 'fixturePreparation', bindingChecksStarted, bindingChecksSettled,
      registryInspections: registryInspections.mock.calls.length, journalInspections: journalInspections.mock.calls.length }));
  });
  const journalStore = activation.journalStore;
  if (!(journalStore instanceof ProfileRestoreActivationJournalStore)) throw new Error('SYNTHETIC_ACTIVATION_STORE_INVALID');
  const writeJournal = journalStore.write.bind(journalStore);
  vi.spyOn(journalStore, 'write').mockImplementation(async (...args) => {
    events.push(`activation.journal.${args[0].phase}.started`);
    await writeJournal(...args);
    events.push(`activation.journal.${args[0].phase}.completed`);
  });
  const prepare = activation.transaction.prepare.bind(activation.transaction);
  vi.spyOn(activation.transaction, 'prepare').mockImplementation(async (...args) => {
    events.push('activation.prepare.started');
    await prepare(...args);
    events.push('activation.prepare.completed');
  });
  const advance = activation.transaction.advanceToValidation.bind(activation.transaction);
  vi.spyOn(activation.transaction, 'advanceToValidation').mockImplementation(async (...args) => {
    events.push('activation.advance.started');
    const result = await advance(...args);
    events.push('activation.advance.completed');
    return result;
  });
  const removeSnapshot = vi.fn(async () => { await rm(snapshotRoot, { force: true, recursive: true }); });
  // Snapshot production and child processes are modeled; binding, staging, roots and activation are real.
  const recoveryPoint = new WorkspaceActivationMigrationRecoveryPoint({
    async createPreMigration(cleanup) {
      events.push('snapshot.create');
      await cleanup?.assertOwned();
      cleanup?.assertCurrent();
      await mkdir(snapshotRoot, { recursive: true, mode: 0o700 });
      await writeFile(snapshotPath, 'retained snapshot', { mode: 0o600 });
      if (fault === 'snapshotSelectionChanged') {
        await writeFile(registryPath, Buffer.concat([registryBytes, Buffer.from('\n')]));
        throw primary;
      }
      if (fault === 'cleanupUnverified') throw new RecoveryPointCleanupError(primary);
      return { artifactId: operationId, byteSize: 1, createdAt: TEST_SWITCH_CREATED_AT,
        kind: 'preUpdate', state: 'validatedGood', validatedAt: TEST_SWITCH_CREATED_AT };
    },
  }, {
    async stageForRestore() {
      return { appVersion: '0.2.81', artifactTotalByteSize: 1, createdAt: TEST_SWITCH_CREATED_AT, documentCount: 1,
        migrationChainIdentity, operationRoot: snapshotRoot, profileId };
    },
  }, new NodeWorkspaceActivationMigrationStaging(dirname(snapshotRoot), { removeProfileSnapshot: removeSnapshot }));
  const stop = vi.fn(async () => { events.push('runtime.stop'); state.stopped = true; });
  const migrate = vi.fn(async () => {
    assertStopped();
    events.push('candidate.migrate');
    await writeFile(paths.candidateDatabasePath, 'migrated candidate', { mode: 0o600 });
    await writeFile(join(paths.candidateArtifactRoot, 'document.pdf'), '%PDF migrated', { mode: 0o600 });
    if (fault === 'candidateSelectionChanged') {
      await writeFile(registryPath, Buffer.concat([registryBytes, Buffer.from('\n')]));
      throw primary;
    }
    return { handlesClosed: true as const, migrationChainIdentity, profileId };
  });
  const readiness = () => ({ actorId: 'local-owner' as const, artifactRootHealth: 'ready' as const,
    companyId: 'company-test', databaseHealth: 'healthy' as const, foreignKeyHealth: 'healthy' as const,
    handlesClosed: true as const, lineageIdentity: { formatVersion: 1 as const, profileId },
    migrationChainIdentity, migrationState: 'current' as const });
  const requestRelaunch = vi.fn();
  const sourceRecovery = { recoverFromFailure: vi.fn(async () => 'relaunchRequired' as const),
    requireRecovery: vi.fn(async () => 'recoveryRequired' as const) };
  const bindingPath = createWorkspaceRemnantBindingPaths(root, { owner: 'workspaceActivationMigration', operationId }).currentPath;
  const coordinator = new WorkspaceActivationMigrationCoordinator({
    userDataRoot: root, maintenanceLease: maintenance, guard, blockContinuation,
    createBinding({ lease, proof: captured }) {
      held = lease;
      const binding = new WorkspaceActivationMigrationBinding({ userDataRoot: root, proof: captured, lease,
        maintenanceLease: maintenance, registry, switchJournal,
        startupOwner: { assertCurrent: assertStartup }, stoppedOwner: { assertCurrent: assertStopped, assertOwned: async () => assertStopped() },
        runtimeAbsence: { assertNoActiveWorkspaceRuntime: async () => assertStopped() }, onUncertain: blockContinuation });
      const publish = binding.publishBeforeSnapshot.bind(binding);
      vi.spyOn(binding, 'publishBeforeSnapshot').mockImplementation(async () => {
        await publish(); events.push('binding.published');
        if (fault === 'lostAcknowledgement') throw primary;
      });
      const readback = binding.assertPublished.bind(binding);
      vi.spyOn(binding, 'assertPublished').mockImplementation(async () => {
        bindingChecksStarted += 1;
        try { await readback(); }
        finally { bindingChecksSettled += 1; }
      });
      return binding;
    },
    activationAuthorityFactory: { create: () => activation }, recoveryPoint,
    rootStore: new NodeWorkspaceBackupReplacementRootStore(),
    backupCandidate: { migrate, validateAndMaterialize: async () => readiness(), validatePublished: async () => readiness() },
    sourceRecovery, requestRelaunch, workspaceRuntimeAbsence: { assertNoActiveWorkspaceRuntime: async () => assertStopped() },
  });
  return { coordinator, input: { proof, expectedSourceMigrationChainIdentity: migrationChainIdentity, stopTargetStartupRuntime: stop },
    events, maintenance, blockContinuation, requestRelaunch, sourceRecovery, legacyRegistryRead, legacySwitchRead,
    activation, activationRead, paths, snapshotPath, registryPath, registryBytes, journalPath: journalPaths.currentPath, journalBytes,
    primary, stop, migrate, removeSnapshot, bindingPath, releaseTestLease: async () => { await held?.release(); } };
}

function containsCause(error: unknown, expected: unknown): boolean {
  const pending = [error];
  const seen = new Set<unknown>();
  while (pending.length > 0) {
    const next = pending.pop();
    if (next === expected) return true;
    if (!(next instanceof Error) || seen.has(next)) continue;
    seen.add(next);
    pending.push(next.cause);
    if (next instanceof AggregateError) pending.push(...next.errors);
  }
  return false;
}
