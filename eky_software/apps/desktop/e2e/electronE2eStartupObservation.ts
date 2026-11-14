import {
  isElectronE2eBackendObservationStage,
  type ElectronE2eBackendObservationStage,
} from './electronE2eBackendStatus.js';
import { desktopStartupStagePhases, isDesktopStartupStage,
  type DesktopStartupSignal } from '../src/main/desktopStartupObservation.js';

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
      stage: ElectronE2eBackendObservationStage;
      elapsedMs: number;
    }>;

export interface ElectronE2eLegacyStartupObservation {
  readonly schemaVersion: 2;
  readonly backendStartup: ElectronE2eBackendStartupObservation;
  readonly checkpoints: readonly Readonly<{
    checkpoint: ElectronE2eStartupCheckpoint;
    elapsedMs: number;
  }>[];
  readonly truncated: boolean;
}

export type ElectronE2eMainStartupObservation =
  | Readonly<{ status: 'unobserved' }>
  | Readonly<DesktopStartupSignal & { status: 'observed'; elapsedMs: number }>;

export interface ElectronE2eCurrentStartupObservation extends Omit<ElectronE2eLegacyStartupObservation, 'schemaVersion'> {
  readonly schemaVersion: 3;
  readonly mainStartup: ElectronE2eMainStartupObservation;
}

export type ElectronE2eStartupObservation = ElectronE2eLegacyStartupObservation | ElectronE2eCurrentStartupObservation;

// Test-only memory. No logger, filesystem, readiness signal or process owner.
export function createElectronE2eStartupObservation(
  now: () => number = () => performance.now(),
): {
  record(checkpoint: ElectronE2eStartupCheckpoint): void;
  recordBackendStartupStage(stage: ElectronE2eBackendObservationStage): void;
  recordMainStartup(signal: DesktopStartupSignal): void;
  snapshot(): ElectronE2eCurrentStartupObservation;
} {
  const started = now();
  const observations: ElectronE2eStartupObservation['checkpoints'][number][] = [];
  let backendStartup: ElectronE2eBackendStartupObservation =
    Object.freeze({ status: 'unobserved' });
  let mainStartup: ElectronE2eMainStartupObservation = Object.freeze({ status: 'unobserved' });
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
        if (!isElectronE2eBackendObservationStage(stage)) return;
        const elapsedMs = Math.max(0, Math.floor(now() - started));
        if (!Number.isSafeInteger(elapsedMs)) return;
        backendStartup = Object.freeze({ status: 'observed', stage, elapsedMs });
      } catch {
        // A failed observation cannot change the backend startup path.
      }
    },
    recordMainStartup(signal) {
      try {
        if (!isMainStartupSignal(signal) || Object.keys(signal).sort().join(',') !== 'event,phase,stage') return;
        const elapsedMs = Math.max(0, Math.floor(now() - started));
        if (!Number.isSafeInteger(elapsedMs)) return;
        mainStartup = Object.freeze({ status: 'observed', stage: signal.stage,
          phase: signal.phase, event: signal.event, elapsedMs });
      } catch { /* Failed observations cannot change startup. */ }
    },
    snapshot: () => Object.freeze({
      schemaVersion: 3,
      backendStartup,
      mainStartup,
      checkpoints: Object.freeze([...observations]),
      truncated,
    }),
  };
}

export function parseElectronE2eStartupObservation(
  value: unknown,
): ElectronE2eStartupObservation | undefined {
  if (!isRecord(value) || (value.schemaVersion !== 2 && value.schemaVersion !== 3) ||
      Object.keys(value).sort().join(',') !== (value.schemaVersion === 2
        ? 'backendStartup,checkpoints,schemaVersion,truncated'
        : 'backendStartup,checkpoints,mainStartup,schemaVersion,truncated') ||
      typeof value.truncated !== 'boolean' ||
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
  const common = {
    backendStartup,
    checkpoints: Object.freeze(observations),
    truncated: value.truncated,
  };
  if (value.schemaVersion === 2) return Object.freeze({ schemaVersion: 2, ...common });
  const mainStartup = parseMainStartupObservation(value.mainStartup);
  if (mainStartup === undefined) return undefined;
  return Object.freeze({ schemaVersion: 3, ...common, mainStartup });
}

function isMainStartupSignal(value: unknown): value is DesktopStartupSignal & Record<string, unknown> {
  return isRecord(value) && isDesktopStartupStage(value.stage) &&
    value.phase === desktopStartupStagePhases[value.stage] &&
    (value.event === 'entered' || value.event === 'returned');
}

function parseMainStartupObservation(value: unknown): ElectronE2eMainStartupObservation | undefined {
  if (!isRecord(value)) return undefined;
  if (Object.keys(value).join(',') === 'status' && value.status === 'unobserved') {
    return Object.freeze({ status: 'unobserved' });
  }
  if (Object.keys(value).sort().join(',') !== 'elapsedMs,event,phase,stage,status' ||
      value.status !== 'observed' || !isMainStartupSignal(value) ||
      typeof value.elapsedMs !== 'number' || !Number.isSafeInteger(value.elapsedMs) || value.elapsedMs < 0) return undefined;
  return Object.freeze({ status: 'observed', stage: value.stage, phase: value.phase,
    event: value.event, elapsedMs: value.elapsedMs });
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
    isElectronE2eBackendObservationStage(value.stage) &&
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
