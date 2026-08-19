export const electronE2eBackendStartupStages = [
  'boundaryValidation',
  'brokerClientCreation',
  'moduleImport',
  'backendStart',
  'profileSnapshotBrokerStart',
  'readyNotification',
] as const;

export type ElectronE2eBackendStartupStage =
  (typeof electronE2eBackendStartupStages)[number];

export type ElectronE2eBackendStatus =
  | {
      port: number;
      type: 'ready';
    }
  | {
      stage: ElectronE2eBackendStartupStage;
      type: 'failed';
    };

const failureCodeByStage: Record<
  ElectronE2eBackendStartupStage,
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
    isElectronE2eBackendStartupStage(record.stage)
  ) {
    return { stage: record.stage, type: 'failed' };
  }
  return undefined;
}

export function readElectronE2eBackendFailureCode(
  stage: ElectronE2eBackendStartupStage,
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

function isElectronE2eBackendStartupStage(
  value: unknown,
): value is ElectronE2eBackendStartupStage {
  return (
    typeof value === 'string' &&
    electronE2eBackendStartupStages.some((stage) => stage === value)
  );
}
