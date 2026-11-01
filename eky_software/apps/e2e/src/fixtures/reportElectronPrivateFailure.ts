import type { TestInfo } from '@playwright/test';

import { createRunnerFailureSink } from '../../../../test-reporters/runnerFailureEvidence.mjs';
import { electronE2eStartupExceptionPath, validateElectronE2eStartupException } from '../../../desktop/e2e/electronE2eStartupException.js';
import { projectExceptionChain, STARTUP_EXCEPTION_LIMITS, type ExceptionProjection } from '../../../desktop/src/main/startupExceptionEvidence.js';
import { readElectronGenerationFile } from './readElectronGenerationFile.js';
import type { ElectronPublicCloseFailureReason } from './closeOwnedWindowsElectronRuntime.js';

type Context = Pick<TestInfo, 'title' | 'testId' | 'file' | 'line' | 'column' | 'retry' | 'repeatEachIndex' | 'annotations'>;
type Sink = ReturnType<typeof createRunnerFailureSink>;
type Status = 'recorded' | 'partial' | 'missing' | 'invalid' | 'tooLarge' | 'sourceChanged' | 'readFailed' | 'unavailable' | 'captureFailed';

export function readElectronStartupException(input: {
  runRoot: string; artifactsRoot: string; runtimeInstanceId: string;
}) {
  try {
    return readElectronGenerationFile({ ...input, maximumBytes: STARTUP_EXCEPTION_LIMITS.fileBytes,
      path: electronE2eStartupExceptionPath(input.artifactsRoot, input.runtimeInstanceId),
      parse(text) {
        try {
          if (!text.endsWith('\n')) return { status: 'invalid' as const };
          return { status: 'captured' as const,
            evidence: validateElectronE2eStartupException(JSON.parse(text), input.runtimeInstanceId) };
        } catch { return { status: 'invalid' as const }; }
      },
    });
  } catch { return { status: 'invalid' as const }; }
}

export async function reportElectronStartupException(input: {
  runRoot: string; artifactsRoot: string; runtimeInstanceId: string;
  absentRuntimeInstanceId: string | undefined; testInfo: Context; secrets: string[];
}, sink?: Sink): Promise<void> {
  let status: Status = 'unavailable';
  try {
    if (input.absentRuntimeInstanceId === input.runtimeInstanceId) {
      const read = readElectronStartupException(input);
      if (read.status !== 'captured') status = read.status;
      else status = await deliver(input, `electronStartup-${read.evidence.stage}`, read.evidence.exception,
        sink ?? createRunnerFailureSink({ secrets: input.secrets }));
    }
  } catch { status = 'captureFailed'; }
  annotate(input.testInfo, 'electron-startup-exception', status);
}

export interface ElectronPrivateCloseFailure {
  readonly runtimeInstanceId: string;
  readonly projection: ExceptionProjection;
}

// Only cached reads and bounded projection here; delivery happens after owner-stop.
export function captureElectronPrivateCloseFailure(input: {
  runtimeInstanceId: string; startupGeneration: number; reason: ElectronPublicCloseFailureReason;
  error: unknown; workload: 'running' | 'exited' | 'unavailable';
  bridge: 'pending' | 'notLaunched' | 'closed' | 'unverified'; applicationClosed: boolean;
  secrets: string[];
}): ElectronPrivateCloseFailure {
  const observation = new Error(`Electron public close observation: ${input.reason}; ` +
    `generation=${input.startupGeneration}; workload=${input.workload}; bridge=${input.bridge}; applicationClosed=${input.applicationClosed}`,
  input.error === undefined ? undefined : { cause: input.error });
  const projection = projectExceptionChain(observation, input.secrets);
  for (const part of projection.chain) Object.freeze(part);
  Object.freeze(projection.chain);
  return Object.freeze({ runtimeInstanceId: input.runtimeInstanceId, projection: Object.freeze(projection) });
}

export async function reportElectronCloseFailure(input: {
  failure: ElectronPrivateCloseFailure; testInfo: Context; secrets: string[];
}, sink?: Sink): Promise<void> {
  let status: Status;
  try {
    status = await deliver({ ...input, runtimeInstanceId: input.failure.runtimeInstanceId },
      'electronPublicCloseObservation', input.failure.projection, sink ?? createRunnerFailureSink({ secrets: input.secrets }));
  } catch { status = 'captureFailed'; }
  annotate(input.testInfo, 'electron-close-exception', status);
}

async function deliver(input: { runtimeInstanceId: string; testInfo: Context }, phase: string,
  projection: ExceptionProjection, sink: Sink): Promise<Status> {
  sink.record({ runner: 'playwright', phase, error: undefined, projectedException: projection,
    testName: input.testInfo.title, testId: `${input.testInfo.testId}:${input.runtimeInstanceId}`,
    file: input.testInfo.file, line: input.testInfo.line, column: input.testInfo.column,
    attempt: input.testInfo.retry, repeatCount: input.testInfo.repeatEachIndex });
  const delivery = await sink.flush() as { status?: string };
  return delivery.status !== 'recorded' ? 'captureFailed'
    : projection.incomplete || projection.chain.some(part => part.truncated) ? 'partial' : 'recorded';
}

function annotate(context: Context, type: string, status: Status): void {
  try { context.annotations.push({ type, description: status }); } catch { /* Preserve the original test failure. */ }
}
