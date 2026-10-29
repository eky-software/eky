import type { ProfileRestoreActivationJournal } from '../../profileBackup/restore/profileRestoreActivationJournal.js';
import { assertProfileRestoreActivationJournalMatches, captureProfileRestoreActivationJournal } from '../../profileBackup/restore/profileRestoreActivationJournal.js';
import { assertSynchronousProfileRestoreMutationAuthority } from '../../profileBackup/restore/profileRestoreMutationAuthority.js';
import { RecoveryPointCleanupError } from '../../profileBackup/recoveryPoint/recoveryPointOperationError.js';
import type { ProfileSnapshotCleanupAuthority } from '../../profileBackup/profileSnapshotInspectionPort.js';
import type { WorkspaceBackupCandidatePort } from '../import/workspaceBackupImportPorts.js';
import {
  validateWorkspaceBackupCandidateReadiness,
  validateWorkspaceBackupMigrationResult,
} from '../import/workspaceBackupImportReadiness.js';
import type { WorkspaceMaintenanceLease, WorkspaceMaintenanceLeaseHandle } from '../maintenance/workspaceMaintenanceLease.js';
import type { WorkspaceRuntimeAbsencePort } from '../runtime/workspaceRuntimeAbsencePort.js';
import type { WorkspaceSwitchFailureRecoveryOutcome } from '../switch/workspaceSwitchStartup.js';
import { validateWorkspaceBackupReplacementOperationId } from '../replacement/workspaceBackupReplacementOperationId.js';
import { deriveWorkspaceBackupReplacementPaths } from '../replacement/workspaceBackupReplacementPaths.js';
import type {
  WorkspaceBackupReplacementRootStore,
  WorkspaceReplacementActivationAuthority,
  WorkspaceReplacementActivationAuthorityFactory,
  WorkspaceReplacementMutationAuthority,
} from '../replacement/workspaceBackupReplacementPorts.js';
import { WorkspaceActivationMigrationError } from './workspaceActivationMigrationError.js';
import type { WorkspaceActivationMigrationGuard } from './workspaceActivationMigrationGuard.js';
import type { WorkspaceActivationMigrationProof } from './workspaceActivationMigrationGuard.js';
import type { WorkspaceActivationMigrationRecoveryPoint } from './workspaceActivationMigrationRecoveryPoint.js';
import type { WorkspaceActivationMigrationBinding } from './workspaceActivationMigrationBinding.js';

const sha256Pattern = /^[0-9a-f]{64}$/;

export type WorkspaceActivationMigrationRecoveryReceipt =
  | Readonly<{ kind: 'noActivation' }>
  | Readonly<{ kind: 'rolledBack'; journal: Readonly<ProfileRestoreActivationJournal> }>;

export interface WorkspaceActivationMigrationSourceRecoveryPort {
  recoverFromFailure(candidate?: WorkspaceActivationMigrationRecoveryReceipt): Promise<WorkspaceSwitchFailureRecoveryOutcome>;
  requireRecovery(): Promise<WorkspaceSwitchFailureRecoveryOutcome>;
}

export interface WorkspaceActivationMigrationCoordinatorOptions {
  readonly activationAuthorityFactory: WorkspaceReplacementActivationAuthorityFactory;
  readonly backupCandidate: WorkspaceBackupCandidatePort;
  readonly createBinding: (input: {
    readonly lease: WorkspaceMaintenanceLeaseHandle;
    readonly proof: Readonly<WorkspaceActivationMigrationProof>;
  }) => Pick<WorkspaceActivationMigrationBinding, 'publishBeforeSnapshot' | 'assertPublished' | 'enterStopped' |
    'assertReadOwnership' | 'assertMutationCurrent' | 'assertSnapshotCleanupCurrent'>;
  readonly blockContinuation: () => void;
  readonly guard: Pick<WorkspaceActivationMigrationGuard, 'reprove'>;
  readonly maintenanceLease: WorkspaceMaintenanceLease;
  readonly recoveryPoint: Pick<
    WorkspaceActivationMigrationRecoveryPoint,
    'createAndStage' | 'removeStaging'
  >;
  readonly requestRelaunch: () => void;
  readonly rootStore: WorkspaceBackupReplacementRootStore;
  readonly sourceRecovery: WorkspaceActivationMigrationSourceRecoveryPort;
  readonly userDataRoot: string;
  readonly workspaceRuntimeAbsence: WorkspaceRuntimeAbsencePort;
}

export interface WorkspaceActivationMigrationInput {
  readonly expectedSourceMigrationChainIdentity: string;
  readonly proof: Readonly<WorkspaceActivationMigrationProof>;
  readonly stopTargetStartupRuntime: () => Promise<void>;
}

export type WorkspaceActivationMigrationResult = 'relaunchRequired';

interface MigrationFailureContext {
  readonly authority: Readonly<WorkspaceReplacementActivationAuthority>;
  readonly operationId: ReturnType<
    typeof validateWorkspaceBackupReplacementOperationId
  >;
  readonly paths: ReturnType<typeof deriveWorkspaceBackupReplacementPaths>;
  readonly proof: Readonly<WorkspaceActivationMigrationProof>;
  readonly stopTargetStartupRuntime: () => Promise<void>;
  readonly binding: Readonly<WorkspaceReplacementMutationAuthority>;
  readonly cleanupAuthority: Readonly<ProfileSnapshotCleanupAuthority>;
  readonly enterStopped: () => Promise<void>;
  readonly recoverSource: () => Promise<void>;
}

export class WorkspaceActivationMigrationCoordinator {
  constructor(
    private readonly options: Readonly<WorkspaceActivationMigrationCoordinatorOptions>,
  ) {}

  async migrateAndActivate(
    input: Readonly<WorkspaceActivationMigrationInput>,
  ): Promise<WorkspaceActivationMigrationResult> {
    if (!sha256Pattern.test(input.expectedSourceMigrationChainIdentity)) {
      throw new WorkspaceActivationMigrationError(
        'WORKSPACE_ACTIVATION_MIGRATION_FAILED',
      );
    }

    const operationId = validateWorkspaceBackupReplacementOperationId(
      input.proof.operationId,
    );
    const paths = deriveWorkspaceBackupReplacementPaths(
      this.options.userDataRoot,
      operationId,
      input.proof.targetWorkspaceId,
    );
    const proof = input.proof;
    const stopTargetStartupRuntime = input.stopTargetStartupRuntime.bind(input);
    const createBinding = this.options.createBinding.bind(this.options);
    const blockContinuation = this.options.blockContinuation.bind(this.options);
    const authority = this.options.activationAuthorityFactory.create(paths);
    const lease = await this.acquireLease();
    let runtimeStopAttempted = false;
    let runtimeStopped = false;
    let selectorReturnPending = false;
    let selectorRecoveryReceipt: WorkspaceActivationMigrationRecoveryReceipt | undefined;
    let activationFailure: { error: unknown } | undefined;
    let terminalFailure: { error: unknown } | undefined;
    let uncertainty: { error: unknown } | undefined;
    let publicationAttempted = false;
    let publicationCompleted = false;
    let stopped = false;
    let closed = false;
    let selectionHandedOff = false;
    let retainLease = false;
    let outcome: WorkspaceActivationMigrationResult;
    const rejectContinuation = (error: unknown): unknown => {
      if (hasUnverifiedCleanup(error)) retainLease = true;
      if (uncertainty === undefined) {
        uncertainty = { error };
        try { assertSynchronousProfileRestoreMutationAuthority(blockContinuation); }
        catch (secondary) { uncertainty = { error: new AggregateError([error, secondary],
          'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED') }; }
      }
      return uncertainty.error;
    };
    const assertOpen = () => {
      if (uncertainty !== undefined) throw uncertainty.error;
      if (closed || selectionHandedOff) throw new Error('WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED');
    };

    try {
      // Pin every binding callback before the first read under this exact lease.
      const binding = createBinding({ lease, proof });
      const publish = binding.publishBeforeSnapshot.bind(binding);
      const readback = binding.assertPublished.bind(binding);
      const transition = binding.enterStopped.bind(binding);
      const mutation = binding.assertMutationCurrent.bind(binding);
      const snapshotCleanup = binding.assertSnapshotCleanupCurrent.bind(binding);
      const readOwnership = binding.assertReadOwnership.bind(binding);
      const assertCurrent = async () => {
        try {
          assertOpen();
          await readback();
          if (proof.sourceWorkspaceId === null) await this.options.guard.reprove(proof);
          assertOpen();
        } catch (error) { throw rejectContinuation(error); }
      };
      const assertMutationCurrent = () => {
        try { assertOpen(); assertSynchronousProfileRestoreMutationAuthority(mutation); }
        catch (error) { throw rejectContinuation(error); }
      };
      const assertReadOwnership = async () => {
        try { assertOpen(); await readOwnership(); assertOpen(); }
        catch (error) { throw rejectContinuation(error); }
      };
      const journalWriteContext = Object.freeze({ assertReadOwnership, assertMutationCurrent });
      const cleanupAuthority = Object.freeze({ assertOwned: assertCurrent, assertCurrent: () => {
        try { assertOpen(); assertSynchronousProfileRestoreMutationAuthority(snapshotCleanup); }
        catch (error) { throw rejectContinuation(error); }
      } });
      const bindingAuthority = Object.freeze({ assertCurrent, assertMutationCurrent });
      const enterStopped = async () => {
        if (stopped) return;
        try { assertOpen(); await transition(); stopped = true; }
        catch (error) { throw rejectContinuation(error); }
      };
      const recoverSource = async () => {
        await assertCurrent();
        assertMutationCurrent();
        selectionHandedOff = true;
        try { await this.recoverSource(); }
        catch (error) { throw rejectContinuation(error); }
      };
      try {
        if (proof.sourceWorkspaceId === null) await this.options.guard.reprove(proof);
        await this.assertActivationIdle(authority);
        if (proof.sourceWorkspaceId === null) await this.options.guard.reprove(proof);
        publicationAttempted = true;
        await publish();
        await assertCurrent();
        publicationCompleted = true;
        const staged = await this.options.recoveryPoint.createAndStage({
          expectedMigrationChainIdentity:
            input.expectedSourceMigrationChainIdentity,
          expectedProfileId: input.proof.profileId,
          operationId: input.proof.operationId,
          cleanupAuthority,
        });
        await assertCurrent();

        runtimeStopAttempted = true;
        await stopTargetStartupRuntime();
        runtimeStopped = true;
        await this.assertRuntimeAbsent();
        await enterStopped();
        await assertCurrent();
        await this.options.rootStore.prepareCandidate(paths, bindingAuthority);
        await assertCurrent();

        const migration = await this.options.backupCandidate.migrate({
          artifactRoot: paths.candidateArtifactRoot,
          candidateRoot: paths.activationStagingOperationRoot,
          databaseFilePath: paths.candidateDatabasePath,
          expectedProfileId: input.proof.profileId,
          expectedSourceMigrationChainIdentity:
            input.expectedSourceMigrationChainIdentity,
          importStagingRoot: staged.operationRoot,
          operationId: input.proof.operationId,
          workspaceId: input.proof.targetWorkspaceId,
        });
        validateWorkspaceBackupMigrationResult(migration);
        if (migration.profileId !== input.proof.profileId) {
          throw new Error('migration-profile-mismatch');
        }
        await assertCurrent();

        const readiness = validateWorkspaceBackupCandidateReadiness(
          await this.options.backupCandidate.validateAndMaterialize({
            artifactRoot: paths.candidateArtifactRoot,
            candidateRoot: paths.activationStagingOperationRoot,
            databaseFilePath: paths.candidateDatabasePath,
            expectedProfileId: input.proof.profileId,
            importStagingRoot: staged.operationRoot,
            operationId: input.proof.operationId,
            workspaceId: input.proof.targetWorkspaceId,
          }),
        );
        if (
          readiness.lineageIdentity.profileId !== input.proof.profileId ||
          readiness.migrationChainIdentity !==
            migration.migrationChainIdentity
        ) {
          throw new Error('candidate-readiness-mismatch');
        }

        await assertCurrent();
        await this.options.recoveryPoint.removeStaging(input.proof.operationId, cleanupAuthority);
        await assertCurrent();
        await this.options.rootStore.inspectCandidate(paths);
        await assertCurrent();
        let prepared: Readonly<ProfileRestoreActivationJournal> | undefined;
        await authority.transaction.prepare(operationId, assertCurrent, journal => {
          if (prepared !== undefined || journal.operationId !== operationId || journal.phase !== 'prepared' || journal.revision !== 0) {
            throw rejectContinuation(new Error('PROFILE_RESTORE_RECOVERY_REQUIRED'));
          }
          prepared = captureProfileRestoreActivationJournal(journal);
        }, assertMutationCurrent);
        if (prepared === undefined) throw rejectContinuation(new Error('PROFILE_RESTORE_JOURNAL_REQUIRED'));
        await assertCurrent();
        await authority.transaction.advanceToValidation(prepared, assertCurrent, undefined, journalWriteContext, assertMutationCurrent);
        await assertCurrent();
        assertMutationCurrent();
        outcome = 'relaunchRequired';
      } catch (error) {
        activationFailure = { error };
        if (!publicationAttempted || !publicationCompleted || uncertainty !== undefined || hasUnverifiedCleanup(error)) {
          const alreadyUncertain = uncertainty !== undefined;
          const blocked = rejectContinuation(error);
          // An adapter may return the original failure after its cleanup guard
          // has already sealed continuation. Keep both instead of replacing it.
          throw recoveryRequired(alreadyUncertain && blocked !== error ? new AggregateError(
            [error, blocked], 'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED') : blocked);
        }
        try {
          selectorRecoveryReceipt = await this.recoverFailure(
            {
              authority,
              operationId,
              paths,
              proof: input.proof,
              stopTargetStartupRuntime,
              binding: bindingAuthority,
              cleanupAuthority,
              enterStopped,
              recoverSource,
            },
            runtimeStopAttempted,
            runtimeStopped,
          );
        } catch (recoveryError) {
          const failures = [error, recoveryError];
          if (uncertainty === undefined && !hasUnverifiedCleanup(recoveryError) && !selectionHandedOff) {
            try {
              await assertCurrent();
              assertMutationCurrent();
              selectionHandedOff = true;
              await this.requireRecovery(proof);
            } catch (markingError) { failures.push(markingError); }
          }
          const combined = new AggregateError(failures, 'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED');
          if (hasUnverifiedCleanup(recoveryError)) retainLease = true;
          const alreadyUncertain = uncertainty !== undefined;
          const blocked = rejectContinuation(combined);
          throw recoveryRequired(alreadyUncertain ? combined : blocked);
        }
        selectorReturnPending = input.proof.sourceWorkspaceId === null;
        outcome = 'relaunchRequired';
      }
    } catch (error) {
      const alreadyUncertain = uncertainty !== undefined;
      const blocked = rejectContinuation(error);
      terminalFailure = { error: alreadyUncertain ? error : blocked };
      throw recoveryRequired(terminalFailure.error);
    } finally {
      closed = true;
      if (!retainLease) {
        try { await lease.release(); }
        catch (error) {
          const first = terminalFailure ?? activationFailure;
          const failure = first === undefined ? error : new AggregateError(
            [first.error, error], 'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED');
          const alreadyUncertain = uncertainty !== undefined;
          const blocked = rejectContinuation(failure);
          throw recoveryRequired(alreadyUncertain ? failure : blocked);
        }
      }
    }

    if (uncertainty !== undefined) throw recoveryRequired(uncertainty.error);
    try {
      if (selectorReturnPending) {
        // Candidate rollback holds switch ownership; cold terminal validation
        // must acquire its own restore owner after that work has settled.
        await this.options.guard.reprove(input.proof);
        await this.assertRuntimeAbsent();
        await this.options.guard.reprove(input.proof);
        if (selectorRecoveryReceipt === undefined) throw new Error('selector-recovery-receipt-missing');
        await this.recoverSource(selectorRecoveryReceipt);
      }
      this.options.requestRelaunch();
      return outcome;
    } catch (error) {
      const failures = activationFailure === undefined ? [error] : [activationFailure.error, error];
      if (proof.sourceWorkspaceId === null && !hasUnverifiedCleanup(error)) {
        try { await this.requireRecovery(input.proof); }
        catch (markingError) { failures.push(markingError); }
      }
      const failure = failures.length === 1 ? failures[0] : new AggregateError(failures,
        'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED');
      const blocked = rejectContinuation(failure);
      throw new WorkspaceActivationMigrationError(
        'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
        { cause: blocked },
      );
    }
  }

  private async recoverFailure(
    context: Readonly<MigrationFailureContext>,
    runtimeStopAttempted: boolean,
    runtimeStopped: boolean,
  ): Promise<WorkspaceActivationMigrationRecoveryReceipt | undefined> {
    await context.binding.assertCurrent();
    if (runtimeStopAttempted && !runtimeStopped) {
      throw new Error('runtime-stop-ambiguous');
    }
    if (!runtimeStopped) {
      await context.stopTargetStartupRuntime();
    }
    await this.assertRuntimeAbsent();
    await context.enterStopped();

    // Runtime shutdown is still allowed, but a stale selector cannot grant
    // repairing reads, rollback, removal or another persistent selection.
    await context.binding.assertCurrent();
    const observed = await context.authority.journalStore.peek();
    await context.binding.assertCurrent();
    const journal = observed === undefined ? undefined : captureProfileRestoreActivationJournal(observed);
    if (
      journal !== undefined &&
      journal.operationId !== context.operationId
    ) {
      throw new Error('foreign-activation-journal');
    }

    let candidate: WorkspaceActivationMigrationRecoveryReceipt = Object.freeze({ kind: 'noActivation' });
    await context.binding.assertCurrent();
    if (journal === undefined) {
      const absentJournalAuthority = Object.freeze({
        assertMutationCurrent: context.binding.assertMutationCurrent,
        assertCurrent: async () => {
          await context.binding.assertCurrent();
          if ((await context.authority.journalStore.peek()) !== undefined) throw new Error('PROFILE_RESTORE_ACTIVATION_BUSY');
          await context.binding.assertCurrent();
        },
      });
      await this.options.rootStore.discardBeforeActivation(context.paths, absentJournalAuthority);
    } else {
      const repaired = await context.authority.journalStore.read(journal, context.binding.assertCurrent,
        context.binding.assertMutationCurrent);
      assertProfileRestoreActivationJournalMatches(journal, repaired);
      await context.binding.assertCurrent();
      const rolledBack = await this.rollbackTarget(context.authority, journal, context.proof.sourceWorkspaceId === null,
        context.binding);
      if (rolledBack !== undefined) candidate = Object.freeze({ kind: 'rolledBack', journal: rolledBack });
    }
    await context.binding.assertCurrent();
    await this.options.recoveryPoint.removeStaging(context.proof.operationId, context.cleanupAuthority);
    await context.binding.assertCurrent();
    if (context.proof.sourceWorkspaceId !== null) await context.recoverSource();
    return context.proof.sourceWorkspaceId === null ? candidate : undefined;
  }

  private async rollbackTarget(
    authority: Readonly<WorkspaceReplacementActivationAuthority>,
    journal: Readonly<ProfileRestoreActivationJournal>,
    selector: boolean,
    binding: Readonly<WorkspaceReplacementMutationAuthority>,
  ): Promise<Readonly<ProfileRestoreActivationJournal> | undefined> {
    if (journal.phase === 'accepted' || journal.phase === 'failedSafe') {
      throw new Error('activation-not-rollbackable');
    }
    if (!selector) {
      await authority.transaction.rollback(journal, binding.assertCurrent, undefined, binding.assertMutationCurrent);
      return undefined;
    }
    const selected = captureProfileRestoreActivationJournal(journal);
    if (!selected.hadActiveDatabase) throw new Error('activation-original-database-missing');
    const rolledBack = captureProfileRestoreActivationJournal(await authority.transaction.rollback(selected,
      binding.assertCurrent, undefined, binding.assertMutationCurrent));
    assertProfileRestoreActivationJournalMatches({ ...selected, phase: 'rolledBack',
      revision: selected.revision + (selected.phase === 'rolledBack' ? 0 : selected.phase === 'rollbackStarting' ? 1 : 2),
    }, rolledBack);
    return rolledBack;
  }

  private async recoverSource(candidate?: WorkspaceActivationMigrationRecoveryReceipt): Promise<void> {
    const outcome = await (candidate === undefined
      ? this.options.sourceRecovery.recoverFromFailure()
      : this.options.sourceRecovery.recoverFromFailure(candidate));
    if (outcome !== 'relaunchRequired') {
      throw new Error('source-recovery-not-terminal');
    }
  }

  private async requireRecovery(proof: Readonly<WorkspaceActivationMigrationProof>): Promise<void> {
    if (proof.sourceWorkspaceId === null) await this.options.guard.reprove(proof);
    const outcome = await this.options.sourceRecovery.requireRecovery();
    if (outcome === 'notRecovered') {
      throw new WorkspaceActivationMigrationError(
        'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
      );
    }
  }

  private async assertActivationIdle(
    authority: Readonly<WorkspaceReplacementActivationAuthority>,
  ): Promise<void> {
    if ((await authority.journalStore.peek()) !== undefined) {
      throw new WorkspaceActivationMigrationError(
        'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
      );
    }
  }

  private async assertRuntimeAbsent(): Promise<void> {
    await this.options.workspaceRuntimeAbsence.assertNoActiveWorkspaceRuntime();
  }

  private async acquireLease() {
    try {
      return await this.options.maintenanceLease.acquire('switch');
    } catch {
      throw new WorkspaceActivationMigrationError(
        'WORKSPACE_ACTIVATION_MIGRATION_FAILED',
      );
    }
  }
}

function recoveryRequired(cause: unknown): WorkspaceActivationMigrationError {
  if (cause instanceof WorkspaceActivationMigrationError && cause.code === 'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED') {
    return cause;
  }
  return new WorkspaceActivationMigrationError('WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED', { cause });
}

function hasUnverifiedCleanup(error: unknown): boolean {
  const pending: unknown[] = [error];
  const seen = new Set<object>();
  for (let visited = 0; pending.length > 0 && visited < 16; visited++) {
    const current = pending.pop();
    if (current === null || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    try {
      if (current instanceof RecoveryPointCleanupError ||
          ('cleanupStatus' in current && current.cleanupStatus === 'unverified') ||
          (current instanceof Error && current.message === 'PROFILE_INSPECTION_CLEANUP_UNVERIFIED')) return true;
      if ('cause' in current) pending.push(current.cause);
      if (current instanceof AggregateError) {
        if (current.errors.length > 16) return true;
        pending.push(...current.errors);
      }
    } catch { return true; }
  }
  return pending.length > 0;
}
