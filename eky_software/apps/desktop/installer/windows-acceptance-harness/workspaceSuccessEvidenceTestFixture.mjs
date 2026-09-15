import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { createWorkspaceSuccessRequest } from './workspaceSuccessContracts.mjs';
import { loadWorkspaceSuccessProfileSupport, WORKSPACE_SUCCESS_CHECKPOINTS } from './workspaceSuccessProfileEvidence.mjs';

export async function createWorkspaceSuccessEvidenceTestFixture() {
  const support = await loadWorkspaceSuccessProfileSupport();
  const { readW6b2BusinessAmounts } = await import(new URL('../../e2e-dist/e2e/w6b2PackagedWorkspaceBusinessFixture.js', import.meta.url));
  const revision = 'a'.repeat(40);
  const request = createWorkspaceSuccessRequest({ fixtureRoot: resolve('synthetic-fixture'), buildRevision: revision,
    artifactDescriptorSha256: 'b'.repeat(64), runNonce: 'c'.repeat(64) });
  const artifact = Object.fromEntries(['source', 'target'].map((role, index) => [role, {
    appVersion: `0.2.${7 + index}`, msiProductVersion: `0.2.${7 + index}`,
    buildRevision: revision.slice(0, 12), packageSha256: String(index + 1).repeat(64), packageSize: 100 + index,
  }]));
  const state = {
    formatVersion: 1, buildRevision: revision.slice(0, 12), sourceVersion: '0.2.7', targetVersion: '0.2.8',
    fixtures: ['A', 'B', 'C'].map((fixtureKey, index) => {
      const file = { sha256: String(index + 1).repeat(64), size: 100 + index };
      return {
        fixtureKey, profileId: String(index + 1).repeat(64), workspaceId: randomUUID(),
        business: { companySettingsId: `company-${fixtureKey}`, customerId: `customer-${fixtureKey}`,
          customerNumber: `customer-number-${fixtureKey}`, documentId: `document-${fixtureKey}`,
          draftId: `draft-${fixtureKey}`, draftLineId: `draft-line-${fixtureKey}`, invoiceId: `invoice-${fixtureKey}`,
          invoiceLineId: `invoice-line-${fixtureKey}`, invoiceNumber: `invoice-number-${fixtureKey}`,
          ...readW6b2BusinessAmounts(fixtureKey), pdfSha256: file.sha256, pdfSize: file.size },
        baseline: { archiveConfig: { ...file }, archiveJournal: { ...file }, archiveSentinel: { ...file },
          businessRowsSha256: file.sha256, database: { ...file }, pdf: { ...file },
          recoverySentinel: { ...file }, secretSentinel: { ...file } },
      };
    }),
  };
  const timestamp = '2026-01-01T00:00:00.000Z';
  const registry = { formatVersion: 1, activeWorkspaceId: state.fixtures[0].workspaceId,
    workspaces: state.fixtures.map((fixture) => ({ workspaceId: fixture.workspaceId, workspaceLabel: `Synthetic ${fixture.fixtureKey}`,
      lineageIdentity: { formatVersion: 1, profileId: fixture.profileId }, layoutVersion: 1,
      lifecycleState: 'ready', createdAt: timestamp })) };
  const identity = (role) => { const { appVersion, ...rest } = artifact[role]; return rest; };
  const journal = { formatVersion: 1, state: 'accepted', currentVersion: '0.2.7', targetVersion: '0.2.8',
    currentPackageIdentity: identity('source'), candidatePackageIdentity: identity('target'),
    correlationId: randomUUID(), recoveryPointReference: randomUUID(), preUpdateMigrationChainIdentity: 'd'.repeat(64),
    createdAt: timestamp, updatedAt: timestamp, releaseChannel: 'pilot', revision: 5,
    handoffAttemptCount: 1, binaryRollbackAttemptCount: 0 };
  const events = [];
  function addRuntime(appVersion) {
    const runtimeInstanceId = randomUUID();
    for (const eventName of ['desktop.started', 'desktop.shutdownCompleted']) events.push({
      eventName, appVersion, buildRevision: state.buildRevision, runtimeInstanceId, eventId: randomUUID(),
    });
  }
  const checkpoints = WORKSPACE_SUCCESS_CHECKPOINTS.map((checkpoint, index) => {
    if (index > 0) {
      if (index === 1) addRuntime('0.2.7');
      if (index === 5) addRuntime('0.2.8');
      addRuntime('0.2.8');
    }
    const profileState = structuredClone(state);
    if (index > 0) profileState.fixtures[0].baseline.database.sha256 = 'd'.repeat(64);
    if (index >= 3) profileState.fixtures[1].baseline.database.sha256 = 'e'.repeat(64);
    const currentRegistry = structuredClone(registry);
    if (index > 0) currentRegistry.workspaces[2].lifecycleState = 'recoveryRequired';
    if ([2, 3, 4].includes(index)) currentRegistry.activeWorkspaceId = state.fixtures[1].workspaceId;
    return structuredClone({ schemaVersion: 1, checkpoint, runNonce: request.runNonce,
      artifactDescriptorSha256: request.artifactDescriptorSha256, profileState, registry: currentRegistry,
      accepted: { formatVersion: 1, appVersion: index === 0 ? '0.2.7' : '0.2.8',
        buildRevision: state.buildRevision, releaseChannel: 'pilot', acceptedAt: timestamp },
      journal: index === 0 ? null : journal, events });
  });
  return { request, artifact, state, checkpoints, support };
}
