export const profileRestoreActivationJournalFormatVersion = 1;

export const profileRestoreForwardActivationPhases = [
  'prepared',
  'movingCurrentDatabase',
  'currentDatabaseMoved',
  'movingCurrentDocuments',
  'currentDocumentsMoved',
  'activatingStagedDatabase',
  'stagedDatabaseActivated',
  'activatingStagedDocuments',
  'stagedDocumentsActivated',
  'validationStarting',
] as const;

export const profileRestoreActivationPhases = [
  ...profileRestoreForwardActivationPhases,
  'accepted',
  'rollbackStarting',
  'rolledBack',
  'failedSafe',
] as const;

export type ProfileRestoreActivationPhase =
  (typeof profileRestoreActivationPhases)[number];

export interface ProfileRestoreActivationJournal {
  formatVersion: typeof profileRestoreActivationJournalFormatVersion;
  hadActiveDatabase: boolean;
  hadActiveDocuments: boolean;
  operationId: string;
  phase: ProfileRestoreActivationPhase;
  revision: number;
}

const operationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const phaseSet = new Set<string>(profileRestoreActivationPhases);

export function parseProfileRestoreActivationJournal(
  value: unknown,
): ProfileRestoreActivationJournal | undefined {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'formatVersion',
      'hadActiveDatabase',
      'hadActiveDocuments',
      'operationId',
      'phase',
      'revision',
    ]) ||
    value.formatVersion !==
      profileRestoreActivationJournalFormatVersion ||
    typeof value.hadActiveDatabase !== 'boolean' ||
    typeof value.hadActiveDocuments !== 'boolean' ||
    typeof value.operationId !== 'string' ||
    !operationIdPattern.test(value.operationId) ||
    typeof value.phase !== 'string' ||
    !phaseSet.has(value.phase) ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0
  ) {
    return undefined;
  }

  return value as unknown as ProfileRestoreActivationJournal;
}

export function captureProfileRestoreActivationJournal(
  value: unknown,
): Readonly<ProfileRestoreActivationJournal> {
  const parsed = parseProfileRestoreActivationJournal(value);
  if (parsed === undefined) {
    throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
  }
  return Object.freeze({ ...parsed });
}

export function assertProfileRestoreActivationJournalMatches(
  expected: Readonly<ProfileRestoreActivationJournal>,
  value: unknown,
): void {
  const current = parseProfileRestoreActivationJournal(value);
  if (
    current === undefined ||
    current.formatVersion !== expected.formatVersion ||
    current.operationId !== expected.operationId ||
    current.phase !== expected.phase ||
    current.revision !== expected.revision ||
    current.hadActiveDatabase !== expected.hadActiveDatabase ||
    current.hadActiveDocuments !== expected.hadActiveDocuments
  ) {
    throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
  }
}

export function captureProfileRestoreForwardProgress(
  previous: Readonly<ProfileRestoreActivationJournal>,
  value: unknown,
): Readonly<ProfileRestoreActivationJournal> {
  const advanced = captureProfileRestoreActivationJournal(value);
  const phases: readonly string[] = profileRestoreForwardActivationPhases;
  const previousIndex = phases.indexOf(previous.phase);
  const currentIndex = phases.indexOf(advanced.phase);
  if (previousIndex < 0 || currentIndex < previousIndex) {
    throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
  }
  assertProfileRestoreActivationJournalMatches({
    ...previous,
    phase: advanced.phase,
    revision: previous.revision + currentIndex - previousIndex,
  }, advanced);
  return advanced;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  return (
    actualKeys.length === sortedExpectedKeys.length &&
    actualKeys.every((key, index) => key === sortedExpectedKeys[index])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}
