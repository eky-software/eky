export const electronE2eBackendStartupStages = [
  'boundaryValidation',
  'brokerClientCreation',
  'moduleImport',
  'backendStart',
  'profileSnapshotBrokerStart',
  'readyNotification',
] as const;

export type ElectronE2eBackendFailureStage =
  (typeof electronE2eBackendStartupStages)[number];

export const electronE2eBackendLogStages = [
  'migration.started.log.entered',
  'migration.started.log.returned',
  'migration.started.log.threw',
  'migration.completed.log.entered',
  'migration.completed.log.returned',
  'migration.completed.log.threw',
  'migration.failed.log.entered',
  'migration.failed.log.returned',
  'migration.failed.log.threw',
] as const;

export type ElectronE2eBackendLogStage = (typeof electronE2eBackendLogStages)[number];
export type ElectronE2eBackendObservationStage =
  | ElectronE2eBackendFailureStage
  | ElectronE2eBackendLogStage;

// The controller's existing startup callback carries observation-only stages too.
export type ElectronE2eBackendStartupStage = ElectronE2eBackendObservationStage;

export interface ElectronE2eBackendProgress {
  readonly type: 'progress';
  readonly stage: ElectronE2eBackendObservationStage;
}

export type ElectronE2eBackendStatus =
  | {
      port: number;
      type: 'ready';
    }
  | {
      stage: ElectronE2eBackendFailureStage;
      type: 'failed';
    };

const failureCodeByStage: Record<
  ElectronE2eBackendFailureStage,
  `DESKTOP_SMOKE_E2E_BACKEND_${string}_FAILED`
> = {
  backendStart: 'DESKTOP_SMOKE_E2E_BACKEND_START_FAILED',
  boundaryValidation:
    'DESKTOP_SMOKE_E2E_BACKEND_BOUNDARY_VALIDATION_FAILED',
  brokerClientCreation:
    'DESKTOP_SMOKE_E2E_BACKEND_BROKER_CLIENT_CREATION_FAILED',
  moduleImport: 'DESKTOP_SMOKE_E2E_BACKEND_MODULE_IMPORT_FAILED',
  profileSnapshotBrokerStart:
    'DESKTOP_SMOKE_E2E_BACKEND_PROFILE_SNAPSHOT_BROKER_START_FAILED',
  readyNotification:
    'DESKTOP_SMOKE_E2E_BACKEND_READY_NOTIFICATION_FAILED',
};

export function parseElectronE2eBackendProgress(
  value: unknown,
): ElectronE2eBackendProgress | undefined {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return undefined;
    }
    const record = value as Record<string, unknown>;
    if (
      record.type === 'progress' &&
      hasExactlyKeys(record, ['stage', 'type']) &&
      isElectronE2eBackendObservationStage(record.stage)
    ) {
      return Object.freeze({ stage: record.stage, type: 'progress' });
    }
  } catch {
    // Unreadable optional evidence is not a backend outcome.
  }
  return undefined;
}

export function reportElectronE2eBackendProgress(
  stage: ElectronE2eBackendObservationStage,
  send: (progress: ElectronE2eBackendProgress) => void,
): void {
  try {
    if (isElectronE2eBackendObservationStage(stage)) {
      send(Object.freeze({ stage, type: 'progress' }));
    }
  } catch {
    // A progress-channel failure must not change startup or its failure stage.
  }
}

export function parseElectronE2eBackendStatus(
  value: unknown,
): ElectronE2eBackendStatus | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (
    record.type === 'ready' &&
    hasExactlyKeys(record, ['port', 'type']) &&
    typeof record.port === 'number' &&
    Number.isSafeInteger(record.port)
  ) {
    return { port: record.port, type: 'ready' };
  }
  if (
    record.type === 'failed' &&
    hasExactlyKeys(record, ['stage', 'type']) &&
    isElectronE2eBackendFailureStage(record.stage)
  ) {
    return { stage: record.stage, type: 'failed' };
  }
  return undefined;
}

export function readElectronE2eBackendFailureCode(
  stage: ElectronE2eBackendFailureStage,
): `DESKTOP_SMOKE_E2E_BACKEND_${string}_FAILED` {
  return failureCodeByStage[stage];
}

function hasExactlyKeys(
  record: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Object.keys(record).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  return (
    actualKeys.length === sortedExpectedKeys.length &&
    actualKeys.every((key, index) => key === sortedExpectedKeys[index])
  );
}

export function isElectronE2eBackendFailureStage(
  value: unknown,
): value is ElectronE2eBackendFailureStage {
  return (
    typeof value === 'string' &&
    electronE2eBackendStartupStages.some((stage) => stage === value)
  );
}

export function isElectronE2eBackendObservationStage(
  value: unknown,
): value is ElectronE2eBackendObservationStage {
  return isElectronE2eBackendFailureStage(value) || (
    typeof value === 'string' &&
    electronE2eBackendLogStages.some((stage) => stage === value)
  );
}
