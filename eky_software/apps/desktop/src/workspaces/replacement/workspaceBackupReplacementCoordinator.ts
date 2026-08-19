import type { ProfileRestoreActivationJournal } from '../../profileBackup/restore/profileRestoreActivationJournal.js';
import type { WorkspaceRegistryPort } from '../registry/workspaceRegistryPort.js';
import type { WorkspaceId } from '../registry/workspaceRegistryTypes.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import type { ActiveWorkspaceLifecyclePort } from '../runtime/activeWorkspaceLifecyclePort.js';
import type { WorkspaceRuntimeAbsencePort } from '../runtime/workspaceRuntimeAbsencePort.js';
import type { WorkspaceMaintenanceLease } from '../maintenance/workspaceMaintenanceLease.js';
import type {
  WorkspaceBackupCandidatePort,
  WorkspaceBackupContainerPort,
  WorkspaceBackupPreflightResult,
  WorkspaceBackupSourceInput,
} from '../import/workspaceBackupImportPorts.js';
import { validateWorkspaceBackupImportOperationId } from '../import/workspaceBackupImportOperationId.js';
import {
  validateWorkspaceBackupCandidateReadiness,
  validateWorkspaceBackupMigrationResult,
} from '../import/workspaceBackupImportReadiness.js';
import {
  WorkspaceBackupReplacementError,
  mapWorkspaceBackupReplacementError,
} from './workspaceBackupReplacementError.js';
import {
  generateWorkspaceBackupReplacementOperationId,
  type WorkspaceBackupReplacementOperationId,
} from './workspaceBackupReplacementOperationId.js';
import { deriveWorkspaceBackupReplacementPaths } from './workspaceBackupReplacementPaths.js';
import type {
  WorkspaceBackupReplacementRootStore,
  WorkspacePreRestoreRecoveryPointPort,
  WorkspaceReplacementActivationAuthority,
  WorkspaceReplacementActivationAuthorityFactory,
  WorkspaceReplacementOperationGuardPort,
  WorkspaceReplacementRuntimeHandoffPort,
  WorkspaceReplacementRuntimeReadiness,
  WorkspaceReplacementRuntimeReadinessPort,
} from './workspaceBackupReplacementPorts.js';
import {
  assertWorkspaceReplacementLineage,
  assertWorkspaceReplacementRegistryUnchanged,
  validateWorkspaceReplacementTarget,
  type WorkspaceReplacementTarget,
} from './workspaceBackupReplacementRegistry.js';

const sha256Pattern = /^[0-9a-f]{64}$/;
const boundedVersionPattern = /^[0-9A-Za-z.+-]{1,100}$/;

export interface WorkspaceBackupReplacementCoordinatorOptions {
  readonly activationAuthorityFactory: WorkspaceReplacementActivationAuthorityFactory;
  readonly activeWorkspaceLifecycle: ActiveWorkspaceLifecyclePort;
  readonly backupCandidate: WorkspaceBackupCandidatePort;
  readonly backupContainer: WorkspaceBackupContainerPort;
  readonly generateOperationId?: () => WorkspaceBackupReplacementOperationId;
  readonly maintenanceLease: WorkspaceMaintenanceLease;
  readonly operationGuard: WorkspaceReplacementOperationGuardPort;
  readonly preRestoreRecoveryPoint: WorkspacePreRestoreRecoveryPointPort;
  readonly registry: Pick<WorkspaceRegistryPort, 'read'>;
  readonly rootStore: WorkspaceBackupReplacementRootStore;
  readonly runtimeHandoff?: WorkspaceReplacementRuntimeHandoffPort;
  readonly runtimeReadiness: WorkspaceReplacementRuntimeReadinessPort;
  readonly userDataRoot: string;
  readonly workspaceRuntimeAbsence: WorkspaceRuntimeAbsencePort;
}

export interface WorkspaceBackupReplacementInput
  extends WorkspaceBackupSourceInput {
  readonly targetWorkspaceId: unknown;
}

export interface WorkspaceBackupReplacementResult {
  readonly migrationChainIdentity: string;
  readonly profileId: string;
  readonly workspaceId: WorkspaceId;
}

interface ReplacementFailureContext {
  readonly authority: Readonly<WorkspaceReplacementActivationAuthority>;
  readonly operationId: WorkspaceBackupReplacementOperationId;
  readonly paths: ReturnType<typeof deriveWorkspaceBackupReplacementPaths>;
  readonly target: Readonly<WorkspaceReplacementTarget>;
  readonly writesQuiesced: boolean;
}

export class WorkspaceBackupReplacementCoordinator {
  private readonly generateOperationId: () => WorkspaceBackupReplacementOperationId;

  constructor(
    private readonly options: Readonly<WorkspaceBackupReplacementCoordinatorOptions>,
  ) {
    this.generateOperationId =
      options.generateOperationId ??
      generateWorkspaceBackupReplacementOperationId;
  }

  async replace(
    input: Readonly<WorkspaceBackupReplacementInput>,
  ): Promise<Readonly<WorkspaceBackupReplacementResult>> {
    const targetWorkspaceId = validateTargetWorkspaceId(
      input.targetWorkspaceId,
    );
    await this.assertNoUnresolvedOperations();
    const initialTarget = validateWorkspaceReplacementTarget(
      await this.readRegistry('registryRead'),
      targetWorkspaceId,
    );
    const operationId = this.createOperationId();
    const paths = deriveWorkspaceBackupReplacementPaths(
      this.options.userDataRoot,
      operationId,
      targetWorkspaceId,
    );
    const authority = this.options.activationAuthorityFactory.create(paths);
    await this.assertActivationIdle(authority);

    const preflight = await this.inspectBackup(input);
    assertWorkspaceReplacementLineage(initialTarget.entry, preflight.profileId);

    const lease = await this.acquireLease();
    let writesQuiesced = false;
    try {
      await this.assertNoUnresolvedOperations();
      await this.assertActivationIdle(authority);
      const leaseRegistry = await this.readRegistry('registryRevalidation');
      assertWorkspaceReplacementRegistryUnchanged(
        initialTarget.registrySnapshot,
        leaseRegistry,
      );
      const target = validateWorkspaceReplacementTarget(
        leaseRegistry,
        targetWorkspaceId,
      );
      assertWorkspaceReplacementLineage(target.entry, preflight.profileId);

      await this.quiesceRuntime(targetWorkspaceId);
      writesQuiesced = true;
      await this.stopRuntime(targetWorkspaceId);
      await this.assertRuntimeAbsent();
      await this.createPreRestore(operationId, targetWorkspaceId);
      await this.prepareCandidate(paths);

      const staged = await this.stageBackup({
        containerPath: input.containerPath,
        password: input.password,
        expectedContainerSha256: preflight.containerSha256,
        expectedMigrationChainIdentity: preflight.migrationChainIdentity,
        expectedProfileId: preflight.profileId,
        importStagingRoot: paths.importStagingRoot,
      });
      assertSamePreflight(preflight, staged);

      const importOperationId =
        validateWorkspaceBackupImportOperationId(operationId);
      const migration = await this.migrateCandidate({
        operationId: importOperationId,
        workspaceId: targetWorkspaceId,
        candidateRoot: paths.activationStagingOperationRoot,
        importStagingRoot: paths.importStagingRoot,
        databaseFilePath: paths.candidateDatabasePath,
        artifactRoot: paths.candidateArtifactRoot,
        expectedProfileId: preflight.profileId,
        expectedSourceMigrationChainIdentity:
          preflight.migrationChainIdentity,
      });
      validateWorkspaceBackupMigrationResult(migration);
      if (migration.profileId !== preflight.profileId) {
        throw new WorkspaceBackupReplacementError(
          'WORKSPACE_REPLACEMENT_VALIDATION_FAILED',
          'candidateMigration',
        );
      }

      const readiness = await this.validateCandidate({
        operationId: importOperationId,
        workspaceId: targetWorkspaceId,
        candidateRoot: paths.activationStagingOperationRoot,
        importStagingRoot: paths.importStagingRoot,
        databaseFilePath: paths.candidateDatabasePath,
        artifactRoot: paths.candidateArtifactRoot,
        expectedProfileId: preflight.profileId,
      });
      if (
        readiness.lineageIdentity.profileId !== preflight.profileId ||
        readiness.migrationChainIdentity !== migration.migrationChainIdentity
      ) {
        throw new WorkspaceBackupReplacementError(
          'WORKSPACE_REPLACEMENT_VALIDATION_FAILED',
          'candidateValidation',
        );
      }
      await this.removeImportStaging(paths);
      await this.inspectCandidate(paths);

      const activationRegistry = await this.readRegistry(
        'registryRevalidation',
      );
      assertWorkspaceReplacementRegistryUnchanged(
        initialTarget.registrySnapshot,
        activationRegistry,
      );
      validateWorkspaceReplacementTarget(
        activationRegistry,
        targetWorkspaceId,
      );

      await this.prepareActivation(authority, operationId);
      await this.replaceActiveRoot(authority);
      if (this.options.runtimeHandoff !== undefined) {
        this.options.runtimeHandoff.requestRelaunch();
        return Object.freeze({
          migrationChainIdentity: migration.migrationChainIdentity,
          profileId: preflight.profileId,
          workspaceId: targetWorkspaceId,
        });
      }
      await this.ensureRuntimeRunning(targetWorkspaceId);
      await this.validateRunningRuntime({
        workspaceId: targetWorkspaceId,
        expectedProfileId: preflight.profileId,
        expectedMigrationChainIdentity: migration.migrationChainIdentity,
      });

      const commitRegistry = await this.readRegistry('registryRevalidation');
      assertWorkspaceReplacementRegistryUnchanged(
        initialTarget.registrySnapshot,
        commitRegistry,
      );
      validateWorkspaceReplacementTarget(
        commitRegistry,
        targetWorkspaceId,
      );
      await this.acceptActivation(authority);

      return Object.freeze({
        migrationChainIdentity: migration.migrationChainIdentity,
        profileId: preflight.profileId,
        workspaceId: targetWorkspaceId,
      });
    } catch (error) {
      try {
        await this.recoverFailure({
          authority,
          operationId,
          paths,
          target: initialTarget,
          writesQuiesced,
        });
      } catch (recoveryError) {
        throw mapWorkspaceBackupReplacementError(
          recoveryError,
          'WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED',
          'rollback',
        );
      }
      throw mapWorkspaceBackupReplacementError(
        error,
        'WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED',
        'rollback',
      );
    } finally {
      await lease.release().catch((error) => {
        throw mapWorkspaceBackupReplacementError(
          error,
          'WORKSPACE_REPLACEMENT_LIFECYCLE_FAILED',
          'lease',
        );
      });
    }
  }

  private async recoverFailure(
    context: Readonly<ReplacementFailureContext>,
  ): Promise<void> {
    const journal = await this.readActivationJournal(context.authority);
    if (
      journal !== undefined &&
      journal.operationId !== context.operationId
    ) {
      throw new WorkspaceBackupReplacementError(
        'WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED',
        'rollback',
      );
    }

    if (journal !== undefined) {
      await this.quiesceRuntime(context.target.entry.workspaceId);
      await this.stopRuntime(context.target.entry.workspaceId);
      await this.assertRuntimeAbsent();
      await context.authority.transaction.rollback();
      if (this.options.runtimeHandoff !== undefined) {
        this.options.runtimeHandoff.requestRelaunch();
        return;
      }
      await this.ensureRuntimeRunning(context.target.entry.workspaceId);
      await this.validateRunningRuntime({
        workspaceId: context.target.entry.workspaceId,
        expectedProfileId:
          context.target.entry.lineageIdentity.profileId,
      });
      await context.authority.transaction.clearRolledBack();
      return;
    }

    await this.options.rootStore.discardBeforeActivation(context.paths);
    if (context.writesQuiesced) {
      if (this.options.runtimeHandoff !== undefined) {
        this.options.runtimeHandoff.requestRelaunch();
        return;
      }
      await this.ensureRuntimeRunning(context.target.entry.workspaceId);
      await this.validateRunningRuntime({
        workspaceId: context.target.entry.workspaceId,
        expectedProfileId:
          context.target.entry.lineageIdentity.profileId,
      });
    }
  }

  private async assertNoUnresolvedOperations(): Promise<void> {
    try {
      await this.options.operationGuard.assertNoUnresolvedOperations();
    } catch (error) {
      throw mapWorkspaceBackupReplacementError(
        error,
        'WORKSPACE_REPLACEMENT_OPERATION_UNRESOLVED',
        'operationGuard',
      );
    }
  }

  private async assertActivationIdle(
    authority: Readonly<WorkspaceReplacementActivationAuthority>,
  ): Promise<void> {
    if ((await this.readActivationJournal(authority)) !== undefined) {
      throw new WorkspaceBackupReplacementError(
        'WORKSPACE_REPLACEMENT_OPERATION_UNRESOLVED',
        'activationJournal',
      );
    }
  }

  private readActivationJournal(
    authority: Readonly<WorkspaceReplacementActivationAuthority>,
  ): Promise<ProfileRestoreActivationJournal | undefined> {
    return authority.journalStore.read().catch((error) => {
      throw mapWorkspaceBackupReplacementError(
        error,
        'WORKSPACE_REPLACEMENT_OPERATION_UNRESOLVED',
        'activationJournal',
      );
    });
  }

  private readRegistry(
    stage: 'registryRead' | 'registryRevalidation',
  ) {
    return this.options.registry.read().catch((error) => {
      throw mapWorkspaceBackupReplacementError(
        error,
        'WORKSPACE_REPLACEMENT_REGISTRY_FAILED',
        stage,
      );
    });
  }

  private inspectBackup(input: Readonly<WorkspaceBackupSourceInput>) {
    return this.options.backupContainer.inspect(input).then(
      (value) => validatePreflight(value, 'backupPreflight'),
      (error) => {
        throw mapWorkspaceBackupReplacementError(
          error,
          'WORKSPACE_REPLACEMENT_BACKUP_FAILED',
          'backupPreflight',
        );
      },
    );
  }

  private stageBackup(
    input: Parameters<WorkspaceBackupContainerPort['stage']>[0],
  ) {
    return this.options.backupContainer.stage(input).then(
      (value) => validatePreflight(value, 'backupStage'),
      (error) => {
        throw mapWorkspaceBackupReplacementError(
          error,
          'WORKSPACE_REPLACEMENT_BACKUP_FAILED',
          'backupStage',
        );
      },
    );
  }

  private migrateCandidate(
    input: Parameters<WorkspaceBackupCandidatePort['migrate']>[0],
  ) {
    return this.options.backupCandidate.migrate(input).catch((error) => {
      throw mapWorkspaceBackupReplacementError(
        error,
        'WORKSPACE_REPLACEMENT_MIGRATION_FAILED',
        'candidateMigration',
      );
    });
  }

  private async validateCandidate(
    input: Parameters<WorkspaceBackupCandidatePort['validateAndMaterialize']>[0],
  ) {
    try {
      return validateWorkspaceBackupCandidateReadiness(
        await this.options.backupCandidate.validateAndMaterialize(input),
      );
    } catch (error) {
      throw mapWorkspaceBackupReplacementError(
        error,
        'WORKSPACE_REPLACEMENT_VALIDATION_FAILED',
        'candidateValidation',
      );
    }
  }

  private acquireLease() {
    return this.options.maintenanceLease.acquire('replace').catch((error) => {
      throw mapWorkspaceBackupReplacementError(
        error,
        'WORKSPACE_REPLACEMENT_BUSY',
        'lease',
      );
    });
  }

  private quiesceRuntime(workspaceId: WorkspaceId): Promise<void> {
    return this.options.activeWorkspaceLifecycle
      .quiesceWrites(workspaceId)
      .catch((error) => {
        throw mapWorkspaceBackupReplacementError(
          error,
          'WORKSPACE_REPLACEMENT_LIFECYCLE_FAILED',
          'activeRuntimeQuiesce',
        );
      });
  }

  private async stopRuntime(workspaceId: WorkspaceId): Promise<void> {
    try {
      const stopped =
        await this.options.activeWorkspaceLifecycle.stopAndProveHandlesClosed(
          workspaceId,
        );
      if (stopped.handlesClosed !== true) throw new Error('not-closed');
    } catch (error) {
      throw mapWorkspaceBackupReplacementError(
        error,
        'WORKSPACE_REPLACEMENT_LIFECYCLE_FAILED',
        'activeRuntimeStop',
      );
    }
  }

  private assertRuntimeAbsent(): Promise<void> {
    return this.options.workspaceRuntimeAbsence
      .assertNoActiveWorkspaceRuntime()
      .catch((error) => {
        throw mapWorkspaceBackupReplacementError(
          error,
          'WORKSPACE_REPLACEMENT_LIFECYCLE_FAILED',
          'runtimeAbsence',
        );
      });
  }

  private createPreRestore(
    operationId: WorkspaceBackupReplacementOperationId,
    workspaceId: WorkspaceId,
  ): Promise<void> {
    return this.options.preRestoreRecoveryPoint
      .createPreRestore({ operationId, workspaceId })
      .catch((error) => {
        throw mapWorkspaceBackupReplacementError(
          error,
          'WORKSPACE_REPLACEMENT_RECOVERY_POINT_FAILED',
          'preRestore',
        );
      });
  }

  private prepareCandidate(
    paths: ReturnType<typeof deriveWorkspaceBackupReplacementPaths>,
  ): Promise<void> {
    return this.options.rootStore.prepareCandidate(paths).catch((error) => {
      throw mapWorkspaceBackupReplacementError(
        error,
        'WORKSPACE_REPLACEMENT_STORAGE_FAILED',
        'candidateRoot',
      );
    });
  }

  private removeImportStaging(
    paths: ReturnType<typeof deriveWorkspaceBackupReplacementPaths>,
  ): Promise<void> {
    return this.options.rootStore.removeImportStaging(paths).catch((error) => {
      throw mapWorkspaceBackupReplacementError(
        error,
        'WORKSPACE_REPLACEMENT_STORAGE_FAILED',
        'cleanup',
      );
    });
  }

  private inspectCandidate(
    paths: ReturnType<typeof deriveWorkspaceBackupReplacementPaths>,
  ): Promise<void> {
    return this.options.rootStore.inspectCandidate(paths).catch((error) => {
      throw mapWorkspaceBackupReplacementError(
        error,
        'WORKSPACE_REPLACEMENT_STORAGE_FAILED',
        'candidateValidation',
      );
    });
  }

  private prepareActivation(
    authority: Readonly<WorkspaceReplacementActivationAuthority>,
    operationId: WorkspaceBackupReplacementOperationId,
  ): Promise<void> {
    return authority.transaction.prepare(operationId).catch((error) => {
      throw mapWorkspaceBackupReplacementError(
        error,
        'WORKSPACE_REPLACEMENT_ACTIVATION_FAILED',
        'activationPrepare',
      );
    });
  }

  private replaceActiveRoot(
    authority: Readonly<WorkspaceReplacementActivationAuthority>,
  ): Promise<unknown> {
    return authority.transaction.advanceToValidation().catch((error) => {
      throw mapWorkspaceBackupReplacementError(
        error,
        'WORKSPACE_REPLACEMENT_ACTIVATION_FAILED',
        'activationReplace',
      );
    });
  }

  private acceptActivation(
    authority: Readonly<WorkspaceReplacementActivationAuthority>,
  ): Promise<void> {
    return authority.transaction.accept().catch((error) => {
      throw mapWorkspaceBackupReplacementError(
        error,
        'WORKSPACE_REPLACEMENT_ACTIVATION_FAILED',
        'activationReplace',
      );
    });
  }

  private ensureRuntimeRunning(workspaceId: WorkspaceId): Promise<void> {
    return this.options.activeWorkspaceLifecycle
      .ensurePreviousWorkspaceRunning(workspaceId)
      .catch((error) => {
        throw mapWorkspaceBackupReplacementError(
          error,
          'WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED',
          'activeRuntimeRestart',
        );
      });
  }

  private async validateRunningRuntime(input: {
    readonly expectedMigrationChainIdentity?: string;
    readonly expectedProfileId: string;
    readonly workspaceId: WorkspaceId;
  }): Promise<void> {
    let result: Readonly<WorkspaceReplacementRuntimeReadiness>;
    try {
      result = await this.options.runtimeReadiness.assertReady(input);
    } catch (error) {
      throw mapWorkspaceBackupReplacementError(
        error,
        'WORKSPACE_REPLACEMENT_VALIDATION_FAILED',
        'activeRuntimeValidation',
      );
    }
    if (
      result.workspaceId !== input.workspaceId ||
      result.profileId !== input.expectedProfileId ||
      (input.expectedMigrationChainIdentity !== undefined &&
        result.migrationChainIdentity !==
          input.expectedMigrationChainIdentity) ||
      result.artifactRootHealth !== 'ready' ||
      result.backendOwnerCount !== 1 ||
      result.databaseHealth !== 'healthy' ||
      result.foreignKeyHealth !== 'healthy' ||
      result.runtimeSessionState !== 'rotated' ||
      result.sqliteOwnerCount !== 1 ||
      !sha256Pattern.test(result.migrationChainIdentity)
    ) {
      throw new WorkspaceBackupReplacementError(
        'WORKSPACE_REPLACEMENT_VALIDATION_FAILED',
        'activeRuntimeValidation',
      );
    }
  }

  private createOperationId(): WorkspaceBackupReplacementOperationId {
    try {
      return this.generateOperationId();
    } catch {
      throw new WorkspaceBackupReplacementError(
        'WORKSPACE_REPLACEMENT_INVALID',
        'inputValidation',
      );
    }
  }
}

function validateTargetWorkspaceId(value: unknown): WorkspaceId {
  try {
    return validateWorkspaceId(value);
  } catch {
    throw new WorkspaceBackupReplacementError(
      'WORKSPACE_REPLACEMENT_INVALID',
      'inputValidation',
    );
  }
}

function validatePreflight(
  value: Readonly<WorkspaceBackupPreflightResult>,
  stage: 'backupPreflight' | 'backupStage',
): Readonly<WorkspaceBackupPreflightResult> {
  if (
    !boundedVersionPattern.test(value.appVersion) ||
    !sha256Pattern.test(value.containerSha256) ||
    !sha256Pattern.test(value.migrationChainIdentity) ||
    !sha256Pattern.test(value.profileId)
  ) {
    throw new WorkspaceBackupReplacementError(
      'WORKSPACE_REPLACEMENT_BACKUP_FAILED',
      stage,
    );
  }
  return value;
}

function assertSamePreflight(
  expected: Readonly<WorkspaceBackupPreflightResult>,
  actual: Readonly<WorkspaceBackupPreflightResult>,
): void {
  if (
    expected.appVersion !== actual.appVersion ||
    expected.containerSha256 !== actual.containerSha256 ||
    expected.migrationChainIdentity !== actual.migrationChainIdentity ||
    expected.profileId !== actual.profileId
  ) {
    throw new WorkspaceBackupReplacementError(
      'WORKSPACE_REPLACEMENT_BACKUP_FAILED',
      'backupStage',
    );
  }
}
