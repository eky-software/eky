import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { validateWorkspaceLabel } from '../registry/workspaceLabelValidation.js';
import { validateWorkspaceLineage } from '../registry/workspaceLineageValidation.js';
import { validateWorkspaceTimestamp } from '../registry/workspaceTimestampValidation.js';
import {
  hasExactDataKeys,
  isPlainDataRecord,
} from '../registry/workspaceRegistryValueShape.js';
import {
  WorkspaceBackupImportJournalValidationError,
  workspaceBackupImportJournalInvalid,
} from './workspaceBackupImportJournalError.js';
import { validateWorkspaceBackupImportOperationId } from './workspaceBackupImportOperationId.js';
import type {
  WorkspaceBackupImportJournalState,
  WorkspaceBackupImportJournalV1,
} from './workspaceBackupImportTypes.js';

const journalKeys = [
  'formatVersion',
  'operationId',
  'workspaceId',
  'workspaceLabel',
  'previousActiveWorkspaceId',
  'state',
  'createdAt',
  'lineageIdentity',
] as const;

export const WORKSPACE_BACKUP_IMPORT_JOURNAL_STATES = Object.freeze([
  'prepared',
  'candidateRootCreated',
  'backupStaged',
  'candidateMigrated',
  'candidateValidated',
  'rootPublished',
  'registryPublished',
] as const satisfies readonly WorkspaceBackupImportJournalState[]);

export function validateWorkspaceBackupImportJournal(
  value: unknown,
): Readonly<WorkspaceBackupImportJournalV1> {
  try {
    return validateWorkspaceBackupImportJournalValue(value);
  } catch (error) {
    if (error instanceof WorkspaceBackupImportJournalValidationError) {
      throw error;
    }
    return workspaceBackupImportJournalInvalid();
  }
}

function validateWorkspaceBackupImportJournalValue(
  value: unknown,
): Readonly<WorkspaceBackupImportJournalV1> {
  if (
    !isPlainDataRecord(value) ||
    !hasExactDataKeys(value, journalKeys) ||
    value.formatVersion !== 1 ||
    !isWorkspaceBackupImportJournalState(value.state)
  ) {
    return workspaceBackupImportJournalInvalid();
  }

  const lineageIdentity = value.lineageIdentity === null
    ? null
    : validateWorkspaceLineage(value.lineageIdentity);
  const stateIndex = getWorkspaceBackupImportStateIndex(value.state);
  const validatedStateIndex = getWorkspaceBackupImportStateIndex(
    'candidateValidated',
  );
  if (
    (stateIndex < validatedStateIndex && lineageIdentity !== null) ||
    (stateIndex >= validatedStateIndex && lineageIdentity === null)
  ) {
    return workspaceBackupImportJournalInvalid();
  }

  return Object.freeze({
    formatVersion: 1,
    operationId: validateWorkspaceBackupImportOperationId(value.operationId),
    workspaceId: validateWorkspaceId(value.workspaceId),
    workspaceLabel: validateWorkspaceLabel(value.workspaceLabel),
    previousActiveWorkspaceId: value.previousActiveWorkspaceId === null
      ? null
      : validateWorkspaceId(value.previousActiveWorkspaceId),
    state: value.state,
    createdAt: validateWorkspaceTimestamp(value.createdAt),
    lineageIdentity,
  });
}

export function assertWorkspaceBackupImportJournalTransition(
  current: Readonly<WorkspaceBackupImportJournalV1> | undefined,
  next: Readonly<WorkspaceBackupImportJournalV1>,
): void {
  if (current === undefined) {
    if (next.state !== 'prepared') {
      return workspaceBackupImportJournalInvalid();
    }
    return;
  }

  if (
    current.operationId !== next.operationId ||
    current.workspaceId !== next.workspaceId ||
    current.workspaceLabel !== next.workspaceLabel ||
    current.previousActiveWorkspaceId !== next.previousActiveWorkspaceId ||
    current.createdAt !== next.createdAt
  ) {
    return workspaceBackupImportJournalInvalid();
  }

  const currentIndex = getWorkspaceBackupImportStateIndex(current.state);
  const nextIndex = getWorkspaceBackupImportStateIndex(next.state);
  if (nextIndex !== currentIndex && nextIndex !== currentIndex + 1) {
    return workspaceBackupImportJournalInvalid();
  }

  if (
    current.lineageIdentity !== null &&
    (next.lineageIdentity === null ||
      next.lineageIdentity.profileId !== current.lineageIdentity.profileId)
  ) {
    return workspaceBackupImportJournalInvalid();
  }
}

export function getWorkspaceBackupImportStateIndex(
  state: WorkspaceBackupImportJournalState,
): number {
  return WORKSPACE_BACKUP_IMPORT_JOURNAL_STATES.indexOf(state);
}

function isWorkspaceBackupImportJournalState(
  value: unknown,
): value is WorkspaceBackupImportJournalState {
  return typeof value === 'string' &&
    WORKSPACE_BACKUP_IMPORT_JOURNAL_STATES.includes(
      value as WorkspaceBackupImportJournalState,
    );
}
