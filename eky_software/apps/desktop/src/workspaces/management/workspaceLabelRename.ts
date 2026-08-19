import type { WorkspaceMaintenanceLease } from '../maintenance/workspaceMaintenanceLease.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { validateWorkspaceLabel } from '../registry/workspaceLabelValidation.js';
import {
  readWorkspaceRegistry,
  renameWorkspaceLabel,
} from '../registry/workspaceRegistryMutations.js';
import type { WorkspaceRegistryPort } from '../registry/workspaceRegistryPort.js';
import type { WorkspaceId } from '../registry/workspaceRegistryTypes.js';
import {
  mapWorkspaceManagementError,
  WorkspaceManagementError,
} from './workspaceManagementError.js';
import type { WorkspaceManagementOperationGuard } from './workspaceManagementOperationGuard.js';

export interface WorkspaceLabelRenameResult {
  readonly changed: boolean;
  readonly workspaceId: WorkspaceId;
  readonly workspaceLabel: string;
}

export class WorkspaceLabelRename {
  constructor(
    private readonly options: Readonly<{
      maintenanceLease: WorkspaceMaintenanceLease;
      operationGuard: WorkspaceManagementOperationGuard;
      registry: WorkspaceRegistryPort;
    }>,
  ) {}

  async rename(
    workspaceIdInput: unknown,
    workspaceLabelInput: unknown,
  ): Promise<Readonly<WorkspaceLabelRenameResult>> {
    let workspaceId: WorkspaceId;
    let workspaceLabel: string;
    try {
      workspaceId = validateWorkspaceId(workspaceIdInput);
      workspaceLabel = validateWorkspaceLabel(workspaceLabelInput);
    } catch {
      throw new WorkspaceManagementError(
        'WORKSPACE_MANAGEMENT_INVALID',
        'rename',
      );
    }
    const lease = await this.options.maintenanceLease
      .acquire('rename')
      .catch((error) => {
        throw mapWorkspaceManagementError(error, 'rename');
      });
    let operationError: WorkspaceManagementError | undefined;
    let result: Readonly<WorkspaceLabelRenameResult> | undefined;
    try {
      await this.options.operationGuard.assertNoUnresolvedOperations();
      const registry = readWorkspaceRegistry(await this.options.registry.read());
      const next = renameWorkspaceLabel(
        registry,
        workspaceId,
        workspaceLabel,
      );
      if (next !== registry) {
        await this.options.registry.write(next);
      }
      result = Object.freeze({
        changed: next !== registry,
        workspaceId,
        workspaceLabel,
      });
    } catch (error) {
      operationError = mapWorkspaceManagementError(error, 'rename');
    }
    try {
      await lease.release();
    } catch (error) {
      operationError ??= mapWorkspaceManagementError(error, 'rename');
    }
    if (operationError !== undefined) throw operationError;
    return result!;
  }
}
