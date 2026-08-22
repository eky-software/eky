import { createDesktopProfilePaths } from '../../runtime/desktopProfilePaths.js';
import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import { inspectWorkspaceRoot } from '../registry/inspectWorkspaceRoot.js';
import type { WorkspaceId } from '../registry/workspaceRegistryTypes.js';
import type {
  PrivateWorkspaceMigrationInspectionRuntime,
  PrivateWorkspaceMigrationInspectionRuntimeFactory,
  WorkspaceMigrationInspectionResult,
} from './workspaceMigrationInventoryTypes.js';
import { WorkspaceActivationMigrationError } from './workspaceActivationMigrationError.js';

export interface WorkspaceActivationMigrationInspectionInput {
  readonly expectedProfileId: string;
  readonly operationId: string;
  readonly userDataRoot: string;
  readonly workspaceId: WorkspaceId;
}

export class WorkspaceActivationMigrationInspector {
  constructor(
    private readonly runtimeFactory: PrivateWorkspaceMigrationInspectionRuntimeFactory,
  ) {}

  async inspect(
    input: Readonly<WorkspaceActivationMigrationInspectionInput>,
  ): Promise<Readonly<WorkspaceMigrationInspectionResult>> {
    let runtime: PrivateWorkspaceMigrationInspectionRuntime | undefined;
    try {
      const roots = await inspectWorkspaceRoot(
        deriveWorkspaceRoot(input.userDataRoot, input.workspaceId, 1),
      );
      const profile = createDesktopProfilePaths(roots.workspaceRoot);
      runtime = await this.runtimeFactory.startMigrationInspection({
        databaseFilePath: profile.databaseFilePath,
        expectedProfileId: input.expectedProfileId,
        operationId: input.operationId,
        publishedRoot: roots.workspaceRoot,
      });
      if (!(await runtime.stopAndProveHandlesClosed())) {
        throw new Error('handles-open');
      }
      return Object.freeze(
        await runtime.inspectStoppedMigrationInspection(),
      );
    } catch (error) {
      if (error instanceof WorkspaceActivationMigrationError) throw error;
      throw new WorkspaceActivationMigrationError(
        'WORKSPACE_ACTIVATION_MIGRATION_FAILED',
      );
    } finally {
      if (runtime !== undefined) {
        await runtime.stopAndProveHandlesClosed().catch(() => false);
      }
    }
  }
}
