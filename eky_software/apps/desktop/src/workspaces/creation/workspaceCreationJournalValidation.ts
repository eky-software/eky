import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { validateWorkspaceLabel } from '../registry/workspaceLabelValidation.js';
import { validateWorkspaceLineage } from '../registry/workspaceLineageValidation.js';
import { validateWorkspaceTimestamp } from '../registry/workspaceTimestampValidation.js';
import {
  hasExactDataKeys,
  isPlainDataRecord,
} from '../registry/workspaceRegistryValueShape.js';
import {
  WorkspaceCreationJournalValidationError,
  workspaceCreationJournalInvalid,
} from './workspaceCreationJournalError.js';
import { validateWorkspaceCreationOperationId } from './workspaceCreationOperationId.js';
import type {
  WorkspaceCreationJournalState,
  WorkspaceCreationJournalV1,
} from './workspaceCreationTypes.js';

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

export const WORKSPACE_CREATION_JOURNAL_STATES = Object.freeze([
  'prepared',
  'candidateRootCreated',
  'bootstrapCompleted',
  'candidateValidated',
  'rootPublished',
  'registryPublished',
] as const satisfies readonly WorkspaceCreationJournalState[]);

export function validateWorkspaceCreationJournal(
  value: unknown,
): Readonly<WorkspaceCreationJournalV1> {
  try {
    return validateWorkspaceCreationJournalValue(value);
  } catch (error) {
    if (error instanceof WorkspaceCreationJournalValidationError) throw error;
    return workspaceCreationJournalInvalid();
  }
}

function validateWorkspaceCreationJournalValue(
  value: unknown,
): Readonly<WorkspaceCreationJournalV1> {
  if (
    !isPlainDataRecord(value) ||
    !hasExactDataKeys(value, journalKeys) ||
    value.formatVersion !== 1 ||
    !isWorkspaceCreationJournalState(value.state)
  ) {
    return workspaceCreationJournalInvalid();
  }

  const lineageIdentity = value.lineageIdentity === null
    ? null
    : validateWorkspaceLineage(value.lineageIdentity);
  const stateIndex = getWorkspaceCreationStateIndex(value.state);
  const bootstrapStateIndex = getWorkspaceCreationStateIndex(
    'bootstrapCompleted',
  );
  if (
    (stateIndex < bootstrapStateIndex && lineageIdentity !== null) ||
    (stateIndex >= bootstrapStateIndex && lineageIdentity === null)
  ) {
    return workspaceCreationJournalInvalid();
  }

  return Object.freeze({
    formatVersion: 1,
    operationId: validateWorkspaceCreationOperationId(value.operationId),
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

export function assertWorkspaceCreationJournalTransition(
  current: Readonly<WorkspaceCreationJournalV1> | undefined,
  next: Readonly<WorkspaceCreationJournalV1>,
): void {
  if (current === undefined) {
    if (next.state !== 'prepared') {
      return workspaceCreationJournalInvalid();
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
    return workspaceCreationJournalInvalid();
  }

  const currentIndex = getWorkspaceCreationStateIndex(current.state);
  const nextIndex = getWorkspaceCreationStateIndex(next.state);
  if (nextIndex !== currentIndex && nextIndex !== currentIndex + 1) {
    return workspaceCreationJournalInvalid();
  }

  if (
    current.lineageIdentity !== null &&
    (next.lineageIdentity === null ||
      next.lineageIdentity.profileId !== current.lineageIdentity.profileId)
  ) {
    return workspaceCreationJournalInvalid();
  }
}

export function getWorkspaceCreationStateIndex(
  state: WorkspaceCreationJournalState,
): number {
  return WORKSPACE_CREATION_JOURNAL_STATES.indexOf(state);
}

function isWorkspaceCreationJournalState(
  value: unknown,
): value is WorkspaceCreationJournalState {
  return typeof value === 'string' &&
    WORKSPACE_CREATION_JOURNAL_STATES.includes(
      value as WorkspaceCreationJournalState,
    );
}
