const recordFields = new Set([
  'appliedMigrationCount',
  'attemptCount',
  'correlationId',
  'createdAt',
  'formatVersion',
  'migrationPrefixIdentity',
  'previousAcceptedBuildIdentity',
  'recoveryPointReference',
  'revision',
  'runningTargetBuildIdentity',
  'state',
  'updatedAt',
]);
const buildIdentityFields = new Set(['appVersion', 'buildRevision']);
const correlationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const recoveryPointReferencePattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const semVerPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[a-zA-Z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[a-zA-Z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const buildRevisionPattern = /^[0-9a-f]{7,40}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;

export const directSetupMigrationRecoveryStates = [
  'prepared',
  'migrationRunning',
  'recoveryRequired',
  'businessRollbackStarting',
  'awaitingPreviousBuild',
  'accepted',
  'failedSafe',
] as const;

export type DirectSetupMigrationRecoveryState =
  (typeof directSetupMigrationRecoveryStates)[number];

export interface DirectSetupBuildIdentity {
  appVersion: string;
  buildRevision: string;
}

export interface DirectSetupMigrationRecovery {
  appliedMigrationCount: number;
  attemptCount: number;
  correlationId: string;
  createdAt: string;
  formatVersion: 1;
  migrationPrefixIdentity: string;
  previousAcceptedBuildIdentity: DirectSetupBuildIdentity;
  recoveryPointReference: string;
  revision: number;
  runningTargetBuildIdentity: DirectSetupBuildIdentity;
  state: DirectSetupMigrationRecoveryState;
  updatedAt: string;
}

export function createDirectSetupMigrationRecovery(input: {
  appliedMigrationCount: number;
  at: string;
  correlationId: string;
  migrationPrefixIdentity: string;
  previousAcceptedBuildIdentity: DirectSetupBuildIdentity;
  recoveryPointReference: string;
  runningTargetBuildIdentity: DirectSetupBuildIdentity;
}): Readonly<DirectSetupMigrationRecovery> {
  return parseDirectSetupMigrationRecovery({
    appliedMigrationCount: input.appliedMigrationCount,
    attemptCount: 1,
    correlationId: input.correlationId,
    createdAt: input.at,
    formatVersion: 1,
    migrationPrefixIdentity: input.migrationPrefixIdentity,
    previousAcceptedBuildIdentity: input.previousAcceptedBuildIdentity,
    recoveryPointReference: input.recoveryPointReference,
    revision: 1,
    runningTargetBuildIdentity: input.runningTargetBuildIdentity,
    state: 'prepared',
    updatedAt: input.at,
  });
}

export class DirectSetupMigrationRecoveryValidationError extends Error {
  constructor() {
    super('The direct Setup migration recovery record is invalid.');
    this.name = 'DirectSetupMigrationRecoveryValidationError';
  }
}

export function parseDirectSetupMigrationRecovery(
  value: unknown,
): Readonly<DirectSetupMigrationRecovery> {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== recordFields.size ||
    Object.keys(value).some((key) => !recordFields.has(key)) ||
    value.formatVersion !== 1 ||
    typeof value.correlationId !== 'string' ||
    !correlationIdPattern.test(value.correlationId) ||
    !isBuildIdentity(value.previousAcceptedBuildIdentity) ||
    !isBuildIdentity(value.runningTargetBuildIdentity) ||
    value.previousAcceptedBuildIdentity.appVersion ===
      value.runningTargetBuildIdentity.appVersion ||
    typeof value.recoveryPointReference !== 'string' ||
    !recoveryPointReferencePattern.test(value.recoveryPointReference) ||
    typeof value.migrationPrefixIdentity !== 'string' ||
    !sha256Pattern.test(value.migrationPrefixIdentity) ||
    !Number.isSafeInteger(value.appliedMigrationCount) ||
    (value.appliedMigrationCount as number) < 1 ||
    !Number.isSafeInteger(value.attemptCount) ||
    (value.attemptCount as number) < 1 ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 1 ||
    !isState(value.state) ||
    typeof value.createdAt !== 'string' ||
    !isUtcTimestamp(value.createdAt) ||
    typeof value.updatedAt !== 'string' ||
    !isUtcTimestamp(value.updatedAt) ||
    Date.parse(value.updatedAt) < Date.parse(value.createdAt)
  ) {
    throw new DirectSetupMigrationRecoveryValidationError();
  }

  return Object.freeze({
    appliedMigrationCount: value.appliedMigrationCount as number,
    attemptCount: value.attemptCount as number,
    correlationId: value.correlationId,
    createdAt: value.createdAt,
    formatVersion: 1,
    migrationPrefixIdentity: value.migrationPrefixIdentity,
    previousAcceptedBuildIdentity: freezeIdentity(
      value.previousAcceptedBuildIdentity,
    ),
    recoveryPointReference: value.recoveryPointReference,
    revision: value.revision as number,
    runningTargetBuildIdentity: freezeIdentity(
      value.runningTargetBuildIdentity,
    ),
    state: value.state,
    updatedAt: value.updatedAt,
  });
}

const transitions: Readonly<
  Record<
    DirectSetupMigrationRecoveryState,
    ReadonlySet<DirectSetupMigrationRecoveryState>
  >
> = {
  accepted: new Set(['accepted']),
  awaitingPreviousBuild: new Set([
    'accepted',
    'awaitingPreviousBuild',
    'failedSafe',
  ]),
  businessRollbackStarting: new Set([
    'awaitingPreviousBuild',
    'businessRollbackStarting',
    'failedSafe',
    'recoveryRequired',
  ]),
  failedSafe: new Set(['failedSafe']),
  migrationRunning: new Set([
    'accepted',
    'failedSafe',
    'migrationRunning',
    'recoveryRequired',
  ]),
  prepared: new Set([
    'failedSafe',
    'migrationRunning',
    'prepared',
    'recoveryRequired',
  ]),
  recoveryRequired: new Set([
    'businessRollbackStarting',
    'failedSafe',
    'recoveryRequired',
  ]),
};

export function transitionDirectSetupMigrationRecovery(
  current: Readonly<DirectSetupMigrationRecovery>,
  input: {
    at: string;
    attemptCount?: number;
    state: DirectSetupMigrationRecoveryState;
  },
): Readonly<DirectSetupMigrationRecovery> {
  if (!transitions[current.state].has(input.state)) {
    throw new DirectSetupMigrationRecoveryValidationError();
  }
  return parseDirectSetupMigrationRecovery({
    ...current,
    ...(input.attemptCount === undefined
      ? {}
      : { attemptCount: input.attemptCount }),
    revision: current.revision + 1,
    state: input.state,
    updatedAt: input.at,
  });
}

function isBuildIdentity(value: unknown): value is DirectSetupBuildIdentity {
  return (
    isRecord(value) &&
    Object.keys(value).length === buildIdentityFields.size &&
    Object.keys(value).every((key) => buildIdentityFields.has(key)) &&
    typeof value.appVersion === 'string' &&
    semVerPattern.test(value.appVersion) &&
    typeof value.buildRevision === 'string' &&
    buildRevisionPattern.test(value.buildRevision)
  );
}

function freezeIdentity(value: DirectSetupBuildIdentity): DirectSetupBuildIdentity {
  return Object.freeze({ ...value });
}

function isState(value: unknown): value is DirectSetupMigrationRecoveryState {
  return (
    typeof value === 'string' &&
    (directSetupMigrationRecoveryStates as readonly string[]).includes(value)
  );
}

function isUtcTimestamp(value: string): boolean {
  const milliseconds = Date.parse(value);
  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
