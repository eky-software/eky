import type { ElectronApplication, TestInfo } from '@playwright/test';

import { createRunnerFailureSink, RUNNER_FAILURE_DELIVERY_TIMEOUT_MS } from '../../../../test-reporters/runnerFailureEvidence.mjs';
import type { createWorkspaceDeletionProof } from '../../../desktop/e2e/workspaceDeletionProof.js';

type FailureSet = ReturnType<ReturnType<typeof createWorkspaceDeletionProof>['readFailures']>;
type EvidenceContext = Pick<TestInfo, 'title' | 'testId' | 'file' | 'line' | 'column' | 'retry' | 'repeatEachIndex' | 'annotations'>;

export function shouldCaptureWorkspaceDeletionFailure(
  actual: TestInfo['status'], expected: TestInfo['expectedStatus'], failureObserved: boolean,
): boolean {
  return failureObserved && !(actual === 'failed' && expected === 'failed');
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
        } }).__EKY_ELECTRON_E2E__;
        return controller?.workspaceDeletionProof?.readFailures();
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('E2E_WORKSPACE_DELETION_CAPTURE_TIMEOUT')), RUNNER_FAILURE_DELIVERY_TIMEOUT_MS);
      });
      let failures: FailureSet | undefined;
      try { failures = await Promise.race([read, deadline]); }
      finally { clearTimeout(timer); }
      status = 'missing';
      const observed = (['request', 'shutdown'] as const).flatMap(role =>
        failures?.[role] === undefined ? [] : [{ role, projection: failures[role] }]);
      if (observed.length !== 0) {
        const partial = observed.some(({ projection }) => projection.incomplete || projection.chain.some(part => part.truncated));
        for (const { role, projection } of observed) {
          sink.record({ runner: 'playwright', phase: role === 'request' ? 'workspaceDeletionIpc' : 'workspaceDeletionShutdown',
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
