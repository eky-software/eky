export const startupPhaseDiagnosticScenario = 'DESK-WORKSPACE-MANAGEMENT-001';
export const startupPhaseDiagnosticFile = 'desk-workspace-management-001-startup-phases.private.json';
export const startupPhaseDiagnosticMaxBytes = 4096;

const stages = [
  'waitingForAppReady', 'appReady',
  'workspaceResolutionStarted', 'workspaceResolutionCompleted',
  'backendStartMessageSent', 'boundaryValidation', 'brokerClientCreation',
  'moduleImport', 'backendStart',
  'migration.started.log.entered', 'migration.started.log.returned',
  'migration.manifestRead.entered', 'migration.manifestRead.returned',
  'migration.initialAttestation.entered', 'migration.initialAttestation.returned',
  'migration.historyPreparation.entered', 'migration.historyPreparation.returned',
  'migration.migrationExecution.entered', 'migration.migrationExecution.returned',
  'migration.finalAttestation.entered', 'migration.finalAttestation.returned',
  'migration.postRunInspection.entered', 'migration.postRunInspection.returned',
  'migration.identityRead.entered', 'migration.identityRead.returned',
  'migration.completed.log.entered', 'migration.completed.log.returned',
  'profileSnapshotBrokerStart', 'readyNotification', 'backendReadyReceived',
  'backendHealth.entered', 'backendHealth.returned', 'firstWindowCreated',
  'windowCreation.entered', 'windowCreation.returned',
] as const;
type Stage = (typeof stages)[number];
type Phase = Readonly<{ stage: Stage; elapsedMs: number }>;
export type StartupPhaseTiming = Readonly<{ schemaVersion: 1; phases: readonly Phase[] }>;

const isStage = (value: unknown): value is Stage =>
  typeof value === 'string' && stages.includes(value as Stage);
const validTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 180_000;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function createStartupPhaseTiming() {
  const phases = new Map<Stage, Phase>();
  let previousMs = 0;
  return {
    record(stage: string, elapsedMs: number): void {
      if (!isStage(stage) || !validTime(elapsedMs) || elapsedMs < previousMs || phases.has(stage)) return;
      phases.set(stage, Object.freeze({ stage, elapsedMs }));
      previousMs = elapsedMs;
    },
    snapshot(): StartupPhaseTiming | undefined {
      if (phases.size === 0) return undefined;
      return Object.freeze({ schemaVersion: 1, phases: Object.freeze([...phases.values()]) });
    },
  };
}

export function parseStartupPhaseTiming(value: unknown): StartupPhaseTiming | undefined {
  if (!record(value) || Object.keys(value).sort().join(',') !== 'phases,schemaVersion' ||
      value.schemaVersion !== 1 || !Array.isArray(value.phases) ||
      value.phases.length === 0 || value.phases.length > stages.length) return undefined;
  const timing = createStartupPhaseTiming();
  for (const phase of value.phases) {
    if (!record(phase) || Object.keys(phase).sort().join(',') !== 'elapsedMs,stage' ||
        !isStage(phase.stage) || !validTime(phase.elapsedMs)) return undefined;
    timing.record(phase.stage, phase.elapsedMs);
  }
  const snapshot = timing.snapshot();
  return snapshot?.phases.length === value.phases.length ? snapshot : undefined;
}
