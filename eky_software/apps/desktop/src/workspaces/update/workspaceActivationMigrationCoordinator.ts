import type { ProfileRestoreActivationJournal } from '../../profileBackup/restore/profileRestoreActivationJournal.js';
import { assertProfileRestoreActivationJournalMatches, captureProfileRestoreActivationJournal } from '../../profileBackup/restore/profileRestoreActivationJournal.js';
import type { WorkspaceBackupCandidatePort } from '../import/workspaceBackupImportPorts.js';
import {
  validateWorkspaceBackupCandidateReadiness,
  validateWorkspaceBackupMigrationResult,
} from '../import/workspaceBackupImportReadiness.js';
import type { WorkspaceMaintenanceLease } from '../maintenance/workspaceMaintenanceLease.js';
import type { WorkspaceRuntimeAbsencePort } from '../runtime/workspaceRuntimeAbsencePort.js';
import type { WorkspaceSwitchFailureRecoveryOutcome } from '../switch/workspaceSwitchStartup.js';
import { validateWorkspaceBackupReplacementOperationId } from '../replacement/workspaceBackupReplacementOperationId.js';
import { deriveWorkspaceBackupReplacementPaths } from '../replacement/workspaceBackupReplacementPaths.js';
import type {
  WorkspaceBackupReplacementRootStore,
  WorkspaceReplacementActivationAuthority,
  WorkspaceReplacementActivationAuthorityFactory,
} from '../replacement/workspaceBackupReplacementPorts.js';
import { WorkspaceActivationMigrationError } from './workspaceActivationMigrationError.js';
import type { WorkspaceActivationMigrationGuard } from './workspaceActivationMigrationGuard.js';
import type { WorkspaceActivationMigrationProof } from './workspaceActivationMigrationGuard.js';
import type { WorkspaceActivationMigrationRecoveryPoint } from './workspaceActivationMigrationRecoveryPoint.js';

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
    const authority = this.options.activationAuthorityFactory.create(paths);
    const lease = await this.acquireLease();
    let runtimeStopAttempted = false;
    let runtimeStopped = false;
    let selectorReturnPending = false;
    let selectorRecoveryReceipt: WorkspaceActivationMigrationRecoveryReceipt | undefined;
    let activationFailure: unknown;
    let outcome: WorkspaceActivationMigrationResult;

    try {
      await this.options.guard.reprove(input.proof);
      await this.assertActivationIdle(authority);
      if (input.proof.sourceWorkspaceId === null) await this.options.guard.reprove(input.proof);
      const staged = await this.options.recoveryPoint.createAndStage({
        expectedMigrationChainIdentity:
          input.expectedSourceMigrationChainIdentity,
        expectedProfileId: input.proof.profileId,
        operationId: input.proof.operationId,
      });

      runtimeStopAttempted = true;
      await input.stopTargetStartupRuntime();
      runtimeStopped = true;
      await this.assertRuntimeAbsent();
      if (input.proof.sourceWorkspaceId === null) await this.options.guard.reprove(input.proof);
      await this.options.rootStore.prepareCandidate(paths);
      if (input.proof.sourceWorkspaceId === null) await this.options.guard.reprove(input.proof);

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
      if (input.proof.sourceWorkspaceId === null) await this.options.guard.reprove(input.proof);

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

      if (input.proof.sourceWorkspaceId === null) await this.options.guard.reprove(input.proof);
      await this.options.recoveryPoint.removeStaging(input.proof.operationId);
      if (input.proof.sourceWorkspaceId === null) await this.options.guard.reprove(input.proof);
      await this.options.rootStore.inspectCandidate(paths);
      await this.options.guard.reprove(input.proof);
      await authority.transaction.prepare(operationId);
      if (input.proof.sourceWorkspaceId === null) await this.options.guard.reprove(input.proof);
      await authority.transaction.advanceToValidation();
      if (input.proof.sourceWorkspaceId === null) await this.options.guard.reprove(input.proof);
      outcome = 'relaunchRequired';
    } catch (error) {
      activationFailure = error;
      selectorRecoveryReceipt = await this.recoverFailure(
        {
          authority,
          operationId,
          paths,
          proof: input.proof,
          stopTargetStartupRuntime: input.stopTargetStartupRuntime,
        },
        runtimeStopAttempted,
        runtimeStopped,
        error,
      );
      selectorReturnPending = input.proof.sourceWorkspaceId === null;
      outcome = 'relaunchRequired';
    }

    try {
      await lease.release();
    } catch (error) {
      await this.requireRecovery(input.proof).catch(() => undefined);
      throw new WorkspaceActivationMigrationError(
        'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
        { cause: activationFailure === undefined ? error : new AggregateError(
          [activationFailure, error], 'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
        ) },
      );
    }

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
      await this.requireRecovery(input.proof).catch(() => undefined);
      throw new WorkspaceActivationMigrationError(
        'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
        { cause: activationFailure === undefined ? error : new AggregateError(
          [activationFailure, error], 'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
        ) },
      );
    }
  }

  private async recoverFailure(
    context: Readonly<MigrationFailureContext>,
    runtimeStopAttempted: boolean,
    runtimeStopped: boolean,
    originalError: unknown,
  ): Promise<WorkspaceActivationMigrationRecoveryReceipt | undefined> {
    try {
      if (runtimeStopAttempted && !runtimeStopped) {
        throw new Error('runtime-stop-ambiguous');
      }
      if (!runtimeStopped) {
        await context.stopTargetStartupRuntime();
      }
      await this.assertRuntimeAbsent();

      // Runtime shutdown is still allowed, but a stale selector cannot grant
      // repairing reads, rollback, removal or another persistent selection.
      if (context.proof.sourceWorkspaceId === null) await this.options.guard.reprove(context.proof);
      const observed = await context.authority.journalStore.read();
      const journal = context.proof.sourceWorkspaceId === null && observed !== undefined
        ? captureProfileRestoreActivationJournal(observed) : observed;
      if (
        journal !== undefined &&
        journal.operationId !== context.operationId
      ) {
        throw new Error('foreign-activation-journal');
      }

      let candidate: WorkspaceActivationMigrationRecoveryReceipt = Object.freeze({ kind: 'noActivation' });
      if (context.proof.sourceWorkspaceId === null) await this.options.guard.reprove(context.proof);
      if (journal === undefined) {
        await this.options.rootStore.discardBeforeActivation(context.paths);
      } else {
        const rolledBack = await this.rollbackTarget(context.authority, journal, context.proof.sourceWorkspaceId === null);
        if (rolledBack !== undefined) candidate = Object.freeze({ kind: 'rolledBack', journal: rolledBack });
      }
      if (context.proof.sourceWorkspaceId === null) await this.options.guard.reprove(context.proof);
      await this.options.recoveryPoint
        .removeStaging(context.proof.operationId)
        .catch(() => undefined);
      if (context.proof.sourceWorkspaceId === null) await this.options.guard.reprove(context.proof);
      if (context.proof.sourceWorkspaceId !== null) await this.recoverSource();
      return context.proof.sourceWorkspaceId === null ? candidate : undefined;
    } catch (error) {
      const failures = [originalError, error];
      try {
        await this.requireRecovery(context.proof);
      } catch (markingError) {
        failures.push(markingError);
      }
      throw new WorkspaceActivationMigrationError(
        'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
        { cause: new AggregateError(failures, 'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED') },
      );
    }
  }

  private async rollbackTarget(
    authority: Readonly<WorkspaceReplacementActivationAuthority>,
    journal: Readonly<ProfileRestoreActivationJournal>,
    selector: boolean,
  ): Promise<Readonly<ProfileRestoreActivationJournal> | undefined> {
    if (journal.phase === 'accepted' || journal.phase === 'failedSafe') {
      throw new Error('activation-not-rollbackable');
    }
    if (!selector) {
      await authority.transaction.rollback();
      return undefined;
    }
    const selected = captureProfileRestoreActivationJournal(journal);
    if (!selected.hadActiveDatabase) throw new Error('activation-original-database-missing');
    const rolledBack = captureProfileRestoreActivationJournal(await authority.transaction.rollback(selected));
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
    const outcome = await this.options.sourceRecovery
      .requireRecovery()
      .catch(() => 'recoveryRequired' as const);
    if (outcome === 'notRecovered') {
      throw new WorkspaceActivationMigrationError(
        'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
      );
    }
  }

  private async assertActivationIdle(
    authority: Readonly<WorkspaceReplacementActivationAuthority>,
  ): Promise<void> {
    if ((await authority.journalStore.read()) !== undefined) {
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
