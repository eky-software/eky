import { rm } from 'node:fs/promises';

import type { TestContext } from 'vitest';

type RestoreStartupTestPhase = 'fixturePreparation' | 'startupRollback' | 'restoredContentCheck';
type ResourceCleanupStage = 'clientClose' | 'mockRestore' | 'environmentRestore';

class RestoreStartupResourceCleanupError extends AggregateError {
  readonly stages: readonly ResourceCleanupStage[];

  constructor(failures: readonly { stage: ResourceCleanupStage; error: unknown }[]) {
    super(failures.map(failure => failure.error), 'Restore startup test resource cleanup failed');
    this.stages = Object.freeze(failures.map(failure => failure.stage));
  }
}

export function createRestoreStartupTestLifetime(
  context: Pick<TestContext, 'onTestFinished' | 'signal'>,
  releaseResources: () => void,
) {
  const roots: string[] = [];
  let phase: RestoreStartupTestPhase | 'notStarted' = 'notStarted';
  let lastCompletedPhase: RestoreStartupTestPhase | 'none' = 'none';
  let bodySettled = false;
  let bodySucceeded = false;
  let releaseRequested = false;
  let resourceCleanup: 'pending' | 'completed' | 'failed' = 'pending';
  let resourceFailure: unknown;
  let finished = false;
  let evidenceRetained = false;

  const report = () => console.error(JSON.stringify({
    diagnostic: 'desktopRestoreStartupTest', phase, lastCompletedPhase,
    bodySettled, resourceCleanup, rootsRetained: true,
    resourceCleanupFailureCode: resourceCleanup === 'failed' ? 'resourceCleanupFailed' : null,
    resourceCleanupFailureStages: resourceCleanup !== 'failed' ? [] :
      resourceFailure instanceof RestoreStartupResourceCleanupError ? resourceFailure.stages : ['unknown'],
  }));
  const releaseIfSettled = () => {
    if (!releaseRequested || !bodySettled || resourceCleanup !== 'pending') return;
    try {
      releaseResources();
      resourceCleanup = 'completed';
    } catch (error) {
      resourceFailure = error;
      resourceCleanup = 'failed';
    }
  };

  context.onTestFinished(async ({ task }) => {
    finished = true;
    evidenceRetained ||= task.result?.state !== 'pass' || !bodySettled || !bodySucceeded ||
      context.signal.aborted || resourceCleanup !== 'completed';
    if (evidenceRetained) {
      report();
      return;
    }
    const results = await Promise.allSettled(roots.map(root => rm(root, { recursive: true, force: true })));
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length > 0) {
      evidenceRetained = true;
      report();
      throw new AggregateError(failures.map(result => result.reason), 'Restore startup test file cleanup failed');
    }
  });

  return {
    roots,
    async run(body: () => Promise<void>): Promise<void> {
      try {
        context.signal.throwIfAborted();
        await body();
        context.signal.throwIfAborted();
        bodySucceeded = true;
      } finally {
        bodySettled = true;
        // Timeout may already have finished the test. Only now may its shared
        // mocks/clients be released; never delete its retained files here.
        releaseIfSettled();
        if (finished) report();
      }
    },
    async step<T>(nextPhase: RestoreStartupTestPhase, work: () => Promise<T>): Promise<T> {
      context.signal.throwIfAborted();
      phase = nextPhase;
      const result = await work();
      lastCompletedPhase = nextPhase;
      context.signal.throwIfAborted();
      return result;
    },
    releaseWhenSettled(): void {
      releaseRequested = true;
      releaseIfSettled();
      if (resourceCleanup === 'failed') throw resourceFailure;
    },
    assertSharedStateReleased(): void {
      if (!bodySettled || resourceCleanup !== 'completed') {
        throw new Error('DESKTOP_RESTORE_TEST_PREVIOUS_WORK_UNSETTLED');
      }
    },
  };
}

export function releaseRestoreStartupTestResources(
  clients: readonly { close(): void }[],
  restoreMocks: () => void,
  restoreEnvironment: () => void,
): void {
  const failures: { stage: ResourceCleanupStage; error: unknown }[] = [];
  const releases: { stage: ResourceCleanupStage; release(): void }[] = [
    ...clients.map(client => ({ stage: 'clientClose' as const, release: () => client.close() })),
    { stage: 'mockRestore', release: restoreMocks },
    { stage: 'environmentRestore', release: restoreEnvironment },
  ];
  for (const { stage, release } of releases) {
    try { release(); } catch (error) { failures.push({ stage, error }); }
  }
  if (failures.length > 0) throw new RestoreStartupResourceCleanupError(failures);
}
