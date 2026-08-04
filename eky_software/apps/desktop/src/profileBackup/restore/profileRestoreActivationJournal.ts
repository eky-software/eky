export const profileRestoreActivationJournalFormatVersion = 1;

export const profileRestoreActivationPhases = [
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
