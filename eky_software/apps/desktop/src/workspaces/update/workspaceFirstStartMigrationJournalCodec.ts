import { isSemVer } from '../../release/desktopBuildInfo.js';
import { compareSemanticVersions } from '../../update/semanticVersionComparison.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { validateWorkspaceTimestamp } from '../registry/workspaceTimestampValidation.js';
import {
  hasExactDataKeys,
  isPlainDataRecord,
} from '../registry/workspaceRegistryValueShape.js';
import { assertNoDuplicateWorkspaceFirstStartMigrationJournalKeys } from './workspaceFirstStartMigrationJournalDuplicateKeys.js';
import {
  WorkspaceFirstStartMigrationJournalValidationError,
  workspaceFirstStartMigrationJournalInvalid,
} from './workspaceFirstStartMigrationJournalError.js';
import type {
  WorkspaceFirstStartMigrationJournalState,
  WorkspaceFirstStartMigrationJournalV1,
} from './workspaceFirstStartMigrationJournalTypes.js';
import type { WorkspaceFirstStartBuildIdentity } from './workspaceFirstStartMigrationPlanTypes.js';

export const WORKSPACE_FIRST_START_MIGRATION_JOURNAL_MAX_BYTES = 16 * 1024;
export const WORKSPACE_FIRST_START_MIGRATION_MAX_PASSIVE_IDS = 63;

const journalKeys = [
  'formatVersion',
  'operationId',
  'state',
  'sourceBuild',
  'targetBuild',
  'activeWorkspaceId',
  'passiveRecoveryWorkspaceIds',
  'sourceRegistrySha256',
  'transitionedRegistrySha256',
  'createdAt',
  'updatedAt',
] as const;
const buildKeys = ['appVersion', 'buildRevision'] as const;
const operationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const revisionPattern = /^[0-9a-f]{7,40}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;

export function parseWorkspaceFirstStartMigrationJournalBytes(
  bytes: Uint8Array,
): Readonly<WorkspaceFirstStartMigrationJournalV1> {
  try {
    if (
      !(bytes instanceof Uint8Array) ||
      bytes.byteLength < 1 ||
      bytes.byteLength > WORKSPACE_FIRST_START_MIGRATION_JOURNAL_MAX_BYTES
    ) {
      return workspaceFirstStartMigrationJournalInvalid();
    }
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    assertNoDuplicateWorkspaceFirstStartMigrationJournalKeys(source);
    const value: unknown = JSON.parse(source);
    return validateWorkspaceFirstStartMigrationJournal(value);
  } catch (error) {
    if (error instanceof WorkspaceFirstStartMigrationJournalValidationError) {
      throw error;
    }
    return workspaceFirstStartMigrationJournalInvalid();
  }
}

export function validateWorkspaceFirstStartMigrationJournal(
  value: unknown,
): Readonly<WorkspaceFirstStartMigrationJournalV1> {
  try {
    if (
      !isPlainDataRecord(value) ||
      !hasExactDataKeys(value, journalKeys) ||
      value.formatVersion !== 1 ||
      !isJournalState(value.state) ||
      !Array.isArray(value.passiveRecoveryWorkspaceIds) ||
      value.passiveRecoveryWorkspaceIds.length >
        WORKSPACE_FIRST_START_MIGRATION_MAX_PASSIVE_IDS
    ) {
      return workspaceFirstStartMigrationJournalInvalid();
    }
    const sourceBuild = validateBuildIdentity(value.sourceBuild);
    const targetBuild = validateBuildIdentity(value.targetBuild);
    if (
      compareSemanticVersions(targetBuild.appVersion, sourceBuild.appVersion) <=
      0
    ) {
      return workspaceFirstStartMigrationJournalInvalid();
    }
    const operationId = validateOperationId(value.operationId);
    const activeWorkspaceId = validateWorkspaceId(value.activeWorkspaceId);
    const passiveRecoveryWorkspaceIds =
      value.passiveRecoveryWorkspaceIds.map(validateWorkspaceId);
    assertSortedUniquePassiveIds(
      passiveRecoveryWorkspaceIds,
      activeWorkspaceId,
    );
    const createdAt = validateWorkspaceTimestamp(value.createdAt);
    const updatedAt = validateWorkspaceTimestamp(value.updatedAt);
    if (Date.parse(updatedAt) < Date.parse(createdAt)) {
      return workspaceFirstStartMigrationJournalInvalid();
    }
    return Object.freeze({
      formatVersion: 1,
      operationId,
      state: value.state,
      sourceBuild,
      targetBuild,
      activeWorkspaceId,
      passiveRecoveryWorkspaceIds: Object.freeze(
        passiveRecoveryWorkspaceIds,
      ),
      sourceRegistrySha256: validateSha256(value.sourceRegistrySha256),
      transitionedRegistrySha256: validateSha256(
        value.transitionedRegistrySha256,
      ),
      createdAt,
      updatedAt,
    });
  } catch (error) {
    if (error instanceof WorkspaceFirstStartMigrationJournalValidationError) {
      throw error;
    }
    return workspaceFirstStartMigrationJournalInvalid();
  }
}

export function serializeWorkspaceFirstStartMigrationJournal(
  value: unknown,
): Uint8Array {
  const journal = validateWorkspaceFirstStartMigrationJournal(value);
  const canonical = {
    formatVersion: 1,
    operationId: journal.operationId,
    state: journal.state,
    sourceBuild: {
      appVersion: journal.sourceBuild.appVersion,
      buildRevision: journal.sourceBuild.buildRevision,
    },
    targetBuild: {
      appVersion: journal.targetBuild.appVersion,
      buildRevision: journal.targetBuild.buildRevision,
    },
    activeWorkspaceId: journal.activeWorkspaceId,
    passiveRecoveryWorkspaceIds: [...journal.passiveRecoveryWorkspaceIds],
    sourceRegistrySha256: journal.sourceRegistrySha256,
    transitionedRegistrySha256: journal.transitionedRegistrySha256,
    createdAt: journal.createdAt,
    updatedAt: journal.updatedAt,
  } as const;
  const bytes = new TextEncoder().encode(`${JSON.stringify(canonical)}\n`);
  if (
    bytes.byteLength > WORKSPACE_FIRST_START_MIGRATION_JOURNAL_MAX_BYTES
  ) {
    return workspaceFirstStartMigrationJournalInvalid();
  }
  return bytes;
}

export function assertWorkspaceFirstStartMigrationJournalTransition(
  current: Readonly<WorkspaceFirstStartMigrationJournalV1> | undefined,
  next: Readonly<WorkspaceFirstStartMigrationJournalV1>,
): void {
  if (current === undefined) {
    if (next.state !== 'prepared') {
      return workspaceFirstStartMigrationJournalInvalid();
    }
    return;
  }
  if (!journalIdentityMatches(current, next)) {
    return workspaceFirstStartMigrationJournalInvalid();
  }
  if (current.state === next.state) {
    if (!bytesAreEqual(
      serializeWorkspaceFirstStartMigrationJournal(current),
      serializeWorkspaceFirstStartMigrationJournal(next),
    )) {
      return workspaceFirstStartMigrationJournalInvalid();
    }
    return;
  }
  if (
    current.state !== 'prepared' ||
    next.state !== 'registryTransitioned' ||
    Date.parse(next.updatedAt) < Date.parse(current.updatedAt)
  ) {
    return workspaceFirstStartMigrationJournalInvalid();
  }
}

export function validateWorkspaceFirstStartBuildIdentity(
  value: unknown,
): Readonly<WorkspaceFirstStartBuildIdentity> {
  return validateBuildIdentity(value);
}

export function validateWorkspaceFirstStartMigrationSha256(
  value: unknown,
): string {
  return validateSha256(value);
}

function validateBuildIdentity(
  value: unknown,
): Readonly<WorkspaceFirstStartBuildIdentity> {
  if (
    !isPlainDataRecord(value) ||
    !hasExactDataKeys(value, buildKeys) ||
    typeof value.appVersion !== 'string' ||
    !isSemVer(value.appVersion) ||
    typeof value.buildRevision !== 'string' ||
    !revisionPattern.test(value.buildRevision)
  ) {
    return workspaceFirstStartMigrationJournalInvalid();
  }
  return Object.freeze({
    appVersion: value.appVersion,
    buildRevision: value.buildRevision,
  });
}

function validateOperationId(value: unknown): string {
  if (typeof value !== 'string' || !operationIdPattern.test(value)) {
    return workspaceFirstStartMigrationJournalInvalid();
  }
  return value;
}

function validateSha256(value: unknown): string {
  if (typeof value !== 'string' || !sha256Pattern.test(value)) {
    return workspaceFirstStartMigrationJournalInvalid();
  }
  return value;
}

function assertSortedUniquePassiveIds(
  workspaceIds: readonly string[],
  activeWorkspaceId: string,
): void {
  for (let index = 0; index < workspaceIds.length; index += 1) {
    const current = workspaceIds[index]!;
    if (
      current === activeWorkspaceId ||
      (index > 0 && workspaceIds[index - 1]! >= current)
    ) {
      return workspaceFirstStartMigrationJournalInvalid();
    }
  }
}

function isJournalState(
  value: unknown,
): value is WorkspaceFirstStartMigrationJournalState {
  return value === 'prepared' || value === 'registryTransitioned';
}

function journalIdentityMatches(
  current: Readonly<WorkspaceFirstStartMigrationJournalV1>,
  next: Readonly<WorkspaceFirstStartMigrationJournalV1>,
): boolean {
  return (
    current.operationId === next.operationId &&
    buildsAreEqual(current.sourceBuild, next.sourceBuild) &&
    buildsAreEqual(current.targetBuild, next.targetBuild) &&
    current.activeWorkspaceId === next.activeWorkspaceId &&
    arraysAreEqual(
      current.passiveRecoveryWorkspaceIds,
      next.passiveRecoveryWorkspaceIds,
    ) &&
    current.sourceRegistrySha256 === next.sourceRegistrySha256 &&
    current.transitionedRegistrySha256 ===
      next.transitionedRegistrySha256 &&
    current.createdAt === next.createdAt
  );
}

function buildsAreEqual(
  first: Readonly<WorkspaceFirstStartBuildIdentity>,
  second: Readonly<WorkspaceFirstStartBuildIdentity>,
): boolean {
  return (
    first.appVersion === second.appVersion &&
    first.buildRevision === second.buildRevision
  );
}

function arraysAreEqual(
  first: readonly string[],
  second: readonly string[],
): boolean {
  return (
    first.length === second.length &&
    first.every((value, index) => value === second[index])
  );
}

function bytesAreEqual(first: Uint8Array, second: Uint8Array): boolean {
  return (
    first.byteLength === second.byteLength &&
    first.every((value, index) => value === second[index])
  );
}
