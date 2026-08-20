import type { WorkspaceMaintenanceState } from '../maintenance/workspaceMaintenanceLease.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { validateWorkspaceLabel } from '../registry/workspaceLabelValidation.js';
import type { LocalWorkspaceRegistryV1 } from '../registry/workspaceRegistryTypes.js';
import {
  hasExactDataKeys,
  isPlainDataRecord,
} from '../registry/workspaceRegistryValueShape.js';
import { WORKSPACE_REGISTRY_MAX_ENTRIES } from '../registry/workspaceRegistryValidation.js';
import { WorkspaceManagementError } from './workspaceManagementError.js';
import type {
  WorkspaceManagementAvailability,
  WorkspaceManagementEntryV1,
  WorkspaceManagementOperationState,
  WorkspaceManagementStatusV1,
} from './workspaceManagementTypes.js';

const MAX_STATUS_BYTES = 32 * 1024;
const statusKeys = [
  'activeWorkspaceId',
  'formatVersion',
  'operationState',
  'workspaces',
] as const;
const entryKeys = [
  'availability',
  'isActive',
  'workspaceId',
  'workspaceLabel',
] as const;
const operationStates = new Set<WorkspaceManagementOperationState>([
  'idle',
  'busy',
  'recoveryRequired',
]);
const availabilityStates = new Set<WorkspaceManagementAvailability>([
  'ready',
  'recoveryRequired',
]);

export function createWorkspaceManagementStatus(input: {
  readonly maintenanceState: WorkspaceMaintenanceState;
  readonly operationRecoveryRequired: boolean;
  readonly registry: Readonly<LocalWorkspaceRegistryV1>;
}): Readonly<WorkspaceManagementStatusV1> {
  const operationState: WorkspaceManagementOperationState =
    input.operationRecoveryRequired
      ? 'recoveryRequired'
      : input.maintenanceState;
  return parseWorkspaceManagementStatus({
    activeWorkspaceId: input.registry.activeWorkspaceId,
    formatVersion: 1,
    operationState,
    workspaces: input.registry.workspaces.map((entry) => ({
      availability: entry.lifecycleState,
      isActive: entry.workspaceId === input.registry.activeWorkspaceId,
      workspaceId: entry.workspaceId,
      workspaceLabel: entry.workspaceLabel,
    })),
  });
}

export function parseWorkspaceManagementStatus(
  value: unknown,
): Readonly<WorkspaceManagementStatusV1> {
  try {
    if (!isPlainDataRecord(value) || !hasExactDataKeys(value, statusKeys)) {
      return invalidStatus();
    }
    if (
      value.formatVersion !== 1 ||
      !operationStates.has(
        value.operationState as WorkspaceManagementOperationState,
      ) ||
      !Array.isArray(value.workspaces) ||
      value.workspaces.length > WORKSPACE_REGISTRY_MAX_ENTRIES
    ) {
      return invalidStatus();
    }
    const activeWorkspaceId =
      value.activeWorkspaceId === null
        ? null
        : validateWorkspaceId(value.activeWorkspaceId);
    const seenIds = new Set<string>();
    const workspaces = value.workspaces.map((entry) => {
      if (!isPlainDataRecord(entry) || !hasExactDataKeys(entry, entryKeys)) {
        return invalidStatus();
      }
      const workspaceId = validateWorkspaceId(entry.workspaceId);
      if (seenIds.has(workspaceId)) return invalidStatus();
      seenIds.add(workspaceId);
      if (
        typeof entry.isActive !== 'boolean' ||
        !availabilityStates.has(
          entry.availability as WorkspaceManagementAvailability,
        )
      ) {
        return invalidStatus();
      }
      return Object.freeze<WorkspaceManagementEntryV1>({
        availability:
          entry.availability as WorkspaceManagementAvailability,
        isActive: entry.isActive,
        workspaceId,
        workspaceLabel: validateWorkspaceLabel(entry.workspaceLabel),
      });
    });
    const activeEntries = workspaces.filter((entry) => entry.isActive);
    if (
      (activeWorkspaceId === null && activeEntries.length !== 0) ||
      (activeWorkspaceId !== null &&
        (activeEntries.length !== 1 ||
          activeEntries[0]!.workspaceId !== activeWorkspaceId ||
          activeEntries[0]!.availability !== 'ready'))
    ) {
      return invalidStatus();
    }
    const result = Object.freeze<WorkspaceManagementStatusV1>({
      activeWorkspaceId,
      formatVersion: 1,
      operationState:
        value.operationState as WorkspaceManagementOperationState,
      workspaces: Object.freeze(workspaces),
    });
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_STATUS_BYTES) {
      return invalidStatus();
    }
    return result;
  } catch {
    return invalidStatus();
  }
}

function invalidStatus(): never {
  throw new WorkspaceManagementError(
    'WORKSPACE_MANAGEMENT_INVALID',
    'status',
  );
}
