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
  readonly guard: Pick<WorkspaceActivationMigrationGuard, 'prove'>;
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

    const inspection = await this.options.inspector.inspect({
      expectedProfileId: context.targetProfileId,
      operationId: context.operationId,
      userDataRoot: this.options.userDataRoot,
      workspaceId: context.targetWorkspaceId,
    });
    if (inspection.status === 'current') return notRequiredPreparation;
    if (inspection.status === 'invalidHistory') {
      await this.rejectInvalidTarget();
      return Object.freeze({ status: 'relaunchRequired' });
    }

    const proof = await this.options.guard.prove({
      expectedProfileId: context.targetProfileId,
      operationId: context.operationId,
      sourceWorkspaceId: context.sourceWorkspaceId,
      targetWorkspaceId: context.targetWorkspaceId,
    });
    const readiness = await this.options.historicalValidation
      .validateHistoricalPublished({
        ...this.options.publishedValidationInput,
        operationId: proof.operationId,
        workspaceId: proof.targetWorkspaceId,
      });
    if (
      readiness.handlesClosed !== true ||
      readiness.lineageIdentity.profileId !== proof.profileId ||
      readiness.migrationState !== 'compatiblePending'
    ) {
      throw new WorkspaceActivationMigrationError(
        'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
      );
    }

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
