import { randomUUID } from 'node:crypto';

import { createWorkspaceFaultRequest } from './workspaceFaultContracts.mjs';
import { createWorkspaceSuccessEvidenceTestFixture } from './workspaceSuccessEvidenceTestFixture.mjs';
import { loadWorkspaceFaultProfileSupport } from './workspaceFaultProfileEvidence.mjs';

export async function createWorkspaceFaultEvidenceTestFixture(faultScenario = 'activeWorkspaceFirstStartFailure') {
  const fixture = await createWorkspaceSuccessEvidenceTestFixture();
  const request = createWorkspaceFaultRequest({ ...fixture.request, faultScenario });
  const support = await loadWorkspaceFaultProfileSupport();
  const { events, ...source } = structuredClone(fixture.checkpoints[0]);
  source.faultScenario = faultScenario;
  source.registry.workspaces.forEach((entry, index) => { entry.workspaceLabel = `First-start workspace ${index + 1}`; });
  const terminal = structuredClone(source);
  terminal.checkpoint = 'faultTerminal';
  terminal.journal = structuredClone(fixture.checkpoints[1].journal);
  const expectation = {
    preUpdateRecoveryPointFailure: ['failed', false, ['sourceHandoff']],
    activeWorkspaceFirstStartFailure: ['rolledBack', false, ['sourceHandoff', 'rollbackFirstStart']],
    acceptanceInterruption: ['accepted', true, ['sourceHandoff', 'targetAcceptanceRestart']],
    passiveWorkspaceMigrationFailure: ['accepted', true, ['sourceHandoff', 'targetFirstStart', 'switchToB', 'passiveWorkspaceRecovery']],
    binaryRollbackFailure: ['failedSafe', false, ['sourceHandoff']],
  }[faultScenario];
  terminal.journal.state = expectation[0];
  if (expectation[1]) {
    terminal.profileState.fixtures[0].baseline.database.sha256 = 'd'.repeat(64);
    terminal.registry.workspaces[2].lifecycleState = 'recoveryRequired';
    terminal.accepted.appVersion = '0.2.8';
  }
  if (faultScenario === 'preUpdateRecoveryPointFailure') {
    terminal.journal.handoffAttemptCount = 0;
    delete terminal.journal.recoveryPointReference;
    delete terminal.journal.preUpdateMigrationChainIdentity;
  }
  if (faultScenario === 'activeWorkspaceFirstStartFailure') terminal.journal.binaryRollbackAttemptCount = 1;
  const proofs = expectation[2].map((phase, index) => ({ phase, runtimeInstanceId: randomUUID(), priorSessionsRejected: index }));
  return { ...fixture, request, support, checkpoints: [source, terminal], proofs };
}
