import { isDeepStrictEqual } from 'node:util';

import { WORKSPACE_SUCCESS_POSTCONDITION_ERRORS, hasWorkspaceSuccessExactKeys,
  readWorkspaceSuccessObject } from './workspaceSuccessContracts.mjs';
import { verifyWorkspaceSuccessSessionEvidence } from './workspaceSuccessSessionProof.mjs';
import {
  WORKSPACE_SUCCESS_CHECKPOINTS, captureWorkspaceSuccessProfileEvidence,
  readWorkspaceSuccessProfileState, workspaceSuccessCheckpointPath,
} from './workspaceSuccessProfileEvidence.mjs';

const invalid = (code = 'profileEvidenceInvalid') => { throw new Error(code); };
const EVENT_KEYS = ['appVersion', 'buildRevision', 'eventId', 'eventName', 'runtimeInstanceId'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function validateWorkspaceSuccessCheckpoint(value, { request, checkpoint, state, support }) {
  try {
    if (!hasWorkspaceSuccessExactKeys(value, ['schemaVersion', 'checkpoint', 'runNonce',
      'artifactDescriptorSha256', 'profileState', 'registry', 'accepted', 'journal', 'events']) ||
      value.schemaVersion !== 1 || value.checkpoint !== checkpoint ||
      value.runNonce !== request.runNonce || value.artifactDescriptorSha256 !== request.artifactDescriptorSha256) invalid();
    const profile = support.parseW6b2PackagedWorkspaceProfileState(value.profileState);
    if (profile.buildRevision !== request.buildRevision.slice(0, 12) || !isDeepStrictEqual(
      { ...profile, fixtures: profile.fixtures.map(({ baseline, ...fixture }) => fixture) },
      { ...state, fixtures: state.fixtures.map(({ baseline, ...fixture }) => fixture) })) invalid();
    support.validateWorkspaceRegistry(value.registry);
    support.parseAcceptedBuildMetadata(value.accepted);
    if (value.journal !== null) support.parseUpdateJournal(value.journal);
    if (!Array.isArray(value.events) || value.events.length > 64 || value.events.some((event) =>
      !hasWorkspaceSuccessExactKeys(event, EVENT_KEYS) || !UUID.test(event.eventId) ||
      !UUID.test(event.runtimeInstanceId) || !['desktop.started', 'desktop.shutdownCompleted'].includes(event.eventName) ||
      ![state.sourceVersion, state.targetVersion].includes(event.appVersion) || event.buildRevision !== state.buildRevision) ||
      new Set(value.events.map((event) => event.eventId)).size !== value.events.length) invalid();
    return value;
  } catch { invalid(); }
}

function requirePackageIdentity(actual, role) {
  if (!isDeepStrictEqual(actual, {
    buildRevision: role.buildRevision, msiProductVersion: role.msiProductVersion,
    packageSha256: role.packageSha256, packageSize: role.packageSize,
  })) invalid('profileJournalMismatch');
}

function completedRuntime(evidence, previous, expectedStarts = 1, versions) {
  const oldIds = new Set(previous.events.map((event) => event.eventId));
  if (previous.events.some((event) => !evidence.events.some((current) => isDeepStrictEqual(current, event)))) invalid('profileLifecycleInvalid');
  const fresh = evidence.events.filter((event) => !oldIds.has(event.eventId));
  const starts = fresh.filter((event) => event.eventName === 'desktop.started');
  if (fresh.length !== expectedStarts * 2 || starts.length !== expectedStarts ||
    new Set(starts.map((start) => start.runtimeInstanceId)).size !== expectedStarts ||
    starts.some((start, index) =>
    start.appVersion !== (versions?.[index] ?? evidence.profileState.targetVersion) ||
    fresh.filter((event) => event.eventName === 'desktop.shutdownCompleted' &&
      event.runtimeInstanceId === start.runtimeInstanceId && event.appVersion === start.appVersion &&
      event.buildRevision === start.buildRevision).length !== 1 ||
    previous.events.some((event) => event.runtimeInstanceId === start.runtimeInstanceId))) invalid('profileLifecycleInvalid');
  return starts.at(-1).runtimeInstanceId;
}

export function verifyWorkspaceSuccessCheckpoints({ request, artifact, state, checkpoints, support }) {
  if (!Array.isArray(checkpoints) || checkpoints.length !== WORKSPACE_SUCCESS_CHECKPOINTS.length) invalid();
  const validated = checkpoints.map((value, index) => validateWorkspaceSuccessCheckpoint(value, {
    request, state, support, checkpoint: WORKSPACE_SUCCESS_CHECKPOINTS[index],
  }));
  const [source, target, beforeB, firstB, secondB, rejected] = validated;
  if (!isDeepStrictEqual(source.profileState, state) || source.journal !== null || source.events.length !== 0) invalid();
  if (state.fixtures.some((fixture) => source.registry.workspaces.filter((entry) =>
    entry.workspaceId === fixture.workspaceId && entry.lineageIdentity.profileId === fixture.profileId).length !== 1)) invalid('profileRegistryMismatch');
  for (const [index, evidence] of validated.entries()) {
    const sourceStage = index === 0;
    const activeKey = ['beforeBMigration', 'firstBStartup', 'secondBStartup'].includes(evidence.checkpoint) ? 'B' : 'A';
    const expectedRegistry = { ...source.registry, activeWorkspaceId: state.fixtures.find((f) => f.fixtureKey === activeKey).workspaceId,
      workspaces: source.registry.workspaces.map((entry) => ({ ...entry, lifecycleState:
        !sourceStage && state.fixtures.find((f) => f.fixtureKey === 'C').workspaceId === entry.workspaceId ? 'recoveryRequired' : 'ready' })) };
    if (!isDeepStrictEqual(evidence.registry, expectedRegistry) || evidence.registry.workspaces.length !== 3) invalid('profileRegistryMismatch');
    const role = sourceStage ? artifact.source : artifact.target;
    if (evidence.accepted.appVersion !== role.appVersion || evidence.accepted.buildRevision !== role.buildRevision) invalid('profileAcceptedBuildMismatch');
    if (!sourceStage) {
      if (evidence.journal?.state !== 'accepted' || evidence.journal.currentVersion !== artifact.source.appVersion ||
        evidence.journal.targetVersion !== artifact.target.appVersion) invalid('profileJournalMismatch');
      requirePackageIdentity(evidence.journal.currentPackageIdentity, artifact.source);
      requirePackageIdentity(evidence.journal.candidatePackageIdentity, artifact.target);
      if (!isDeepStrictEqual(evidence.accepted, target.accepted)) invalid('profileAcceptedBuildMismatch');
      if (!isDeepStrictEqual(evidence.journal, target.journal)) invalid('profileJournalMismatch');
    }
    for (const fixture of evidence.profileState.fixtures) {
      const baseline = state.fixtures.find((item) => item.fixtureKey === fixture.fixtureKey).baseline;
      if (!support.w6b2PackagedWorkspaceContentPreserved(baseline, fixture.baseline)) invalid('profileBusinessContentChanged');
      const { database: beforeDatabase, ...beforeContent } = baseline;
      const { database: afterDatabase, ...afterContent } = fixture.baseline;
      if (!isDeepStrictEqual(beforeContent, afterContent)) invalid('profileBusinessContentChanged');
      const changed = !isDeepStrictEqual(beforeDatabase, afterDatabase);
      const shouldChange = !sourceStage && (fixture.fixtureKey === 'A' || (fixture.fixtureKey === 'B' && index >= 3));
      if (changed !== shouldChange) invalid('profileMigrationMismatch');
    }
  }
  // B's second normal startup must be byte-idempotent, not merely different
  // from the source database. Returning to A must not change any business bytes.
  if (!isDeepStrictEqual(target.profileState, beforeB.profileState) ||
    !isDeepStrictEqual(firstB.profileState, secondB.profileState) ||
    !isDeepStrictEqual(secondB.profileState, rejected.profileState)) invalid('profileRestartNotIdempotent');
  completedRuntime(target, source, 2, [state.sourceVersion, state.targetVersion]);
  completedRuntime(beforeB, target);
  const firstId = completedRuntime(firstB, beforeB);
  const secondId = completedRuntime(secondB, firstB);
  if (firstId === secondId) invalid('profileLifecycleInvalid');
  completedRuntime(rejected, secondB, 2);
  return Object.freeze({ status: 'completed', resultCode: 'workspaceSemanticProofValidated' });
}

export async function verifyWorkspaceSuccessSemanticPostcondition(input, {
  captureCurrent = captureWorkspaceSuccessProfileEvidence,
  verifySessions = verifyWorkspaceSuccessSessionEvidence,
} = {}) {
  try {
    const state = await readWorkspaceSuccessProfileState(input.proofRoot, input.support);
    const checkpoints = [];
    for (const checkpoint of WORKSPACE_SUCCESS_CHECKPOINTS) {
      checkpoints.push(await readWorkspaceSuccessObject(workspaceSuccessCheckpointPath(input.proofRoot, checkpoint),
        'profileEvidenceInvalid'));
    }
    const result = verifyWorkspaceSuccessCheckpoints({ ...input, state, checkpoints });
    await verifySessions(input, checkpoints.at(-1).events);
    const current = await captureCurrent({ ...input, checkpoint: 'rejectedC' });
    if (!isDeepStrictEqual(current, checkpoints.at(-1))) invalid('profileCurrentStateChanged');
    return result;
  } catch (error) {
    invalid(WORKSPACE_SUCCESS_POSTCONDITION_ERRORS.includes(error?.message) ? error.message : 'profileEvidenceInvalid');
  }
}
