const journalFields = new Set([
  'candidatePackageIdentity',
  'correlationId',
  'createdAt',
  'currentPackageIdentity',
  'currentVersion',
  'formatVersion',
  'handoffAttemptCount',
  'preUpdateMigrationChainIdentity',
  'recoveryPointReference',
  'releaseChannel',
  'revision',
  'state',
  'targetVersion',
  'updatedAt',
]);
const packageIdentityFields = new Set([
  'buildRevision',
  'msiProductVersion',
  'packageSha256',
  'packageSize',
]);
const correlationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const recoveryPointReferencePattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const semVerPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[a-zA-Z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[a-zA-Z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const buildRevisionPattern = /^[0-9a-f]{7,40}$/;
const msiProductVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const sha256Pattern = /^[0-9a-f]{64}$/;

export const updateJournalStates = [
  'prepared',
  'recoveryPointValidated',
  'runtimeStopping',
  'awaitingFirstStart',
  'firstStartValidating',
  'installerNotApplied',
  'accepted',
  'rollbackRequired',
  'rolledBack',
  'failed',
  'failedSafe',
] as const;

export type UpdateJournalState = (typeof updateJournalStates)[number];

export interface UpdateJournalPackageIdentity {
  buildRevision: string;
  msiProductVersion: string;
  packageSha256: string;
  packageSize: number;
}

export interface UpdateJournal {
  candidatePackageIdentity: UpdateJournalPackageIdentity;
  correlationId: string;
  createdAt: string;
  currentPackageIdentity: UpdateJournalPackageIdentity;
  currentVersion: string;
  formatVersion: 1;
  handoffAttemptCount: 0 | 1;
  preUpdateMigrationChainIdentity?: string;
  recoveryPointReference?: string;
  releaseChannel: 'pilot';
  revision: number;
  state: UpdateJournalState;
  targetVersion: string;
  updatedAt: string;
}

export class UpdateJournalValidationError extends Error {
  constructor() {
    super('The local update journal is invalid.');
    this.name = 'UpdateJournalValidationError';
  }
}

export function parseUpdateJournal(value: unknown): Readonly<UpdateJournal> {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !journalFields.has(key)) ||
    value.formatVersion !== 1 ||
    typeof value.correlationId !== 'string' ||
    !correlationIdPattern.test(value.correlationId) ||
    typeof value.currentVersion !== 'string' ||
    !semVerPattern.test(value.currentVersion) ||
    typeof value.targetVersion !== 'string' ||
    !semVerPattern.test(value.targetVersion) ||
    value.currentVersion === value.targetVersion ||
    value.releaseChannel !== 'pilot' ||
    !isUpdateJournalState(value.state) ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 1 ||
    (value.handoffAttemptCount !== 0 && value.handoffAttemptCount !== 1) ||
    typeof value.createdAt !== 'string' ||
    !isUtcTimestamp(value.createdAt) ||
    typeof value.updatedAt !== 'string' ||
    !isUtcTimestamp(value.updatedAt) ||
    Date.parse(value.updatedAt) < Date.parse(value.createdAt) ||
    !isPackageIdentity(value.currentPackageIdentity) ||
    !isPackageIdentity(value.candidatePackageIdentity)
  ) {
    throw new UpdateJournalValidationError();
  }

  const recoveryPointRequired = recoveryPointRequiredStates.has(value.state);
  if (
    (value.preUpdateMigrationChainIdentity !== undefined &&
      (typeof value.preUpdateMigrationChainIdentity !== 'string' ||
        !sha256Pattern.test(value.preUpdateMigrationChainIdentity))) ||
    (value.state === 'installerNotApplied' &&
      value.preUpdateMigrationChainIdentity === undefined) ||
    (value.recoveryPointReference !== undefined &&
      (typeof value.recoveryPointReference !== 'string' ||
        !recoveryPointReferencePattern.test(value.recoveryPointReference))) ||
    (recoveryPointRequired && value.recoveryPointReference === undefined) ||
    (value.state === 'prepared' && value.handoffAttemptCount !== 0) ||
    (value.state === 'recoveryPointValidated' &&
      value.handoffAttemptCount !== 0) ||
    (value.state === 'runtimeStopping' && value.handoffAttemptCount !== 0) ||
    ((value.state === 'awaitingFirstStart' ||
      value.state === 'firstStartValidating' ||
      value.state === 'accepted' ||
      value.state === 'installerNotApplied' ||
      value.state === 'rollbackRequired' ||
      value.state === 'rolledBack') &&
      value.handoffAttemptCount !== 1)
  ) {
    throw new UpdateJournalValidationError();
  }

  return Object.freeze({
    candidatePackageIdentity: freezeIdentity(value.candidatePackageIdentity),
    correlationId: value.correlationId,
    createdAt: value.createdAt,
    currentPackageIdentity: freezeIdentity(value.currentPackageIdentity),
    currentVersion: value.currentVersion,
    formatVersion: 1,
    handoffAttemptCount: value.handoffAttemptCount,
    ...(value.preUpdateMigrationChainIdentity === undefined
      ? {}
      : {
          preUpdateMigrationChainIdentity:
            value.preUpdateMigrationChainIdentity,
        }),
    ...(value.recoveryPointReference === undefined
      ? {}
      : { recoveryPointReference: value.recoveryPointReference }),
    releaseChannel: 'pilot',
    revision: value.revision as number,
    state: value.state,
    targetVersion: value.targetVersion,
    updatedAt: value.updatedAt,
  });
}

const allowedTransitions: Readonly<
  Record<UpdateJournalState, ReadonlySet<UpdateJournalState>>
> = {
  accepted: new Set(['accepted']),
  awaitingFirstStart: new Set([
    'awaitingFirstStart',
    'failed',
    'firstStartValidating',
    'installerNotApplied',
    'failedSafe',
    'rollbackRequired',
  ]),
  failed: new Set(['failed', 'failedSafe', 'installerNotApplied']),
  failedSafe: new Set(['failedSafe']),
  firstStartValidating: new Set([
    'accepted',
    'failed',
    'firstStartValidating',
    'rollbackRequired',
  ]),
  prepared: new Set(['failed', 'prepared', 'recoveryPointValidated']),
  recoveryPointValidated: new Set([
    'failed',
    'recoveryPointValidated',
    'runtimeStopping',
  ]),
  rolledBack: new Set(['rolledBack']),
  installerNotApplied: new Set(['installerNotApplied']),
  rollbackRequired: new Set(['failed', 'rolledBack', 'rollbackRequired']),
  runtimeStopping: new Set([
    'awaitingFirstStart',
    'failed',
    'failedSafe',
    'installerNotApplied',
    'rollbackRequired',
    'runtimeStopping',
  ]),
};

const recoveryPointRequiredStates: ReadonlySet<UpdateJournalState> = new Set([
  'recoveryPointValidated',
  'runtimeStopping',
  'awaitingFirstStart',
  'firstStartValidating',
  'accepted',
  'installerNotApplied',
  'rollbackRequired',
  'rolledBack',
]);

export function transitionUpdateJournal(
  current: Readonly<UpdateJournal>,
  input: {
    at: string;
    handoffAttemptCount?: 0 | 1;
    recoveryPointReference?: string;
    state: UpdateJournalState;
  },
): Readonly<UpdateJournal> {
  if (!allowedTransitions[current.state].has(input.state)) {
    throw new UpdateJournalValidationError();
  }
  return parseUpdateJournal({
    ...current,
    ...(input.handoffAttemptCount === undefined
      ? {}
      : { handoffAttemptCount: input.handoffAttemptCount }),
    ...(input.recoveryPointReference === undefined
      ? {}
      : { recoveryPointReference: input.recoveryPointReference }),
    revision:
      input.state === current.state ? current.revision : current.revision + 1,
    state: input.state,
    updatedAt: input.at,
  });
}

function isPackageIdentity(value: unknown): value is UpdateJournalPackageIdentity {
  return (
    isRecord(value) &&
    Object.keys(value).length === packageIdentityFields.size &&
    Object.keys(value).every((key) => packageIdentityFields.has(key)) &&
    typeof value.buildRevision === 'string' &&
    buildRevisionPattern.test(value.buildRevision) &&
    typeof value.msiProductVersion === 'string' &&
    isMsiProductVersion(value.msiProductVersion) &&
    typeof value.packageSha256 === 'string' &&
    sha256Pattern.test(value.packageSha256) &&
    Number.isSafeInteger(value.packageSize) &&
    (value.packageSize as number) > 0
  );
}

function freezeIdentity(value: UpdateJournalPackageIdentity): UpdateJournalPackageIdentity {
  return Object.freeze({ ...value });
}

function isUpdateJournalState(value: unknown): value is UpdateJournalState {
  return typeof value === 'string' &&
    (updateJournalStates as readonly string[]).includes(value);
}

function isMsiProductVersion(value: string): boolean {
  const match = msiProductVersionPattern.exec(value);
  return match !== null && Number(match[1]) <= 255 &&
    Number(match[2]) <= 255 && Number(match[3]) <= 65_535;
}

function isUtcTimestamp(value: string): boolean {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
