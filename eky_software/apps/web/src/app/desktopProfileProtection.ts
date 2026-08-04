export interface ProfileBackupInspectionSummary {
  appVersion: string;
  compatibilityStatus: 'compatible';
  createdAt: string;
  databaseHealth: 'healthy';
  documentCount: number;
  formatVersion: 1;
  profileMatchStatus: 'different' | 'same';
  totalBusinessByteSize: number;
}

export interface ProfileProtectionStatus {
  portableBackup: {
    latestSuccessfulPortableBackupAt: string | null;
    operationState: 'creating' | 'idle' | 'inspecting';
  };
  recoveryPoints: {
    availability: 'available' | 'unavailable';
    budgetState:
      | 'protectedPointsExceedBudget'
      | 'withinBudget';
    latestValidatedGoodAt: string | null;
    nextAutomaticCheckAt: string | null;
    operationState: 'checking' | 'creating' | 'idle';
    pointCount: number;
  };
  restoreOperationState: 'idle' | 'ready' | 'restoring';
}

export type ProfileBackupInspectionResult =
  | { status: 'cancelled' }
  | {
      status: 'inspected';
      summary: ProfileBackupInspectionSummary;
    };

export interface ProfileProtectionCapability {
  activatePreparedRestore(): Promise<'cancelled' | 'relaunching'>;
  createBackup(): Promise<'cancelled' | 'created'>;
  createRecoveryPoint(): Promise<ProfileProtectionStatus>;
  getStatus(): Promise<ProfileProtectionStatus>;
  inspectBackup(): Promise<ProfileBackupInspectionResult>;
  prepareRestore(): Promise<ProfileBackupInspectionResult>;
}

interface ProfileProtectionDesktopApi {
  activatePreparedProfileRestore(): Promise<unknown>;
  createEncryptedProfileBackup(): Promise<unknown>;
  createManualRecoveryPoint(): Promise<unknown>;
  getProfileBackupStatus(): Promise<unknown>;
  inspectEncryptedProfileBackup(): Promise<unknown>;
  prepareEncryptedProfileRestore(): Promise<unknown>;
}

interface ProfileProtectionTarget {
  ekyDesktop?: ProfileProtectionDesktopApi;
}

export function getDesktopProfileProtection(
  target: ProfileProtectionTarget = window,
): ProfileProtectionCapability | undefined {
  const desktop = target.ekyDesktop;

  if (
    typeof desktop?.activatePreparedProfileRestore !== 'function' ||
    typeof desktop.createEncryptedProfileBackup !== 'function' ||
    typeof desktop.createManualRecoveryPoint !== 'function' ||
    typeof desktop.getProfileBackupStatus !== 'function' ||
    typeof desktop.inspectEncryptedProfileBackup !== 'function' ||
    typeof desktop.prepareEncryptedProfileRestore !== 'function'
  ) {
    return undefined;
  }

  return {
    async activatePreparedRestore() {
      return readActivationResult(
        await desktop.activatePreparedProfileRestore(),
      );
    },
    async createBackup() {
      return readCreateBackupResult(
        await desktop.createEncryptedProfileBackup(),
      );
    },
    async createRecoveryPoint() {
      return readProfileProtectionStatus(
        await desktop.createManualRecoveryPoint(),
      );
    },
    async getStatus() {
      return readProfileProtectionStatus(
        await desktop.getProfileBackupStatus(),
      );
    },
    async inspectBackup() {
      return readProfileBackupInspectionResult(
        await desktop.inspectEncryptedProfileBackup(),
      );
    },
    async prepareRestore() {
      return readProfileBackupInspectionResult(
        await desktop.prepareEncryptedProfileRestore(),
      );
    },
  };
}

function readProfileProtectionStatus(
  value: unknown,
): ProfileProtectionStatus {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'portableBackup',
      'recoveryPoints',
      'restoreOperationState',
    ]) ||
    !isRecord(value.portableBackup) ||
    !hasExactKeys(value.portableBackup, [
      'latestSuccessfulPortableBackupAt',
      'operationState',
    ]) ||
    !isTimestampOrNull(
      value.portableBackup.latestSuccessfulPortableBackupAt,
    ) ||
    !isOneOf(value.portableBackup.operationState, [
      'creating',
      'idle',
      'inspecting',
    ]) ||
    !isRecord(value.recoveryPoints) ||
    !hasExactKeys(value.recoveryPoints, [
      'availability',
      'budgetState',
      'latestValidatedGoodAt',
      'nextAutomaticCheckAt',
      'operationState',
      'pointCount',
    ]) ||
    !isOneOf(value.recoveryPoints.availability, [
      'available',
      'unavailable',
    ]) ||
    !isOneOf(value.recoveryPoints.budgetState, [
      'protectedPointsExceedBudget',
      'withinBudget',
    ]) ||
    !isTimestampOrNull(
      value.recoveryPoints.latestValidatedGoodAt,
    ) ||
    !isTimestampOrNull(
      value.recoveryPoints.nextAutomaticCheckAt,
    ) ||
    !isOneOf(value.recoveryPoints.operationState, [
      'checking',
      'creating',
      'idle',
    ]) ||
    !isNonNegativeSafeInteger(value.recoveryPoints.pointCount) ||
    !isOneOf(value.restoreOperationState, [
      'idle',
      'ready',
      'restoring',
    ])
  ) {
    throw new Error('Invalid profile protection status.');
  }

  return value as unknown as ProfileProtectionStatus;
}

function readProfileBackupInspectionResult(
  value: unknown,
): ProfileBackupInspectionResult {
  if (!isRecord(value)) {
    throw new Error('Invalid profile backup inspection result.');
  }
  if (
    hasExactKeys(value, ['status']) &&
    value.status === 'cancelled'
  ) {
    return { status: 'cancelled' };
  }
  if (
    !hasExactKeys(value, ['status', 'summary']) ||
    value.status !== 'inspected' ||
    !isProfileBackupInspectionSummary(value.summary)
  ) {
    throw new Error('Invalid profile backup inspection result.');
  }
  return {
    status: 'inspected',
    summary: value.summary,
  };
}

function isProfileBackupInspectionSummary(
  value: unknown,
): value is ProfileBackupInspectionSummary {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'appVersion',
      'compatibilityStatus',
      'createdAt',
      'databaseHealth',
      'documentCount',
      'formatVersion',
      'profileMatchStatus',
      'totalBusinessByteSize',
    ]) &&
    typeof value.appVersion === 'string' &&
    value.appVersion.length > 0 &&
    value.appVersion.length <= 100 &&
    value.compatibilityStatus === 'compatible' &&
    isTimestamp(value.createdAt) &&
    value.databaseHealth === 'healthy' &&
    isNonNegativeSafeInteger(value.documentCount) &&
    value.formatVersion === 1 &&
    isOneOf(value.profileMatchStatus, ['different', 'same']) &&
    isNonNegativeSafeInteger(value.totalBusinessByteSize)
  );
}

function readCreateBackupResult(
  value: unknown,
): 'cancelled' | 'created' {
  if (!isOneOf(value, ['cancelled', 'created'])) {
    throw new Error('Invalid profile backup creation result.');
  }
  return value;
}

function readActivationResult(
  value: unknown,
): 'cancelled' | 'relaunching' {
  if (!isOneOf(value, ['cancelled', 'relaunching'])) {
    throw new Error('Invalid profile restore activation result.');
  }
  return value;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function isTimestampOrNull(value: unknown): value is string | null {
  return value === null || isTimestamp(value);
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function isOneOf<const T extends readonly string[]>(
  value: unknown,
  values: T,
): value is T[number] {
  return (
    typeof value === 'string' &&
    values.includes(value as T[number])
  );
}
