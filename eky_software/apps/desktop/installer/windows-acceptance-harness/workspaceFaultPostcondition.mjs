import { isDeepStrictEqual } from 'node:util';

import { validateWorkspaceFaultRequest, workspaceFaultPlan } from './workspaceFaultContracts.mjs';
import { hasWorkspaceSuccessExactKeys, readWorkspaceSuccessObject } from './workspaceSuccessContracts.mjs';
import { readWorkspaceSuccessProfileState } from './workspaceSuccessProfileEvidence.mjs';
import { WORKSPACE_FAULT_CHECKPOINTS, captureWorkspaceFaultProfileEvidence,
  workspaceFaultCheckpointPath } from './workspaceFaultProfileEvidence.mjs';

export const WORKSPACE_FAULT_POSTCONDITION_ERRORS = Object.freeze([
  'profileEvidenceInvalid', 'profileRegistryMismatch', 'profileAcceptedBuildMismatch',
  'profileJournalMismatch', 'profileBusinessContentChanged', 'profileMigrationMismatch', 'profileCurrentStateChanged',
]);
const invalid = (code = 'profileEvidenceInvalid') => { throw new Error(code); };
const withoutEvidence = (state) => ({ ...state, fixtures: state.fixtures.map(({ baseline, ...fixture }) => fixture) });

function validateCheckpoint(value, { request, checkpoint, state, support }) {
  if (!hasWorkspaceSuccessExactKeys(value, ['schemaVersion', 'checkpoint', 'faultScenario', 'runNonce',
    'artifactDescriptorSha256', 'profileState', 'registry', 'accepted', 'journal']) ||
    value.schemaVersion !== 1 || value.checkpoint !== checkpoint || value.faultScenario !== request.faultScenario ||
    value.runNonce !== request.runNonce || value.artifactDescriptorSha256 !== request.artifactDescriptorSha256) invalid();
  const profile = support.parseW6b2PackagedWorkspaceProfileState(value.profileState);
  if (!isDeepStrictEqual(withoutEvidence(profile), withoutEvidence(state))) invalid();
  support.validateWorkspaceRegistry(value.registry);
  support.parseAcceptedBuildMetadata(value.accepted);
  if (value.journal !== null) support.parseUpdateJournal(value.journal);
  return value;
}

function packageIdentity(actual, role) {
  const { buildRevision, msiProductVersion, packageSha256, packageSize } = role;
  if (!isDeepStrictEqual(actual, { buildRevision, msiProductVersion, packageSha256, packageSize })) invalid('profileJournalMismatch');
}

export function verifyWorkspaceFaultCheckpoints({ request: expected, artifact, state, checkpoints, support }) {
  try {
    const request = validateWorkspaceFaultRequest(expected);
    const plan = workspaceFaultPlan(request.faultScenario);
    if (state.buildRevision !== request.buildRevision.slice(0, 12) ||
      state.sourceVersion !== artifact.source.appVersion || state.targetVersion !== artifact.target.appVersion ||
      ['source', 'target'].some((role) => artifact[role].buildRevision !== state.buildRevision) ||
      !Array.isArray(checkpoints) || checkpoints.length !== WORKSPACE_FAULT_CHECKPOINTS.length) invalid();
    const [source, terminal] = checkpoints.map((value, index) => validateCheckpoint(value, {
      request, checkpoint: WORKSPACE_FAULT_CHECKPOINTS[index], state, support,
    }));
    if (!isDeepStrictEqual(source.profileState, state) || source.journal !== null) invalid();
    if (source.accepted.appVersion !== artifact.source.appVersion ||
      source.accepted.buildRevision !== artifact.source.buildRevision || source.accepted.releaseChannel !== 'pilot') {
      invalid('profileAcceptedBuildMismatch');
    }
    if (source.registry.activeWorkspaceId !== state.fixtures[0].workspaceId || source.registry.workspaces.length !== 3 ||
      state.fixtures.some((fixture, index) => source.registry.workspaces.filter((entry) =>
        entry.workspaceId === fixture.workspaceId && entry.workspaceLabel === `First-start workspace ${index + 1}` &&
        entry.lifecycleState === 'ready' && entry.layoutVersion === 1 &&
        entry.lineageIdentity.profileId === fixture.profileId).length !== 1)) invalid('profileRegistryMismatch');
    const expectedRegistry = { ...source.registry, workspaces: source.registry.workspaces.map((entry) => ({ ...entry,
      lifecycleState: terminal.registry.workspaces.find((current) => current.workspaceId === entry.workspaceId)?.lifecycleState,
    })) };
    if (!isDeepStrictEqual(terminal.registry, expectedRegistry)) invalid('profileRegistryMismatch');
    // Reuse the existing pure fault assertions, not their disk reader or a store
    // that could settle recovery slots. Capture has already checked all paths.
    try {
      support.assertW6b2PackagedFaultWorkspaceState({ operation: plan.verificationOperation, state,
        registry: terminal.registry, acceptedBuild: terminal.accepted, journal: terminal.journal ?? undefined,
        currentEvidence: new Map(terminal.profileState.fixtures.map((fixture) => [fixture.fixtureKey, fixture.baseline])),
      });
    } catch (error) {
      invalid({ W6B2_FAULT_PROFILE_CONTENT_INVALID: 'profileBusinessContentChanged',
        W6B2_FAULT_PROFILE_DATABASE_INVALID: 'profileMigrationMismatch',
        W6B2_FAULT_PROFILE_REGISTRY_INVALID: 'profileRegistryMismatch',
        W6B2_FAULT_PROFILE_ACCEPTED_BUILD_INVALID: 'profileAcceptedBuildMismatch',
        W6B2_FAULT_PROFILE_JOURNAL_INVALID: 'profileJournalMismatch',
      }[error?.message] ?? 'profileEvidenceInvalid');
    }
    packageIdentity(terminal.journal.currentPackageIdentity, artifact.source);
    packageIdentity(terminal.journal.candidatePackageIdentity, artifact.target);
    return Object.freeze({ status: 'completed', resultCode: 'workspaceFaultSemanticProofValidated' });
  } catch (error) { invalid(WORKSPACE_FAULT_POSTCONDITION_ERRORS.includes(error?.message) ? error.message : undefined); }
}

export async function verifyWorkspaceFaultSemanticPostcondition(input, {
  captureCurrent = captureWorkspaceFaultProfileEvidence,
} = {}) {
  try {
    const state = await readWorkspaceSuccessProfileState(input.proofRoot, input.support);
    const checkpoints = [];
    for (const checkpoint of WORKSPACE_FAULT_CHECKPOINTS) {
      checkpoints.push(await readWorkspaceSuccessObject(workspaceFaultCheckpointPath(input.proofRoot, checkpoint), 'profileEvidenceInvalid'));
    }
    const result = verifyWorkspaceFaultCheckpoints({ ...input, state, checkpoints });
    const current = await captureCurrent({ ...input, checkpoint: 'faultTerminal' });
    if (!isDeepStrictEqual(current, checkpoints.at(-1))) invalid('profileCurrentStateChanged');
    return result;
  } catch (error) { invalid(WORKSPACE_FAULT_POSTCONDITION_ERRORS.includes(error?.message) ? error.message : undefined); }
}
