import type { PreWorkspaceBuildAdmission } from '../../update/preWorkspaceBuildAdmission.js';
import type { LocalWorkspaceRegistryV1, WorkspaceId } from '../registry/workspaceRegistryTypes.js';
import type {
  WorkspaceMigrationInventory,
  WorkspaceMigrationInventoryStatus,
} from './workspaceMigrationInventoryTypes.js';

export interface WorkspaceFirstStartBuildIdentity {
  readonly appVersion: string;
  readonly buildRevision: string;
}

export interface WorkspaceFirstStartMigrationPlanInput {
  readonly admission: PreWorkspaceBuildAdmission;
  readonly inventory?: Readonly<WorkspaceMigrationInventory>;
  readonly registry: Readonly<LocalWorkspaceRegistryV1>;
  readonly sourceBuild: Readonly<WorkspaceFirstStartBuildIdentity> | null;
  readonly targetBuild: Readonly<WorkspaceFirstStartBuildIdentity>;
}

export interface WorkspaceFirstStartActiveMigrationPlan {
  readonly appliedMigrationCount: number;
  readonly pendingMigrationCount: number;
  readonly status: WorkspaceMigrationInventoryStatus;
  readonly workspaceId: WorkspaceId;
}

export type WorkspaceFirstStartMigrationPlan =
  | Readonly<{
      activeWorkspace: null;
      kind: 'notRequired';
      passiveRecoveryWorkspaceIds: readonly [];
    }>
  | Readonly<{
      activeWorkspace: Readonly<WorkspaceFirstStartActiveMigrationPlan>;
      kind: 'notRequired' | 'required';
      passiveRecoveryWorkspaceIds: readonly WorkspaceId[];
    }>;
