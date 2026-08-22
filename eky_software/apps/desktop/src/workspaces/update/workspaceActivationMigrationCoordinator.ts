import type { ProfileRestoreActivationJournal } from '../../profileBackup/restore/profileRestoreActivationJournal.js';
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

export interface WorkspaceActivationMigrationSourceRecoveryPort {
  recoverFromFailure(): Promise<WorkspaceSwitchFailureRecoveryOutcome>;
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
    let outcome: WorkspaceActivationMigrationResult;

    try {
      await this.options.guard.reprove(input.proof);
      await this.assertActivationIdle(authority);
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
      await this.options.rootStore.prepareCandidate(paths);

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

      await this.options.recoveryPoint.removeStaging(input.proof.operationId);
      await this.options.rootStore.inspectCandidate(paths);
      await this.options.guard.reprove(input.proof);
      await authority.transaction.prepare(operationId);
      await authority.transaction.advanceToValidation();
      outcome = 'relaunchRequired';
    } catch (error) {
      outcome = await this.recoverFailure(
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
    }

    try {
      await lease.release();
    } catch {
      await this.requireRecovery().catch(() => undefined);
      throw new WorkspaceActivationMigrationError(
        'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
      );
    }

    try {
      this.options.requestRelaunch();
      return outcome;
    } catch {
      await this.requireRecovery().catch(() => undefined);
      throw new WorkspaceActivationMigrationError(
        'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
      );
    }
  }

  private async recoverFailure(
    context: Readonly<MigrationFailureContext>,
    runtimeStopAttempted: boolean,
    runtimeStopped: boolean,
    _originalError: unknown,
  ): Promise<WorkspaceActivationMigrationResult> {
    try {
      if (runtimeStopAttempted && !runtimeStopped) {
        throw new Error('runtime-stop-ambiguous');
      }
      if (!runtimeStopped) {
        await context.stopTargetStartupRuntime();
      }
      await this.assertRuntimeAbsent();

      const journal = await context.authority.journalStore.read();
      if (
        journal !== undefined &&
        journal.operationId !== context.operationId
      ) {
        throw new Error('foreign-activation-journal');
      }

      if (journal === undefined) {
        await this.options.rootStore.discardBeforeActivation(context.paths);
      } else {
        await this.rollbackTarget(context.authority, journal);
      }
      await this.options.recoveryPoint
        .removeStaging(context.proof.operationId)
        .catch(() => undefined);
      await this.recoverSource();
      return 'relaunchRequired';
    } catch {
      await this.requireRecovery();
      throw new WorkspaceActivationMigrationError(
        'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
      );
    }
  }

  private async rollbackTarget(
    authority: Readonly<WorkspaceReplacementActivationAuthority>,
    journal: Readonly<ProfileRestoreActivationJournal>,
  ): Promise<void> {
    if (journal.phase === 'accepted' || journal.phase === 'failedSafe') {
      throw new Error('activation-not-rollbackable');
    }
    await authority.transaction.rollback();
  }

  private async recoverSource(): Promise<void> {
    const outcome = await this.options.sourceRecovery.recoverFromFailure();
    if (outcome !== 'relaunchRequired') {
      throw new Error('source-recovery-not-terminal');
    }
  }

  private async requireRecovery(): Promise<void> {
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
