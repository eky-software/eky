import type {
  DesktopBackendStartupControl,
  StartDesktopBackendOptions,
} from '../../runtime/backendProcess.js';
import type {
  HistoricalPublishedWorkspaceValidationPort,
  PublishedWorkspaceBackupValidationInput,
} from '../import/workspaceBackupImportPorts.js';
import type { ActiveWorkspaceStartupSelection } from '../runtime/resolveActiveWorkspaceStartup.js';
import type { WorkspaceActivationMigrationCoordinator } from './workspaceActivationMigrationCoordinator.js';
import { WorkspaceActivationMigrationError } from './workspaceActivationMigrationError.js';
import type { WorkspaceActivationMigrationGuard } from './workspaceActivationMigrationGuard.js';
import type { WorkspaceActivationMigrationProof } from './workspaceActivationMigrationGuard.js';
import type { WorkspaceActivationMigrationInspector } from './workspaceActivationMigrationInspector.js';

type BackendMigrationInspection = Parameters<
  StartDesktopBackendOptions['beforeMigrations']
>[0];

export type WorkspaceActivationMigrationPreparation =
  | Readonly<{
      migrationStartupPolicy: 'exactCurrentManifest';
      status: 'notRequired';
    }>
  | Readonly<{
      status: 'relaunchRequired';
    }>
  | Readonly<{
      migrationStartupPolicy: 'restoreCompatible';
      status: 'migrationRequired';
    }>;

interface WorkspaceActivationMigrationStartupOptions {
  readonly activeWorkspace: Pick<
    ActiveWorkspaceStartupSelection,
    | 'mode'
    | 'rejectInvalidTarget'
    | 'switchContext'
    | 'workspaceId'
    | 'workspaceRoot'
  >;
  readonly coordinator: Pick<
    WorkspaceActivationMigrationCoordinator,
    'migrateAndActivate'
  >;
  readonly guard: Pick<WorkspaceActivationMigrationGuard, 'prove' | 'reprove'>;
  readonly historicalValidation: HistoricalPublishedWorkspaceValidationPort;
  readonly inspector: Pick<WorkspaceActivationMigrationInspector, 'inspect'>;
  readonly markTargetRuntimeStopped: () => void;
  readonly publishedValidationInput: Omit<
    PublishedWorkspaceBackupValidationInput,
    'operationId' | 'workspaceId'
  >;
  readonly requestRelaunch: () => void;
  readonly userDataRoot: string;
}

interface PendingActivationMigration {
  readonly appliedMigrationCount: number;
  readonly expectedSourceMigrationChainIdentity: string;
  readonly pendingMigrationCount: number;
  readonly proof: Readonly<WorkspaceActivationMigrationProof>;
}

export class WorkspaceActivationMigrationStartup {
  private migrationStarted = false;
  private pending: PendingActivationMigration | undefined;
  private prepared = false;
  private selectorRequired = false;
  private selectorProof: Readonly<WorkspaceActivationMigrationProof> | undefined;

  constructor(
    private readonly options: Readonly<WorkspaceActivationMigrationStartupOptions>,
  ) {}

  async prepareBeforeBackend(): Promise<WorkspaceActivationMigrationPreparation> {
    if (this.prepared) {
      throw new WorkspaceActivationMigrationError(
        'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
      );
    }
    this.prepared = true;

    const { activeWorkspace } = this.options;
    if (activeWorkspace.mode !== 'targetValidation') {
      return notRequiredPreparation;
    }
    const context = activeWorkspace.switchContext;
    if (
      context === undefined ||
      context.targetWorkspaceId !== activeWorkspace.workspaceId
    ) {
      throw new WorkspaceActivationMigrationError(
        'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
      );
    }

    const guardInput = {
      expectedProfileId: context.targetProfileId,
      operationId: context.operationId,
      sourceWorkspaceId: context.sourceWorkspaceId,
      targetWorkspaceId: context.targetWorkspaceId,
    };
    this.selectorRequired = context.sourceWorkspaceId === null;
    const selectorProof = this.selectorRequired
      ? await this.options.guard.prove(guardInput) : undefined;
    const inspection = await this.options.inspector.inspect({
      expectedProfileId: guardInput.expectedProfileId,
      operationId: guardInput.operationId,
      userDataRoot: this.options.userDataRoot,
      workspaceId: guardInput.targetWorkspaceId,
    });
    if (selectorProof !== undefined) await this.options.guard.reprove(selectorProof);
    if (inspection.status === 'current') {
      this.selectorProof = selectorProof;
      return notRequiredPreparation;
    }
    if (inspection.status === 'invalidHistory') {
      await this.rejectInvalidTarget();
      return Object.freeze({ status: 'relaunchRequired' });
    }

    const proof = selectorProof ?? await this.options.guard.prove(guardInput);
    const readiness = await this.options.historicalValidation
      .validateHistoricalPublished({
        ...this.options.publishedValidationInput,
        operationId: proof.operationId,
        workspaceId: proof.targetWorkspaceId,
      });
    if (selectorProof !== undefined) await this.options.guard.reprove(selectorProof);
    if (
      readiness.handlesClosed !== true ||
      readiness.lineageIdentity.profileId !== proof.profileId ||
      readiness.migrationState !== 'compatiblePending'
    ) {
      throw new WorkspaceActivationMigrationError(
        'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
      );
    }

    this.selectorProof = selectorProof;
    this.pending = Object.freeze({
      appliedMigrationCount: inspection.appliedMigrationCount,
      expectedSourceMigrationChainIdentity:
        readiness.migrationChainIdentity,
      pendingMigrationCount: inspection.pendingMigrationCount,
      proof,
    });
    return Object.freeze({
      migrationStartupPolicy: 'restoreCompatible',
      status: 'migrationRequired',
    });
  }

  async beforeMigrations(
    inspection: Readonly<BackendMigrationInspection>,
    control: DesktopBackendStartupControl,
  ): Promise<'notRequired' | 'relaunchRequired'> {
    if (this.selectorRequired) {
      if (this.selectorProof === undefined) {
        throw new WorkspaceActivationMigrationError('WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED');
      }
      await this.options.guard.reprove(this.selectorProof);
    }
    const pending = this.pending;
    if (pending === undefined) return 'notRequired';
    if (this.migrationStarted || !inspectionMatches(inspection, pending)) {
      throw new WorkspaceActivationMigrationError(
        'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
      );
    }
    this.migrationStarted = true;

    await this.options.coordinator.migrateAndActivate({
      expectedSourceMigrationChainIdentity:
        pending.expectedSourceMigrationChainIdentity,
      proof: pending.proof,
      stopTargetStartupRuntime: async () => {
        await control.stopStartupRuntime();
        this.options.markTargetRuntimeStopped();
      },
    });
    return 'relaunchRequired';
  }

  private async rejectInvalidTarget(): Promise<void> {
    const reject = this.options.activeWorkspace.rejectInvalidTarget;
    if (reject === undefined) {
      throw new WorkspaceActivationMigrationError(
        'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
      );
    }
    const outcome = await reject();
    if (outcome !== 'relaunchRequired') {
      throw new WorkspaceActivationMigrationError(
        'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
      );
    }
    try {
      this.options.requestRelaunch();
    } catch {
      throw new WorkspaceActivationMigrationError(
        'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
      );
    }
  }
}

const notRequiredPreparation = Object.freeze({
  migrationStartupPolicy: 'exactCurrentManifest',
  status: 'notRequired',
} as const);

function inspectionMatches(
  inspection: Readonly<BackendMigrationInspection>,
  pending: Readonly<PendingActivationMigration>,
): boolean {
  return (
    inspection.profileState === 'existing' &&
    inspection.appliedMigrationCount === pending.appliedMigrationCount &&
    inspection.pendingMigrationCount === pending.pendingMigrationCount &&
    inspection.pendingMigrationCount > 0 &&
    inspection.migrationChainIdentity ===
      pending.expectedSourceMigrationChainIdentity
  );
}
