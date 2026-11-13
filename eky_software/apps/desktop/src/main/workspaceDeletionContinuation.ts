import { join } from 'node:path';
import type { DesktopBuildInfo } from '../release/desktopBuildInfo.js';
import type { DesktopReleaseInfo } from '../release/desktopReleaseInfo.js';
import { assertUpdateJournalAuthority } from '../update/updateJournalStore.js';
import { deletionDataRecord } from '../workspaces/deletion/workspaceDeletionDataValidation.js';
import { captureWorkspaceDeletionJournal, sameWorkspaceDeletionJournalBinding,
  type WorkspaceDeletionJournal } from '../workspaces/deletion/workspaceDeletionJournalCodec.js';
import type { WorkspaceDeletionPreparationOptions } from '../workspaces/management/workspaceDeletionPreparation.js';
import type { WorkspaceDeletionCompletion, WorkspaceDeletionRecoveryOwner,
  WorkspaceDeletionFailureOutcome, WorkspaceManagementServiceOptions } from '../workspaces/management/workspaceManagementService.js';
import { mapWorkspaceManagementError, WorkspaceManagementError } from '../workspaces/management/workspaceManagementError.js';
import type { WorkspaceDeletionResultRuntime } from '../workspaces/management/workspaceManagementCapability.js';
import { parseWorkspaceDeletionOperationResult, workspaceManagementCapabilityProtocolVersion } from '../workspaces/management/workspaceManagementCapabilityProtocol.js';
import type { WorkspaceMaintenanceStateReader } from '../workspaces/maintenance/workspaceMaintenanceLease.js';
import type { DeferredWorkspaceRuntimeRelaunch } from '../workspaces/runtime/deferredWorkspaceRuntimeRelaunch.js';
import type { WorkspaceId } from '../workspaces/registry/workspaceRegistryTypes.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../workspaces/registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../workspaces/registry/workspaceRegistryStore.js';
import { WorkspaceDeletionJournalStore } from '../workspaces/deletion/workspaceDeletionJournalStore.js';
import { captureWorkspaceDeletionPhaseSelection } from '../workspaces/deletion/workspaceDeletionPhaseSelection.js';
import { captureWorkspaceDeletionOriginalJournalContinuation } from '../workspaces/deletion/workspaceDeletionOriginalJournalSelection.js';
import { captureWorkspaceDeletionExternalSelectionFromRoot } from '../workspaces/runtime/workspaceDeletionColdAdmission.js';

/** Main-only ports. The publisher owns the complete inventory and its root proof. */
export interface WorkspaceDeletionMainCommand {
  publish(...args: Parameters<WorkspaceDeletionPreparationOptions['publish']>): Promise<Readonly<{
    journal: WorkspaceDeletionJournal;
    workspaceRootIdentity: string;
  }>>;
  resume: NonNullable<WorkspaceManagementServiceOptions['deletionContinuation']>['resume'];
}

/** Reply follow-up only. It neither authorizes nor performs file deletion. */
type WorkspaceDeletionResultRuntimeOptions = Readonly<{
  assertCurrent(): void;
  assertMainCurrent(): void;
  assertOwned(): Promise<void>;
  assertRuntimeAbsent(): Promise<void>;
  readRuntimeState(): 'available' | 'stopped' | 'unavailable';
  maintenanceState: WorkspaceMaintenanceStateReader;
}> & (
  | Readonly<{ kind?: 'runtime';
    runtimeRelaunch: Pick<DeferredWorkspaceRuntimeRelaunch, 'request' | 'complete' | 'isRequested' | 'hasDispatched'>; }>
  | Readonly<{ kind: 'recoveryManagement' }>
);

export function createWorkspaceDeletionResultRuntime(input: WorkspaceDeletionResultRuntimeOptions): Readonly<WorkspaceDeletionResultRuntime> {
  const check = input.assertCurrent.bind(input), owned = input.assertOwned.bind(input);
  const main = input.assertMainCurrent.bind(input);
  const absent = input.assertRuntimeAbsent.bind(input), readState = input.readRuntimeState.bind(input);
  const readMaintenance = input.maintenanceState.readState.bind(input.maintenanceState);
  const recovery = input.kind === 'recoveryManagement';
  const relaunch = input.kind === 'recoveryManagement' ? undefined : Object.freeze({
    request: input.runtimeRelaunch.request.bind(input.runtimeRelaunch),
    complete: input.runtimeRelaunch.complete.bind(input.runtimeRelaunch),
    requested: input.runtimeRelaunch.isRequested.bind(input.runtimeRelaunch),
    dispatched: input.runtimeRelaunch.hasDispatched.bind(input.runtimeRelaunch),
  });
  const requested = () => relaunch?.requested() ?? false;
  const dispatched = () => relaunch?.dispatched() ?? false;
  let recoveryFailure: { readonly cause: unknown } | undefined;
  const retainFailure = (cause: unknown) => { recoveryFailure ??= { cause }; return recoveryFailure.cause; };
  let spent = false;
  const fail = (): never => { throw new Error('WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN'); };
  const assertCurrent = () => {
    if (recovery && recoveryFailure !== undefined) throw recoveryFailure.cause;
    try { assertUpdateJournalAuthority(check); }
    catch (cause) { throw recovery ? retainFailure(cause) : cause; }
  };
  const assertStoppedIdle = () => {
    assertCurrent();
    if (readState() !== 'stopped' || readMaintenance() !== 'idle') fail();
    assertUpdateJournalAuthority(main);
    assertCurrent();
  };
  const readNextAction: WorkspaceDeletionResultRuntime['readNextAction'] = () => {
    try {
      assertCurrent();
      const state = readState(), pending = requested(), sent = dispatched();
      const idle = readMaintenance() === 'idle';
      if (recovery || state === 'stopped') assertUpdateJournalAuthority(main);
      assertCurrent();
      if (idle && state === 'available' && !pending && !sent) return 'continue';
      if (idle && state === 'stopped' && sent) return 'relaunching';
      return 'restartRequired';
    } catch (cause) { throw recovery ? retainFailure(cause) : cause; }
  };
  return Object.freeze({
    readNextAction,
    projectFailure(outcome: Readonly<WorkspaceDeletionFailureOutcome>) {
      const failure = mapWorkspaceManagementError(outcome.cause, 'delete');
      if (outcome.sideEffectState !== 'none') return parseWorkspaceDeletionOperationResult({
        formatVersion: workspaceManagementCapabilityProtocolVersion, status: 'recoveryRequired', errorCode: failure.code,
        sideEffectState: 'unknown', nextAction: 'restartRequired',
      });
      let nextAction: 'continue' | 'restartRequired';
      const mayContinue = failure.code === 'WORKSPACE_MANAGEMENT_BUSY' || failure.code === 'WORKSPACE_MANAGEMENT_INVALID';
      try { nextAction = mayContinue && readNextAction() === 'continue' ? 'continue' : 'restartRequired'; }
      catch (stateFailure) {
        throw new WorkspaceManagementError(failure.code, 'delete', { cause: new AggregateError(
          [outcome.cause, stateFailure], 'WORKSPACE_DELETE_RESULT_UNCERTAIN', { cause: outcome.cause },
        ) });
      }
      return parseWorkspaceDeletionOperationResult({ formatVersion: workspaceManagementCapabilityProtocolVersion, status: 'failed',
        errorCode: failure.code, sideEffectState: 'none', nextAction });
    },
    async complete(value: Readonly<WorkspaceDeletionCompletion>) {
      if (recovery && recoveryFailure !== undefined) throw recoveryFailure.cause;
      try {
        if (spent) fail();
        spent = true;
        if (parseWorkspaceDeletionOperationResult(value).status !== 'completed' || requested()) fail();
        // Only the capability's fulfilled service call enters here: its command
        // and release have settled. Do not borrow the now-expired delete lease.
        assertStoppedIdle();
        const absentResult: unknown = await absent();
        if (recovery && absentResult !== undefined) fail();
        assertStoppedIdle();
        const ownedResult: unknown = await owned();
        if (recovery && ownedResult !== undefined) fail();
        assertStoppedIdle();
        if (relaunch !== undefined) {
          relaunch.request();
          // Never await application shutdown from its own admitted management work.
          relaunch.complete(assertStoppedIdle);
          if (!dispatched()) fail();
        }
      } catch (cause) { throw recovery ? retainFailure(cause) : cause; }
    },
  });
}

type WorkspaceDeletionContinuationOptions = Readonly<{
  command: WorkspaceDeletionMainCommand;
  assertCurrent(): void;
  assertOwned(): Promise<void>;
}> & (
  | Readonly<{ kind?: 'runtime'; activeWorkspaceId: WorkspaceId | null;
    sealActiveMarker(): Promise<void>; recordActiveRemoved(): void; }>
  | Readonly<{ kind: 'recoveryManagement'; persistedActiveWorkspaceId: WorkspaceId | null;
    assertRuntimeCurrent(): void; assertRuntimeAbsent(): Promise<void>; }>
);

export function bindWorkspaceDeletionContinuation(input: WorkspaceDeletionContinuationOptions) {
  // Capture collaborators before the first await; they are never renderer inputs.
  const publish = input.command.publish.bind(input.command);
  const resume = input.command.resume.bind(input.command);
  const assertMain = input.assertCurrent.bind(input);
  const assertOwned = input.assertOwned.bind(input);
  const runtime = input.kind === 'recoveryManagement' ? undefined : Object.freeze({
    activeWorkspaceId: input.activeWorkspaceId,
    seal: input.sealActiveMarker.bind(input), recordActiveRemoved: input.recordActiveRemoved.bind(input),
  });
  const recovery = input.kind === 'recoveryManagement' ? Object.freeze({
    persistedActiveWorkspaceId: input.persistedActiveWorkspaceId,
    assertCurrent: input.assertRuntimeCurrent.bind(input), assertOwned: input.assertRuntimeAbsent.bind(input),
  }) : undefined;
  const persistedActiveWorkspaceId = input.kind === 'recoveryManagement' ? input.persistedActiveWorkspaceId : input.activeWorkspaceId;
  let firstRecoveryFailure: { readonly cause: unknown } | undefined;
  const retainRecoveryFailure = (cause: unknown) => { firstRecoveryFailure ??= { cause }; return firstRecoveryFailure.cause; };
  let selected: WorkspaceDeletionJournal | undefined;
  let publicationStarted = false;
  let captured = false;
  let removed = false;
  let recording = false;
  const fail = (): never => {
    const cause = new Error('WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN');
    throw recovery === undefined ? cause : retainRecoveryFailure(cause);
  };
  const assertCurrent = () => {
    if (recovery === undefined) return assertUpdateJournalAuthority(assertMain);
    if (firstRecoveryFailure !== undefined) throw firstRecoveryFailure.cause;
    try {
      assertUpdateJournalAuthority(assertMain);
      assertUpdateJournalAuthority(recovery.assertCurrent);
      assertUpdateJournalAuthority(assertMain);
    } catch (cause) { throw retainRecoveryFailure(cause); }
  };
  const assertRecoveryOwned = async () => {
    try {
      assertCurrent();
      if (recovery !== undefined) {
        const result: unknown = await recovery.assertOwned();
        if (result !== undefined) fail();
        assertCurrent();
      }
    } catch (cause) { throw retainRecoveryFailure(cause); }
  };
  const preparationPublish: WorkspaceDeletionPreparationOptions['publish'] = async (
    assertAuthority, assertPublicationCurrent, target, context, assertPreparationCurrent, assertPreparationReadOwned,
    assertRecoverySourceReadCurrent,
  ) => {
    try {
      assertCurrent();
      if (assertRecoverySourceReadCurrent !== undefined && recovery === undefined) fail();
      if (publicationStarted || context.target !== target || target.previousActiveWorkspaceId !== persistedActiveWorkspaceId) fail();
      publicationStarted = true;
      if (recovery !== undefined) await assertRecoveryOwned();
      if (runtime !== undefined && target.workspaceId === runtime.activeWorkspaceId) await runtime.seal();
      assertCurrent();
      assertUpdateJournalAuthority(assertAuthority);
      await assertPublicationCurrent();
      assertCurrent();
      assertUpdateJournalAuthority(assertAuthority);
      const args = [assertAuthority, assertPublicationCurrent, target, context, assertPreparationCurrent] as const;
      const published = await (assertRecoverySourceReadCurrent !== undefined
        ? publish(...args, assertPreparationReadOwned, assertRecoverySourceReadCurrent)
        : assertPreparationReadOwned === undefined ? publish(...args) : publish(...args, assertPreparationReadOwned));
      assertCurrent();
      assertUpdateJournalAuthority(assertAuthority);
      const journal = captureWorkspaceDeletionJournal(published.journal);
      if (journal.phase !== 'authorized' || journal.target.operationId !== context.operationId ||
          journal.target.workspaceId !== target.workspaceId || journal.target.lineageIdentity.profileId !== target.profileId ||
          journal.target.registryEntrySha256 !== target.registryEntrySha256 || journal.registryBeforeSha256 !== target.registrySha256 ||
          journal.previousActiveWorkspaceId !== target.previousActiveWorkspaceId || journal.backupDisposition !== context.backupDisposition ||
          published.workspaceRootIdentity !== target.rootIdentity) fail();
      selected = journal;
    } catch (cause) { throw recovery === undefined ? cause : retainRecoveryFailure(cause); }
  };
  const continuation: NonNullable<WorkspaceManagementServiceOptions['deletionContinuation']> = {
    captureAuthority(operationId, assertLease) {
      try {
        assertCurrent();
        assertUpdateJournalAuthority(assertLease);
        if (captured || selected === undefined || selected.target.operationId !== operationId) fail();
        captured = true;
        const binding = selected ?? fail();
        const assertOwner = () => {
          try {
            assertCurrent();
            assertUpdateJournalAuthority(assertLease);
            assertCurrent();
          } catch (cause) { throw recovery === undefined ? cause : retainRecoveryFailure(cause); }
        };
        return Object.freeze({
          assertCurrent: assertOwner,
          async assertOwned() {
            try {
              assertOwner(); const result: unknown = await assertOwned();
              if (recovery !== undefined && result !== undefined) fail();
              assertOwner();
              if (recovery !== undefined) { await assertRecoveryOwned(); assertOwner(); }
            } catch (cause) { throw recovery === undefined ? cause : retainRecoveryFailure(cause); }
          },
          recordRemoved(value: unknown) {
            if (recording || removed) fail();
            recording = true;
            try {
              deletionDataRecord(value, ['status', 'journal'], 'WORKSPACE_DELETE_JOURNAL_CONFLICT');
              const terminal = captureWorkspaceDeletionJournal(value.journal);
              if (value.status !== 'removed' || terminal.phase !== 'registryPublished' ||
                  !sameWorkspaceDeletionJournalBinding(binding, terminal)) fail();
              // No await or external callback may separate the final guard from storage.
              assertOwner();
              removed = true;
              if (runtime !== undefined && binding.target.workspaceId === runtime.activeWorkspaceId) runtime.recordActiveRemoved();
              return deletionCompletion(binding);
            } catch (cause) { throw recovery === undefined ? cause : retainRecoveryFailure(cause); }
            finally { recording = false; }
          },
        });
      } catch (cause) { throw recovery === undefined ? cause : retainRecoveryFailure(cause); }
    },
    resume,
  };
  return Object.freeze({ publish: preparationPublish, continuation });
}

// Construct the owner before any I/O. The service owns close before the first
// assertOwned initializes native observations under its exact selection receipt.
export function createWorkspaceDeletionColdContinuation(input: {
  userDataRoot: string;
  journal: unknown;
  buildInfo: Readonly<DesktopBuildInfo>;
  releaseInfo: Readonly<DesktopReleaseInfo> | undefined;
  assertCurrent(): void;
  assertOwned(): Promise<void>;
  assertWritersAbsent(): Promise<void>;
}) {
  const root = input.userDataRoot, binding = captureWorkspaceDeletionJournal(input.journal);
  const buildInfo = Object.freeze({ ...input.buildInfo });
  const releaseInfo = input.releaseInfo === undefined ? undefined : Object.freeze({ ...input.releaseInfo });
  const check = input.assertCurrent.bind(input), owned = input.assertOwned.bind(input), writers = input.assertWritersAbsent.bind(input);
  let active = true, metadata = false, handoff = false, removed = false, recording = false;
  let firstFailure: { cause: unknown } | undefined, initialized: Promise<void> | undefined, closing: Promise<void> | undefined;
  const pending = new Set<Promise<void>>(), revocations: (() => void)[] = [], closeFailures: unknown[] = [];
  let external: Awaited<ReturnType<typeof captureWorkspaceDeletionExternalSelectionFromRoot>> | undefined;
  let original: Awaited<ReturnType<typeof captureWorkspaceDeletionOriginalJournalContinuation>> | undefined;
  let revokeOriginal: (() => void) | undefined;
  const retain = (cause: unknown) => { firstFailure ??= { cause }; return firstFailure.cause; };
  const fail = (): never => { throw retain(new WorkspaceManagementError('WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN', 'deleteResume')); };
  const assertNoFailure = () => { if (firstFailure !== undefined) throw firstFailure.cause; };
  const guard = () => {
    assertNoFailure();
    try {
      if (!active) fail(); assertUpdateJournalAuthority(check);
      assertNoFailure();
      if (!active) fail();
    }
    catch (cause) { throw retain(cause); }
  };
  const assertCurrent = () => {
    try { guard(); if (handoff) fail(); } catch (cause) { throw retain(cause); }
  };
  const checked = async (work: () => Promise<void>) => {
    try { guard(); await work(); guard(); } catch (cause) { throw retain(cause); }
  };
  const register = (receipt: { revoke(): void }) => {
    const callback = receipt.revoke.bind(receipt);
    let attempted = false;
    const revoke = () => {
      if (attempted) return;
      attempted = true;
      try { assertUpdateJournalAuthority(callback); }
      catch (cause) { closeFailures.push(cause); throw cause; }
    };
    revocations.push(revoke); return revoke;
  };
  const track = async (work: () => Promise<void>, handoffWork = false) => {
    if (handoffWork) guard(); else assertCurrent();
    const task = Promise.resolve().then(work);
    pending.add(task);
    try { await task; } catch (cause) { throw retain(cause); }
    finally { pending.delete(task); }
  };
  let reservationReady = false;
  const initialize = () => initialized ??= (async () => {
    guard();
    const registry = new WorkspaceRegistryStore({ installationRoot: root, filePath: join(root, WORKSPACE_REGISTRY_FILE_NAME) });
    const phase = await captureWorkspaceDeletionPhaseSelection({ operationId: binding.target.operationId, expectedBinding: binding,
      authority: { assertCurrent: guard, assertOwned: () => checked(owned) }, registry,
      journal: new WorkspaceDeletionJournalStore(root), assertWritersAbsent: () => checked(writers) });
    const revokePhase = register(phase); guard();
    if (phase.journal.phase !== binding.phase) fail();
    external = await captureWorkspaceDeletionExternalSelectionFromRoot({ userDataRoot: root, buildInfo, releaseInfo,
      journal: binding, afterRegistry: phase.afterRegistry, assertCurrent: guard,
      assertOwned: () => checked(owned), assertWritersAbsent: () => checked(writers) });
    register(external); guard(); await phase.assertSelected(); guard();
    original = await captureWorkspaceDeletionOriginalJournalContinuation(root, binding, phase.registryState, {
      assertAuthority: guard, assertExternalSelection: () => checked(owned), assertWritersAbsent: () => checked(writers),
    });
    revokeOriginal = register(original); guard();
    await phase.assertSelected(); guard(); await external.assertSelected(); guard(); revokePhase();
    guard(); reservationReady = true;
  })();
  const assertSelection = async () => {
    // Same build/foreign/original/foreign/build cadence as full cold admission;
    // do not nest two complete external passes around the original proof.
    await checked(owned); await checked(writers);
    await external!.assertBuildSelected(); guard(); await external!.assertForeignAbsent(); guard();
    if (!metadata) { await original!.assertSelected(); guard(); }
    await external!.assertForeignAbsent(); guard(); await external!.assertBuildSelected(); guard();
    await checked(writers); await checked(owned);
  };
  const assertOwned = () => track(async () => {
    if (removed) fail();
    await initialize(); guard(); await assertSelection();
  });
  const assertReservationOwned = () => track(async () => {
    if (!reservationReady || removed) fail();
    await checked(owned); await checked(writers); await checked(owned);
  });
  const beforeMetadata = async () => {
    assertCurrent();
    if (metadata || removed || pending.size !== 0 || initialized === undefined) return fail();
    // Reserve exclusion before a caller guard can reenter and enqueue a read.
    handoff = true;
    try {
      await track(async () => {
        await assertSelection(); revokeOriginal!(); guard(); metadata = true;
      }, true);
    } finally { handoff = false; }
  };
  const owner: WorkspaceDeletionRecoveryOwner = Object.freeze({
    assertCurrent, assertOwned,
    recordRemoved(value: unknown) {
      if (recording) return fail();
      recording = true;
      try {
        assertCurrent(); if (!metadata || removed || pending.size !== 0) fail();
        deletionDataRecord(value, ['status', 'journal'], 'WORKSPACE_DELETE_JOURNAL_CONFLICT');
        const terminal = captureWorkspaceDeletionJournal(value.journal);
        if (value.status !== 'removed' || terminal.phase !== 'registryPublished' || !sameWorkspaceDeletionJournalBinding(binding, terminal)) fail();
        assertCurrent(); removed = true; return deletionCompletion(binding);
      } catch (cause) { throw retain(cause); }
      finally { recording = false; }
    },
    close() {
      if (closing !== undefined) return closing;
      active = false;
      const revokeAvailable = () => {
        for (const revoke of revocations.splice(0)) { try { revoke(); } catch { /* Retained by the registered revoker. */ } }
      };
      closing = Promise.resolve().then(async () => {
        revokeAvailable();
        const results = await Promise.allSettled([...pending]);
        for (const result of results) if (result.status === 'rejected') closeFailures.push(result.reason);
        // A native receipt may have returned just before the close guard fired.
        revokeAvailable();
        if (closeFailures.length !== 0) throw new AggregateError([...closeFailures],
          'WORKSPACE_DELETION_CLOSE_FAILED', { cause: closeFailures[0] });
      });
      return closing;
    },
  });
  return Object.freeze({ owner, beforeMetadata, assertReservationOwned });
}

function deletionCompletion(binding: WorkspaceDeletionJournal): WorkspaceDeletionCompletion {
  return Object.freeze({ formatVersion: 1, status: 'completed',
    navigation: binding.previousActiveWorkspaceId === null || binding.previousActiveWorkspaceId === binding.target.workspaceId
      ? 'selector' : 'reopenPrevious' });
}
