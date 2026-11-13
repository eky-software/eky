import type { WorkspaceMaintenanceState } from '../maintenance/workspaceMaintenanceLease.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { findDuplicateWorkspaceLabelIds } from '../registry/workspaceLabelComparison.js';
import { validateWorkspaceLabel } from '../registry/workspaceLabelValidation.js';
import type { LocalWorkspaceRegistry } from '../registry/workspaceRegistryTypes.js';
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
  WorkspaceRecoveryManagementStatusV2,
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
const recoveryStatusKeys = [
  'formatVersion',
  'mode',
  'runtimeState',
  'maintenanceState',
  'operationState',
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
  readonly registry: Readonly<LocalWorkspaceRegistry>;
}): Readonly<WorkspaceManagementStatusV1> {
  const operationState: WorkspaceManagementOperationState =
    input.operationRecoveryRequired
      ? 'recoveryRequired'
      : input.maintenanceState;
  const duplicateWorkspaceLabelIds = [
    ...findDuplicateWorkspaceLabelIds(input.registry.workspaces),
  ];
  return parseWorkspaceManagementStatus({
    activeWorkspaceId: input.registry.activeWorkspaceId,
    formatVersion: 1,
    operationState,
    ...(duplicateWorkspaceLabelIds.length === 0
      ? {}
      : { duplicateWorkspaceLabelIds }),
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
    if (
      !isPlainDataRecord(value) ||
      !hasExactDataKeys(value, [
        ...statusKeys,
        ...(Object.hasOwn(value, 'duplicateWorkspaceLabelIds')
          ? ['duplicateWorkspaceLabelIds']
          : []),
      ])
    ) {
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
    const duplicateWorkspaceLabelIds = Object.hasOwn(value, 'duplicateWorkspaceLabelIds')
      ? parseDuplicateWorkspaceLabelIds(value.duplicateWorkspaceLabelIds, seenIds)
      : undefined;
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
      ...(duplicateWorkspaceLabelIds === undefined
        ? {}
        : { duplicateWorkspaceLabelIds }),
    });
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_STATUS_BYTES) {
      return invalidStatus();
    }
    return result;
  } catch {
    return invalidStatus();
  }
}

// Separate from the v1 parser; the main owner selects the format on one channel.
export function parseWorkspaceRecoveryManagementStatus(
  value: unknown,
): WorkspaceRecoveryManagementStatusV2 {
  try {
    if (!isPlainDataRecord(value)) return invalidStatus();
    const operation = Object.getOwnPropertyDescriptor(value, 'operationState');
    if (operation === undefined || !('value' in operation)) return invalidStatus();
    const idle = operation.value === 'idle';
    if (!hasExactDataKeys(value, idle
      ? [...recoveryStatusKeys, 'persistedActiveWorkspaceId', 'target']
      : recoveryStatusKeys) || value.formatVersion !== 2 ||
        value.mode !== 'recoveryManagement' || value.runtimeState !== 'absent') {
      return invalidStatus();
    }
    const maintenanceState = value.maintenanceState;
    if (maintenanceState !== 'idle' && maintenanceState !== 'busy') return invalidStatus();
    const common = { formatVersion: 2 as const, mode: 'recoveryManagement' as const,
      runtimeState: 'absent' as const, maintenanceState };
    let result: WorkspaceRecoveryManagementStatusV2;
    if (idle) {
      if (maintenanceState !== 'idle' || !isPlainDataRecord(value.target) ||
          !hasExactDataKeys(value.target, ['workspaceId', 'workspaceLabel'])) {
        return invalidStatus();
      }
      const persistedActiveWorkspaceId = value.persistedActiveWorkspaceId === null
        ? null : validateWorkspaceId(value.persistedActiveWorkspaceId);
      const target = Object.freeze({ workspaceId: validateWorkspaceId(value.target.workspaceId),
        workspaceLabel: validateWorkspaceLabel(value.target.workspaceLabel) });
      result = Object.freeze({ ...common, maintenanceState, operationState: 'idle' as const,
        persistedActiveWorkspaceId, target });
    } else {
      const operationState = value.operationState;
      if (operationState !== 'busy' && operationState !== 'recoveryRequired') return invalidStatus();
      result = Object.freeze({ ...common, maintenanceState, operationState });
    }
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_STATUS_BYTES) return invalidStatus();
    return result;
  } catch {
    return invalidStatus();
  }
}

function parseDuplicateWorkspaceLabelIds(
  value: unknown,
  workspaceIds: ReadonlySet<string>,
) {
  if (
    !Array.isArray(value) ||
    value.length < 2 ||
    value.length > WORKSPACE_REGISTRY_MAX_ENTRIES
  ) return invalidStatus();
  const seen = new Set<string>();
  return Object.freeze(Array.from(value, (item) => {
    const id = validateWorkspaceId(item);
    if (!workspaceIds.has(id) || seen.has(id)) return invalidStatus();
    seen.add(id);
    return id;
  }));
}

function invalidStatus(): never {
  throw new WorkspaceManagementError(
    'WORKSPACE_MANAGEMENT_INVALID',
    'status',
  );
}
