import type { ElectronApplication, TestInfo } from '@playwright/test';

import { createRunnerFailureSink, RUNNER_FAILURE_DELIVERY_TIMEOUT_MS } from '../../../../test-reporters/runnerFailureEvidence.mjs';
import type { createWorkspaceDeletionProof } from '../../../desktop/e2e/workspaceDeletionProof.js';
import type { createWorkspaceDeletionExecutionProof } from '../../../desktop/e2e/workspaceDeletionExecutionProof.js';
import type { PhaseHandoffEnvelope } from '../../../desktop/e2e/workspaceDeletionPhaseHandoff.js';

// Use ESM for both Playwright's source loader and direct Node execution.
const { bindPhaseHandoffCapture, capturePhaseHandoffExpected, deliverPhaseHandoffObservation } =
  await import(new URL('../../../desktop/e2e/workspaceDeletionPhaseHandoff.ts', import.meta.url).href) as
    typeof import('../../../desktop/e2e/workspaceDeletionPhaseHandoff.js');

type FailureSet = Partial<ReturnType<ReturnType<typeof createWorkspaceDeletionProof>['readFailures']> &
  ReturnType<ReturnType<typeof createWorkspaceDeletionExecutionProof>['readFailures']>>;
type EvidenceContext = Pick<TestInfo, 'title' | 'testId' | 'file' | 'line' | 'column' | 'retry' | 'repeatEachIndex' | 'annotations'>;

export function shouldCaptureWorkspaceDeletionFailure(
  actual: TestInfo['status'], expected: TestInfo['expectedStatus'], failureObserved: boolean,
): boolean {
  return failureObserved && !(actual === 'failed' && expected === 'failed');
}

export function selectWorkspaceDeletionPhaseObservation(input: Readonly<{
  application: Pick<ElectronApplication, 'evaluate'>;
  runtimeInstanceId: string;
  scenarioId: 'DESK-DELETE-RECOVERY-001';
  testInfo: Pick<TestInfo, 'retry' | 'repeatEachIndex' | 'project' | 'outputPath'>;
}>) {
  const application = input.application, runtimeInstanceId = input.runtimeInstanceId;
  const captured = capturePhaseHandoffExpected({ ...input, env: process.env });
  let started = false, frozen = false;
  let envelope: PhaseHandoffEnvelope = captured.envelope;
  return Object.freeze({
    beginClose(current: Pick<ElectronApplication, 'evaluate'> | undefined, generation: string) {
      if (started || frozen || current !== application || generation !== runtimeInstanceId) return;
      started = true;
      try {
        const pending = application.evaluate(() => (globalThis as unknown as { __EKY_ELECTRON_E2E__?: {
          workspaceDeletionExecutionProof?: { readPhaseObservation(): unknown };
        } }).__EKY_ELECTRON_E2E__?.workspaceDeletionExecutionProof?.readPhaseObservation());
        void pending.then(value => {
          if (frozen) return;
          const checked = bindPhaseHandoffCapture(value, captured.expected);
          if (checked !== undefined) envelope = checked;
        }).catch(() => undefined);
      } catch { /* Missing observation must not hold or replace shutdown. */ }
    },
    finishClose(current: Pick<ElectronApplication, 'evaluate'> | undefined, generation: string) {
      if (current === application && generation === runtimeInstanceId) frozen = true;
    },
    async reportFailure(failed: boolean) {
      if (!failed || !frozen) return 'notRequired' as const;
      try { return await deliverPhaseHandoffObservation({ ...captured, envelope, failed: true }); }
      catch { return 'deliveryFailed' as const; }
    },
  });
}

// Read the original main-only failure before closing Electron. Reporting uses
// the existing bounded sink, outside main's shutdown/IPC completion path.
export async function captureWorkspaceDeletionFailure(input: Readonly<{
  application: Pick<ElectronApplication, 'evaluate'> | undefined;
  runtimeInstanceId: string;
  testInfo: EvidenceContext;
}>, sink = createRunnerFailureSink()): Promise<void> {
  let status: 'recorded' | 'partial' | 'missing' | 'unavailable' | 'captureFailed' = 'unavailable';
  try {
    if (input.application !== undefined) {
      const read = input.application.evaluate(() => {
        const controller = (globalThis as unknown as { __EKY_ELECTRON_E2E__?: {
          workspaceDeletionProof?: { readFailures(): FailureSet };
          workspaceDeletionExecutionProof?: { readFailures(): FailureSet };
        } }).__EKY_ELECTRON_E2E__;
        const preparation = controller?.workspaceDeletionProof?.readFailures();
        const execution = controller?.workspaceDeletionExecutionProof?.readFailures();
        return preparation === undefined ? execution : { ...preparation, ...execution };
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('E2E_WORKSPACE_DELETION_CAPTURE_TIMEOUT')), RUNNER_FAILURE_DELIVERY_TIMEOUT_MS);
      });
      let failures: FailureSet | undefined;
      try { failures = await Promise.race([read, deadline]); }
      finally { clearTimeout(timer); }
      status = 'missing';
      const observed = (['request', 'shutdown', 'execution'] as const).flatMap(role =>
        failures?.[role] === undefined ? [] : [{ role, projection: failures[role] }]);
      const allObserved = [...observed, ...(failures?.executionRelated ?? []).map(projection =>
        ({ role: 'executionRelated' as const, projection }))];
      if (allObserved.length !== 0) {
        const partial = allObserved.some(({ projection }) => projection.incomplete || projection.chain.some(part => part.truncated));
        for (const { role, projection } of allObserved) {
          const phase = { request: 'workspaceDeletionIpc', shutdown: 'workspaceDeletionShutdown',
            execution: 'workspaceDeletionExecution', executionRelated: 'workspaceDeletionExecutionRelated' }[role];
          sink.record({ runner: 'playwright', phase,
            error: undefined, projectedException: projection,
            testName: input.testInfo.title, testId: `${input.testInfo.testId}:${input.runtimeInstanceId}`,
            file: input.testInfo.file, line: input.testInfo.line, column: input.testInfo.column,
            attempt: input.testInfo.retry, repeatCount: input.testInfo.repeatEachIndex });
        }
        const delivery = await sink.flush() as { status?: string };
        status = delivery.status !== 'recorded' ? 'captureFailed'
          : partial ? 'partial' : 'recorded';
      }
    }
  } catch { status = 'captureFailed'; }
  try { input.testInfo.annotations.push({ type: 'workspace-deletion-evidence', description: status }); }
  catch { /* Optional evidence must not replace the original failure. */ }
}
