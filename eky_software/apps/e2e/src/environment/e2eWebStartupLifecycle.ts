import type { ProcessOutput } from './boundedProcessOutput.js';
import type { E2eProcessStartupObservation } from './e2eProcessStartupObservation.js';
import { OwnedWindowsViteStartupFailure } from './startOwnedWindowsVite.js';
import { waitForObservedProcessHealth } from './waitForObservedProcessHealth.js';

export type E2eWebStartupErrorCode = 'E2E_WEB_PROCESS_SPAWN_FAILED' | 'E2E_WEB_HEALTH_TIMEOUT'
  | 'E2E_WEB_WORKLOAD_OBSERVATION_LOST' | 'E2E_WEB_CHILD_EXITED_BEFORE_HEALTH';

export interface E2eWebStartupFailureEvidence {
  readonly errorCode: E2eWebStartupErrorCode;
  readonly spawnObserved: boolean;
  readonly exitedBeforeCleanup: boolean;
  readonly cleanup: Readonly<{
    processTree: 'stopped' | 'unverified';
    port: 'released' | 'unverified';
  }>;
}

export class E2eWebStartupFailure extends Error {
  readonly evidence: Readonly<E2eWebStartupFailureEvidence>;
  readonly #output: Readonly<{ stdout: string; stderr: string }> | undefined;

  constructor(evidence: E2eWebStartupFailureEvidence, output?: Readonly<{ stdout: string; stderr: string }>) {
    super(evidence.errorCode);
    this.evidence = Object.freeze({ ...evidence, cleanup: Object.freeze({ ...evidence.cleanup }) });
    this.#output = output === undefined ? undefined : Object.freeze({ stdout: output.stdout, stderr: output.stderr });
  }

  readPrivateOutput(): Readonly<{ stdout: string; stderr: string }> | undefined {
    return this.#output;
  }
}

export async function waitForE2eWebStartup(input: {
  readonly startup: E2eProcessStartupObservation;
  readonly managedProcess?: ProcessOutput;
  waitForHealth(signal: AbortSignal): Promise<void>;
  stopProcessTree(): Promise<void>;
  releasePort(): Promise<void>;
}): Promise<void> {
  const outcome = await waitForObservedProcessHealth(input);
  if (outcome.kind === 'healthy') return;
  const state = input.startup.readState();
  const errorCode = outcome.kind === 'spawnFailed' ? 'E2E_WEB_PROCESS_SPAWN_FAILED'
    : outcome.kind === 'exited' ? 'E2E_WEB_CHILD_EXITED_BEFORE_HEALTH'
    : outcome.kind === 'observationLost' || (outcome.kind === 'healthFailed' &&
      outcome.error instanceof Error && outcome.error.message === 'E2E_WEB_WORKLOAD_OBSERVATION_LOST')
      ? 'E2E_WEB_WORKLOAD_OBSERVATION_LOST' : 'E2E_WEB_HEALTH_TIMEOUT';
  const evidence = { errorCode, spawnObserved: state.spawnObserved,
    exitedBeforeCleanup: state.terminal === 'exited' } as const;
  const output = readWebStartupOutput(input.managedProcess);
  const cleanup = await cleanupFailedWebStartup(input);
  throw new E2eWebStartupFailure({ ...evidence, cleanup }, output);
}

export function readWebStartupOutput(output: ProcessOutput | undefined): Readonly<{ stdout: string; stderr: string }> | undefined {
  if (output === undefined) return undefined;
  // The owner already bounds and redacts these streams; never expose them as error properties.
  try { return { stdout: output.readStdout(), stderr: output.readStderr() }; }
  catch { return undefined; }
}

export async function cleanupFailedWebStartup(input: {
  stopProcessTree(): Promise<void>;
  releasePort(): Promise<void>;
}): Promise<E2eWebStartupFailureEvidence['cleanup']> {
  let processTree: 'stopped' | 'unverified' = 'unverified';
  let port: 'released' | 'unverified' = 'unverified';
  try { await input.stopProcessTree(); processTree = 'stopped'; }
  catch (error) {
    // An operational error can coexist with a previously verified bounded stop.
    if (error instanceof OwnedWindowsViteStartupFailure && error.evidence.processTree === 'stopped') {
      processTree = 'stopped';
    }
  }
  try { await input.releasePort(); port = 'released'; } catch { /* Keep the first startup error. */ }
  return Object.freeze({ processTree, port });
}
