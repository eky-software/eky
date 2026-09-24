import { expect, test } from '../../src/fixtures/isolatedElectronTest.js';
import { runElectronWorkspaceFirstStartLoadOrderDiagnostic } from '../../src/electron/electronMainCapabilities.js';

test('DESK-FIRST-START-LOAD-ORDER-001 proves the native load failure branch after protocol removal without opening a modal dialog', async ({ e2eElectron }) => {
  const result = await runElectronWorkspaceFirstStartLoadOrderDiagnostic(e2eElectron.electronApp);
  expect(result.proof).toEqual({
    activePointerPreserved: true,
    allCurrentCompletedWithoutJournal: true,
    allCurrentRegistryPreserved: true,
    artifactRootsPreserved: true,
    backendStartCount: 4,
    backendStoppedAfterProof: true,
    candidateProcessesReleased: true,
    directSetupRecoveryCleared: true,
    exactAcceptedRestartSkippedInventory: true,
    invalidPassiveWorkspaceQuarantined: true,
    migrationJournalCleared: true,
    mixedActiveWorkspaceMigrated: true,
    passiveCompatibleWorkspacePreserved: true,
    preparedBeforeBackend: true,
    relaunchCount: 0,
    targetAcceptedAfterRegistryTransition: true,
  });
  expect(result.loads).toHaveLength(4);
  expect(result.loads[0]).toEqual({
    loadRequests: 1, loadStarts: 1, loadSucceeded: 0, loadRejected: 1,
    mainFrameFailures: expect.any(Number), loadErrorDialogs: 1, otherErrorDialogs: 0, quitRequests: 1,
    protocolRemoved: true, releasedAfterRemoval: true, cancelled: false,
  });
  expect(Number.isSafeInteger(result.loads[0]?.mainFrameFailures)).toBe(true);
  expect(result.loads[0]?.mainFrameFailures).toBeGreaterThanOrEqual(0);
  for (const load of result.loads.slice(1)) {
    expect(load).toEqual({
      loadRequests: 1, loadStarts: 1, loadSucceeded: 1, loadRejected: 0,
      mainFrameFailures: 0, loadErrorDialogs: 0, otherErrorDialogs: 0, quitRequests: 0,
      protocolRemoved: true, releasedAfterRemoval: false, cancelled: false,
    });
  }
});
