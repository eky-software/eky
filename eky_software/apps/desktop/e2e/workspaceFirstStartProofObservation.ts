import { closeSync, lstatSync, openSync, realpathSync, writeSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { firstStartLoadPhases } from './workspaceFirstStartLoadObservation.js';

const observationFilePrefix = 'first-start-proof';
export const MAX_FIRST_START_PROOF_OBSERVATIONS = 128;
export const MAX_FIRST_START_PROOF_OBSERVATION_BYTES = 16_384;

const proofStages = [
  'setup', 'mixedActiveFixture', 'mixedCompatibleFixture', 'mixedInvalidFixture',
  'mixedStores', 'mixedSnapshotsBefore', 'mixedStartup', 'mixedRuntimeReadback',
  'mixedShutdown', 'mixedActiveInspection', 'mixedCompatibleInspection',
  'mixedInvalidInspection', 'mixedSnapshotsAfter', 'mixedRestart', 'mixedComplete',
  'allCurrentFixtures', 'allCurrentStores', 'allCurrentSnapshotsBefore',
  'allCurrentStartup', 'allCurrentRuntimeReadback', 'allCurrentShutdown',
  'allCurrentSnapshotsAfter', 'allCurrentRestart', 'allCurrentComplete', 'cleanup',
] as const;
const phases = [
  ...proofStages,
  ...firstStartLoadPhases,
  'initialShutdownStarted', 'initialShutdownCompleted', 'proofStarted',
  'proofCompleted', 'proofFailed', 'proofFinallyStarted', 'proofFinallyReturned',
  'lifecycleShutdownCompleted', 'windowCleanupDeferred', 'protocolUnregistered',
  'loadExperimentCleanupFailed', 'shutdownCleanupFailed',
  'observationsTruncated',
] as const;

export type FirstStartProofStage = (typeof proofStages)[number];
export type FirstStartProofPhase = (typeof phases)[number];
export interface FirstStartProofObservation {
  readonly schemaVersion: 1;
  readonly phase: FirstStartProofPhase;
  readonly elapsedMs: number;
}
export type FirstStartProofCapture =
  | Readonly<{ status: 'notRequested' | 'missing' | 'invalid' | 'tooLarge' | 'readFailed' }>
  | Readonly<{
      status: 'captured' | 'partial';
      observations: readonly FirstStartProofObservation[];
      truncated: boolean;
    }>;

export function firstStartProofObservationPath(userDataRoot: string, runtimeInstanceId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(runtimeInstanceId)) {
    throw new Error('E2E_FIRST_START_OBSERVATION_ID_INVALID');
  }
  const comparable = (path: string) => process.platform === 'win32' ? path.toLowerCase() : path;
  if (!isAbsolute(userDataRoot) || !lstatSync(userDataRoot).isDirectory() ||
      comparable(realpathSync(userDataRoot)) !== comparable(resolve(userDataRoot))) {
    throw new Error('E2E_FIRST_START_OBSERVATION_ROOT_INVALID');
  }
  return join(userDataRoot, `${observationFilePrefix}-${runtimeInstanceId}.jsonl`);
}

// One journal describes the sole admitted first-start proof in this runtime.
// Reserve before the first await, including when that invocation later fails.
export function createFirstStartProofAdmission(): () => void {
  let admitted = false;
  return () => {
    if (admitted) throw new Error('E2E_FIRST_START_PROOF_ALREADY_REQUESTED');
    admitted = true;
  };
}

// The caller supplies the already guarded E2E userData root. This file lives
// outside the proof's disposable w6-* subtree, never in a production profile.
export function createFirstStartProofObserver(
  userDataRoot: string,
  runtimeInstanceId: string,
  now: () => number = () => performance.now(),
  write: (descriptor: number, line: Uint8Array) => number = writeSync,
): { record(phase: FirstStartProofPhase): void; close(): void } {
  let descriptor: number | undefined;
  let started = 0;
  let elapsedMs = 0;
  let count = 0;
  let bytes = 0;
  function close() {
    if (descriptor === undefined) return;
    const owned = descriptor;
    descriptor = undefined;
    try { closeSync(owned); } catch { /* Diagnostics do not own test cleanup. */ }
  }
  try {
    started = now();
    descriptor = openSync(firstStartProofObservationPath(userDataRoot, runtimeInstanceId), 'wx', 0o600);
  } catch { close(); }
  return {
    close,
    record(phase) {
      if (descriptor === undefined) return;
      try {
        if (!phases.includes(phase) || phase === 'observationsTruncated') {
          close();
          return;
        }
        elapsedMs = Math.max(elapsedMs, Math.floor(now() - started), 0);
        if (!Number.isSafeInteger(elapsedMs)) { close(); return; }
        const capped = count === MAX_FIRST_START_PROOF_OBSERVATIONS - 1;
        const entry: FirstStartProofObservation = {
          schemaVersion: 1,
          phase: capped ? 'observationsTruncated' : phase,
          elapsedMs,
        };
        const line = Buffer.from(`${JSON.stringify(entry)}\n`, 'utf8');
        if (bytes + line.length > MAX_FIRST_START_PROOF_OBSERVATION_BYTES) {
          close();
          return;
        }
        if (write(descriptor, line) !== line.length) { close(); return; }
        bytes += line.length;
        count++;
        if (capped) close();
      } catch { close(); }
    },
  };
}

export function parseFirstStartProofObservations(text: string): FirstStartProofCapture {
  if (Buffer.byteLength(text, 'utf8') > MAX_FIRST_START_PROOF_OBSERVATION_BYTES) {
    return { status: 'tooLarge' };
  }
  const lines = text.split('\n');
  const trailing = lines.pop();
  const partial = trailing !== '';
  if (lines.length === 0 || lines.length > MAX_FIRST_START_PROOF_OBSERVATIONS) {
    return { status: 'invalid' };
  }
  const observations: FirstStartProofObservation[] = [];
  let elapsedMs = 0;
  let truncated = false;
  for (const line of lines) {
    let value: unknown;
    try { value = JSON.parse(line); } catch { return { status: 'invalid' }; }
    if (truncated || !isRecord(value) ||
        Object.keys(value).sort().join(',') !== 'elapsedMs,phase,schemaVersion' ||
        value.schemaVersion !== 1 || !phases.includes(value.phase as FirstStartProofPhase) ||
        typeof value.elapsedMs !== 'number' || !Number.isSafeInteger(value.elapsedMs) ||
        value.elapsedMs < elapsedMs) {
      return { status: 'invalid' };
    }
    elapsedMs = value.elapsedMs;
    truncated = value.phase === 'observationsTruncated';
    observations.push(Object.freeze({
      schemaVersion: 1, phase: value.phase as FirstStartProofPhase, elapsedMs,
    }));
  }
  return Object.freeze({
    status: partial ? 'partial' : 'captured',
    observations: Object.freeze(observations), truncated,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
