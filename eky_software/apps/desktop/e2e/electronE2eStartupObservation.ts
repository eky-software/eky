import {
  isElectronE2eBackendStartupStage,
  type ElectronE2eBackendStartupStage,
} from './electronE2eBackendStatus.js';

const checkpoints = [
  'waitingForAppReady',
  'appReady',
  'compositionStarted',
  'workspaceResolutionStarted',
  'workspaceResolutionCompleted',
  'backendStartRequested',
  'backendForkRequested',
  'backendForkReturned',
  'backendReadinessWaitStarted',
  'backendProcessSpawned',
  'backendStartMessageSent',
  'backendReadinessTimedOut',
  'backendReadyReceived',
  'backendReady',
  'firstWindowCreated',
  'compositionCompleted',
  'startupFailed',
] as const;

export type ElectronE2eStartupCheckpoint = (typeof checkpoints)[number];
const MAX_CHECKPOINTS = 16;

export type ElectronE2eBackendStartupObservation =
  | Readonly<{ status: 'unobserved' }>
  | Readonly<{
      status: 'observed';
      stage: ElectronE2eBackendStartupStage;
      elapsedMs: number;
    }>;

export interface ElectronE2eStartupObservation {
  readonly schemaVersion: 2;
  readonly backendStartup: ElectronE2eBackendStartupObservation;
  readonly checkpoints: readonly Readonly<{
    checkpoint: ElectronE2eStartupCheckpoint;
    elapsedMs: number;
  }>[];
  readonly truncated: boolean;
}

// Test-only memory. No logger, filesystem, readiness signal or process owner.
export function createElectronE2eStartupObservation(
  now: () => number = () => performance.now(),
): {
  record(checkpoint: ElectronE2eStartupCheckpoint): void;
  recordBackendStartupStage(stage: ElectronE2eBackendStartupStage): void;
  snapshot(): ElectronE2eStartupObservation;
} {
  const started = now();
  const observations: ElectronE2eStartupObservation['checkpoints'][number][] = [];
  let backendStartup: ElectronE2eBackendStartupObservation =
    Object.freeze({ status: 'unobserved' });
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
    recordBackendStartupStage(stage) {
      try {
        if (!isElectronE2eBackendStartupStage(stage)) return;
        const elapsedMs = Math.max(0, Math.floor(now() - started));
        if (!Number.isSafeInteger(elapsedMs)) return;
        backendStartup = Object.freeze({ status: 'observed', stage, elapsedMs });
      } catch {
        // A failed observation cannot change the backend startup path.
      }
    },
    snapshot: () => Object.freeze({
      schemaVersion: 2,
      backendStartup,
      checkpoints: Object.freeze([...observations]),
      truncated,
    }),
  };
}

export function parseElectronE2eStartupObservation(
  value: unknown,
): ElectronE2eStartupObservation | undefined {
  if (!isRecord(value) ||
      Object.keys(value).sort().join(',') !== 'backendStartup,checkpoints,schemaVersion,truncated' ||
      value.schemaVersion !== 2 || typeof value.truncated !== 'boolean' ||
      !Array.isArray(value.checkpoints) || value.checkpoints.length > MAX_CHECKPOINTS) {
    return undefined;
  }
  const observations: ElectronE2eStartupObservation['checkpoints'][number][] = [];
  const backendStartup = parseBackendStartupObservation(value.backendStartup);
  if (backendStartup === undefined) return undefined;
  for (const entry of value.checkpoints) {
    if (!isRecord(entry) ||
        Object.keys(entry).sort().join(',') !== 'checkpoint,elapsedMs' ||
        !checkpoints.includes(entry.checkpoint as ElectronE2eStartupCheckpoint) ||
        typeof entry.elapsedMs !== 'number' ||
        !Number.isSafeInteger(entry.elapsedMs) || entry.elapsedMs < 0) {
      return undefined;
    }
    observations.push(Object.freeze({
      checkpoint: entry.checkpoint as ElectronE2eStartupCheckpoint,
      elapsedMs: entry.elapsedMs,
    }));
  }
  return Object.freeze({
    schemaVersion: 2,
    backendStartup,
    checkpoints: Object.freeze(observations),
    truncated: value.truncated,
  });
}

function parseBackendStartupObservation(
  value: unknown,
): ElectronE2eBackendStartupObservation | undefined {
  if (!isRecord(value)) return undefined;
  const keys = Object.keys(value).sort().join(',');
  if (keys === 'status' && value.status === 'unobserved') {
    return Object.freeze({ status: 'unobserved' });
  }
  if (
    keys === 'elapsedMs,stage,status' &&
    value.status === 'observed' &&
    isElectronE2eBackendStartupStage(value.stage) &&
    typeof value.elapsedMs === 'number' &&
    Number.isSafeInteger(value.elapsedMs) && value.elapsedMs >= 0
  ) {
    return Object.freeze({
      status: 'observed', stage: value.stage, elapsedMs: value.elapsedMs,
    });
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
