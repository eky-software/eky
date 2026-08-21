import { isSemVer } from '../../release/desktopBuildInfo.js';
import type { PreWorkspaceBuildAdmission } from '../../update/preWorkspaceBuildAdmission.js';
import { compareSemanticVersions } from '../../update/semanticVersionComparison.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import type { LocalWorkspaceRegistryV1, WorkspaceId } from '../registry/workspaceRegistryTypes.js';
import { validateWorkspaceRegistry } from '../registry/workspaceRegistryValidation.js';
import {
  hasExactDataKeys,
  isPlainDataRecord,
} from '../registry/workspaceRegistryValueShape.js';
import { WorkspaceFirstStartMigrationPlanError } from './workspaceFirstStartMigrationPlanError.js';
import type {
  WorkspaceFirstStartActiveMigrationPlan,
  WorkspaceFirstStartBuildIdentity,
  WorkspaceFirstStartMigrationPlan,
  WorkspaceFirstStartMigrationPlanInput,
} from './workspaceFirstStartMigrationPlanTypes.js';
import type {
  WorkspaceMigrationInventory,
  WorkspaceMigrationInventoryEntry,
  WorkspaceMigrationInventoryStatus,
} from './workspaceMigrationInventoryTypes.js';

const updateAdmissions = new Set<PreWorkspaceBuildAdmission>([
  'authorizedNewerBuild',
  'coordinatedUpdateTarget',
]);
const revisionPattern = /^[0-9a-f]{7,40}$/;
const inputKeys = [
  'admission',
  'inventory',
  'registry',
  'sourceBuild',
  'targetBuild',
] as const;
const requiredInputKeys = [
  'admission',
  'registry',
  'sourceBuild',
  'targetBuild',
] as const;
const inventoryKeys = ['activeWorkspaceId', 'entries'] as const;
const inventoryEntryKeys = [
  'appliedMigrationCount',
  'isActive',
  'pendingMigrationCount',
  'status',
  'workspaceId',
] as const;

export function resolveWorkspaceFirstStartMigrationPlan(
  input: Readonly<WorkspaceFirstStartMigrationPlanInput>,
): Readonly<WorkspaceFirstStartMigrationPlan> {
  try {
    if (!isPlannerInput(input)) {
      invalidPlan();
    }
    validateAdmission(input.admission);
    const registry = validateWorkspaceRegistry(input.registry);
    const targetBuild = validateBuildIdentity(
      input.targetBuild,
      input.admission === 'development',
    );
    const sourceBuild =
      input.sourceBuild === null ? null : validateBuildIdentity(input.sourceBuild);

    if (!updateAdmissions.has(input.admission)) {
      validateNoMigrationAdmission(input.admission, sourceBuild, targetBuild);
      if (input.inventory !== undefined) invalidPlan();
      return Object.freeze({
        activeWorkspace: null,
        kind: 'notRequired',
        passiveRecoveryWorkspaceIds: Object.freeze([]) as readonly [],
      });
    }

    validateUpdateBuilds(sourceBuild, targetBuild);
    const inventory = validateInventory(input.inventory);
    return createUpdatePlan(registry, inventory);
  } catch (error) {
    if (error instanceof WorkspaceFirstStartMigrationPlanError) throw error;
    return invalidPlan();
  }
}

function createUpdatePlan(
  registry: Readonly<LocalWorkspaceRegistryV1>,
  inventory: Readonly<WorkspaceMigrationInventory>,
): Readonly<WorkspaceFirstStartMigrationPlan> {
  const readyWorkspaceIds = registry.workspaces
    .filter((workspace) => workspace.lifecycleState === 'ready')
    .map((workspace) => workspace.workspaceId);
  if (
    inventory.activeWorkspaceId !== registry.activeWorkspaceId ||
    inventory.entries.length !== readyWorkspaceIds.length
  ) {
    return invalidPlan();
  }

  const readyWorkspaceIdSet = new Set<WorkspaceId>(readyWorkspaceIds);
  const entriesById = new Map<WorkspaceId, WorkspaceMigrationInventoryEntry>();
  for (const entry of inventory.entries) {
    if (
      !readyWorkspaceIdSet.has(entry.workspaceId) ||
      entriesById.has(entry.workspaceId) ||
      entry.isActive !== (entry.workspaceId === registry.activeWorkspaceId)
    ) {
      return invalidPlan();
    }
    entriesById.set(entry.workspaceId, entry);
  }
  if (entriesById.size !== readyWorkspaceIdSet.size) return invalidPlan();

  if (registry.activeWorkspaceId === null) {
    if (entriesById.size !== 0) return invalidPlan();
    return Object.freeze({
      activeWorkspace: null,
      kind: 'notRequired',
      passiveRecoveryWorkspaceIds: Object.freeze([]) as readonly [],
    });
  }

  const activeEntry = entriesById.get(registry.activeWorkspaceId);
  if (activeEntry === undefined || activeEntry.status === 'invalidHistory') {
    return invalidPlan();
  }
  const activeWorkspace = freezeActivePlan(activeEntry);
  const passiveRecoveryWorkspaceIds = inventory.entries
    .filter(
      (entry) => !entry.isActive && entry.status === 'invalidHistory',
    )
    .map((entry) => entry.workspaceId)
    .sort(compareWorkspaceIds);
  if (passiveRecoveryWorkspaceIds.length > 63) return invalidPlan();

  return Object.freeze({
    activeWorkspace,
    kind:
      activeEntry.status === 'compatiblePending' ||
      passiveRecoveryWorkspaceIds.length > 0
        ? ('required' as const)
        : ('notRequired' as const),
    passiveRecoveryWorkspaceIds: Object.freeze(passiveRecoveryWorkspaceIds),
  });
}

function validateInventory(
  value: unknown,
): Readonly<WorkspaceMigrationInventory> {
  if (
    !isPlainDataRecord(value) ||
    !hasExactDataKeys(value, inventoryKeys) ||
    !Array.isArray(value.entries) ||
    value.entries.length > 64
  ) {
    return invalidPlan();
  }
  const activeWorkspaceId =
    value.activeWorkspaceId === null
      ? null
      : validateWorkspaceId(value.activeWorkspaceId);
  const entries = value.entries.map(validateInventoryEntry);
  return Object.freeze({
    activeWorkspaceId,
    entries: Object.freeze(entries),
  });
}

function validateInventoryEntry(
  value: unknown,
): Readonly<WorkspaceMigrationInventoryEntry> {
  if (
    !isPlainDataRecord(value) ||
    !hasExactDataKeys(value, inventoryEntryKeys) ||
    typeof value.isActive !== 'boolean' ||
    !isMigrationStatus(value.status) ||
    !isMigrationCount(value.appliedMigrationCount) ||
    !isMigrationCount(value.pendingMigrationCount) ||
    !countsMatchStatus(
      value.status,
      value.appliedMigrationCount,
      value.pendingMigrationCount,
    )
  ) {
    return invalidPlan();
  }
  return Object.freeze({
    appliedMigrationCount: value.appliedMigrationCount,
    isActive: value.isActive,
    pendingMigrationCount: value.pendingMigrationCount,
    status: value.status,
    workspaceId: validateWorkspaceId(value.workspaceId),
  });
}

function validateNoMigrationAdmission(
  admission: PreWorkspaceBuildAdmission,
  sourceBuild: Readonly<WorkspaceFirstStartBuildIdentity> | null,
  targetBuild: Readonly<WorkspaceFirstStartBuildIdentity>,
): void {
  if (admission === 'development' || admission === 'initialInstall') {
    if (sourceBuild !== null) invalidPlan();
    return;
  }
  if (
    admission !== 'exactAcceptedBuild' ||
    sourceBuild === null ||
    !buildsAreEqual(sourceBuild, targetBuild)
  ) {
    invalidPlan();
  }
}

function validateUpdateBuilds(
  sourceBuild: Readonly<WorkspaceFirstStartBuildIdentity> | null,
  targetBuild: Readonly<WorkspaceFirstStartBuildIdentity>,
): void {
  if (
    sourceBuild === null ||
    compareSemanticVersions(targetBuild.appVersion, sourceBuild.appVersion) <= 0
  ) {
    invalidPlan();
  }
}

function validateBuildIdentity(
  value: unknown,
  allowDevelopmentRevision = false,
): Readonly<WorkspaceFirstStartBuildIdentity> {
  if (
    !isPlainDataRecord(value) ||
    !hasExactDataKeys(value, ['appVersion', 'buildRevision'] as const) ||
    typeof value.appVersion !== 'string' ||
    !isSemVer(value.appVersion) ||
    typeof value.buildRevision !== 'string' ||
    (!revisionPattern.test(value.buildRevision) &&
      !(allowDevelopmentRevision && value.buildRevision === 'development'))
  ) {
    return invalidPlan();
  }
  return Object.freeze({
    appVersion: value.appVersion,
    buildRevision: value.buildRevision,
  });
}

function freezeActivePlan(
  entry: Readonly<WorkspaceMigrationInventoryEntry>,
): Readonly<WorkspaceFirstStartActiveMigrationPlan> {
  return Object.freeze({
    appliedMigrationCount: entry.appliedMigrationCount,
    pendingMigrationCount: entry.pendingMigrationCount,
    status: entry.status,
    workspaceId: entry.workspaceId,
  });
}

function countsMatchStatus(
  status: WorkspaceMigrationInventoryStatus,
  appliedMigrationCount: number,
  pendingMigrationCount: number,
): boolean {
  if (status === 'current') return pendingMigrationCount === 0;
  if (status === 'compatiblePending') return pendingMigrationCount > 0;
  return appliedMigrationCount === 0 && pendingMigrationCount === 0;
}

function isMigrationStatus(
  value: unknown,
): value is WorkspaceMigrationInventoryStatus {
  return (
    value === 'current' ||
    value === 'compatiblePending' ||
    value === 'invalidHistory'
  );
}

function isMigrationCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPlannerInput(
  value: unknown,
): value is Record<(typeof inputKeys)[number], unknown> {
  if (!isPlainDataRecord(value)) return false;
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.some(
      (key) =>
        typeof key !== 'string' ||
        !inputKeys.some((candidate) => candidate === key),
    ) ||
    requiredInputKeys.some((key) => !ownKeys.includes(key))
  ) {
    return false;
  }
  return ownKeys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && 'value' in descriptor;
  });
}

function validateAdmission(value: unknown): asserts value is PreWorkspaceBuildAdmission {
  if (
    value !== 'authorizedNewerBuild' &&
    value !== 'coordinatedUpdateTarget' &&
    value !== 'development' &&
    value !== 'exactAcceptedBuild' &&
    value !== 'initialInstall'
  ) {
    invalidPlan();
  }
}

function compareWorkspaceIds(left: WorkspaceId, right: WorkspaceId): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function buildsAreEqual(
  left: Readonly<WorkspaceFirstStartBuildIdentity>,
  right: Readonly<WorkspaceFirstStartBuildIdentity>,
): boolean {
  return (
    left.appVersion === right.appVersion &&
    left.buildRevision === right.buildRevision
  );
}

function invalidPlan(): never {
  throw new WorkspaceFirstStartMigrationPlanError();
}
