const checkpoints = [
  'waitingForAppReady',
  'appReady',
  'compositionStarted',
  'workspaceResolutionStarted',
  'workspaceResolutionCompleted',
  'backendStartRequested',
  'backendReady',
  'firstWindowCreated',
  'compositionCompleted',
  'startupFailed',
] as const;

type StartupCheckpoint = (typeof checkpoints)[number];
const MAX_CHECKPOINTS = 16;

export interface ElectronE2eStartupObservation {
  readonly schemaVersion: 1;
  readonly checkpoints: readonly Readonly<{
    checkpoint: StartupCheckpoint;
    elapsedMs: number;
  }>[];
  readonly truncated: boolean;
}

// Test-only memory. No logger, filesystem, readiness signal or process owner.
export function createElectronE2eStartupObservation(
  now: () => number = () => performance.now(),
): {
  record(checkpoint: StartupCheckpoint): void;
  snapshot(): ElectronE2eStartupObservation;
} {
  const started = now();
  const observations: ElectronE2eStartupObservation['checkpoints'][number][] = [];
  let truncated = false;
  return {
    record(checkpoint) {
      if (observations.length === MAX_CHECKPOINTS) {
        truncated = true;
        return;
      }
      observations.push(Object.freeze({
        checkpoint,
        elapsedMs: Math.max(0, Math.floor(now() - started)),
      }));
    },
    snapshot: () => Object.freeze({
      schemaVersion: 1,
      checkpoints: Object.freeze([...observations]),
      truncated,
    }),
  };
}

export function parseElectronE2eStartupObservation(
  value: unknown,
): ElectronE2eStartupObservation | undefined {
  if (!isRecord(value) ||
      Object.keys(value).sort().join(',') !== 'checkpoints,schemaVersion,truncated' ||
      value.schemaVersion !== 1 || typeof value.truncated !== 'boolean' ||
      !Array.isArray(value.checkpoints) || value.checkpoints.length > MAX_CHECKPOINTS) {
    return undefined;
  }
  const observations: ElectronE2eStartupObservation['checkpoints'][number][] = [];
  for (const entry of value.checkpoints) {
    if (!isRecord(entry) ||
        Object.keys(entry).sort().join(',') !== 'checkpoint,elapsedMs' ||
        !checkpoints.includes(entry.checkpoint as StartupCheckpoint) ||
        typeof entry.elapsedMs !== 'number' ||
        !Number.isSafeInteger(entry.elapsedMs) || entry.elapsedMs < 0) {
      return undefined;
    }
    observations.push(Object.freeze({
      checkpoint: entry.checkpoint as StartupCheckpoint,
      elapsedMs: entry.elapsedMs,
    }));
  }
  return Object.freeze({
    schemaVersion: 1,
    checkpoints: Object.freeze(observations),
    truncated: value.truncated,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
