import { vi, type TestContext } from 'vitest';
import { createRunnerFailureSink } from '../../../../../test-reporters/runnerFailureEvidence.mjs';
import * as publication from './workspaceDeletionPublication.js';
import * as payload from './workspaceDeletionPayloadExecutor.js';
import * as registry from './workspaceDeletionRegistryPublication.js';
import * as metadata from './workspaceDeletionMetadataCleanup.js';
import * as finalizer from './workspaceDeletionFinalization.js';
import { WorkspaceDeletionInventoryStore } from './workspaceDeletionInventoryStore.js';

type Phase = 'preparation' | 'publication' | 'admission' | 'payload' | 'registry' | 'metadata' | 'finalizer' | 'verification';
type FailureSink = ReturnType<typeof createRunnerFailureSink>;
type PublicationDetail = 'publicationInventoryWrite' | 'publicationComparison1' | 'publicationComparison2' | 'publicationComparison3';

// Test-only observation. A phase is not a cause, admission or cleanup authority.
export function observeDeletionCommandFailures(test: TestContext, sink: FailureSink = createRunnerFailureSink()) {
  let phase: Phase = 'preparation', root: string | undefined, recorded = false;
  let publicationDetail: { name: PublicationDetail } | undefined, comparisons = 0;
  const currentPhase = () => phase === 'publication' ? publicationDetail?.name ?? phase : phase;
  const observePublication = <Result>(name: PublicationDetail, work: () => Promise<Result>): Promise<Result> => {
    const observation = { name };
    publicationDetail = observation;
    const result = work();
    void result.then(() => {
      if (publicationDetail === observation) publicationDetail = undefined;
    }, () => { /* Retain the failed detail for the existing first-error record. */ });
    return result;
  };
  const track = <Args extends unknown[], Result>(name: Phase, work: (...args: Args) => Result) => (...args: Args): Result => {
    phase = name;
    return work(...args);
  };
  const capture = <Factory extends (...args: never[]) => unknown>(factory: Factory): Factory =>
    vi.isMockFunction(factory) ? (factory.getMockImplementation() ?? factory) as Factory : factory;
  const makePublication = capture(publication.createWorkspaceDeletionPublisher);
  const makePayload = capture(payload.createWorkspaceDeletionPayloadExecutor);
  const makeRegistry = capture(registry.createWorkspaceDeletionRegistryPublisher);
  const makeMetadata = capture(metadata.createWorkspaceDeletionMetadataCleaner);
  const makeFinalizer = capture(finalizer.createWorkspaceDeletionFinalizer);
  const publishInventory = capture(WorkspaceDeletionInventoryStore.prototype.publish);
  const compareInventory = capture(WorkspaceDeletionInventoryStore.prototype.assertRecords);
  vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'publish').mockImplementation(function (this: WorkspaceDeletionInventoryStore, ...args) {
    if (phase !== 'publication') return publishInventory.apply(this, args);
    return observePublication('publicationInventoryWrite', () => publishInventory.apply(this, args));
  });
  vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'assertRecords').mockImplementation(function (this: WorkspaceDeletionInventoryStore, ...args) {
    if (phase !== 'publication') return compareInventory.apply(this, args);
    const details = ['publicationComparison1', 'publicationComparison2', 'publicationComparison3'] as const;
    const detail = details[comparisons++];
    return detail === undefined ? compareInventory.apply(this, args)
      : observePublication(detail, () => compareInventory.apply(this, args));
  });
  vi.spyOn(publication, 'createWorkspaceDeletionPublisher').mockImplementation((...args) => track('publication', makePublication(...args)));
  vi.spyOn(payload, 'createWorkspaceDeletionPayloadExecutor').mockImplementation((...args) => track('payload', makePayload(...args)));
  vi.spyOn(registry, 'createWorkspaceDeletionRegistryPublisher').mockImplementation((...args) => track('registry', makeRegistry(...args)));
  vi.spyOn(metadata, 'createWorkspaceDeletionMetadataCleaner').mockImplementation((...args) => track('metadata', makeMetadata(...args)));
  vi.spyOn(finalizer, 'createWorkspaceDeletionFinalizer').mockImplementation((...args) => track('finalizer', makeFinalizer(...args)));
  const record = (error: unknown) => {
    if (recorded) return;
    recorded = true;
    try {
      const retryCount = test.task.result?.retryCount, repeatCount = test.task.result?.repeatCount;
      sink.record({
        runner: 'vitest', phase: `workspaceDeletionRoles_${currentPhase()}`, error,
        testName: test.task.name, testId: `${test.task.id}:${root ?? 'rootUnavailable'}`,
        file: 'apps/desktop/src/workspaces/deletion/workspaceDeletionRolesCommand.test.ts',
        ...(retryCount === undefined ? {} : { retryCount }), ...(repeatCount === undefined ? {} : { repeatCount }),
        ...(retryCount === 0 && repeatCount === 0 ? { attempt: 0 } : {})
      });
    } catch { /* Optional evidence must not replace the original test failure. */ }
  };
  test.onTestFinished(async () => {
    if (!recorded && test.task.result?.state !== 'pass') {
      record(test.task.result?.errors?.[0] ?? new Error('SYNTHETIC_DELETION_TEST_ORIGINAL_UNAVAILABLE'));
    }
    try { await sink.flush(); }
    catch { /* The normal reporter still owns the test result. */ }
    finally { vi.restoreAllMocks(); }
  });
  return {
    record, phase: currentPhase,
    preparedRoot(value: string) { root = value; },
    admission() { phase = 'admission'; },
    verification() { phase = 'verification'; },
  };
}
