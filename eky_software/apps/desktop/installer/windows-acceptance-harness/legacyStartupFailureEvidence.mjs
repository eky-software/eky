import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deriveLegacySourceUserDataRoot } from './legacyUpgradeProfileEvidence.mjs';
import { projectBootstrapFailureFields, readDesktopLifecycleEvents } from './legacyUpgradeStartupObserver.mjs';
import { ordinaryPath } from './workspaceEncryptedEvidence.mjs';
import { validateLegacyOriginalExceptionEvidence } from './legacyOriginalExceptionEvidence.mjs';

export const LEGACY_STARTUP_TERMINAL_FILENAME = 'legacy-startup-terminal.json';
const SHA = /^[a-f0-9]{64}$/;
const REVISION = /^[a-f0-9]{7,40}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const invalid = () => { throw new Error('legacyStartupEvidenceInvalid'); };
const matches = (pattern, value) => typeof value === 'string' && pattern.test(value);
const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const identityMatches = (event, target) => event.appVersion === target.appVersion &&
  target.buildRevision.startsWith(event.buildRevision);

export function validateLegacyStartupFailureEvidence(value) {
  if (!exact(value, ['schemaVersion', 'scenarioRunNonce', 'artifactDescriptorSha256', 'targetIdentity', 'status', 'events']) ||
    value.schemaVersion !== 1 || !matches(SHA, value.scenarioRunNonce) || !matches(SHA, value.artifactDescriptorSha256) ||
    !exact(value.targetIdentity, ['appVersion', 'buildRevision']) ||
    typeof value.targetIdentity.appVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(value.targetIdentity.appVersion) ||
    typeof value.targetIdentity.buildRevision !== 'string' || !REVISION.test(value.targetIdentity.buildRevision) ||
    !['recorded', 'notObserved', 'missing', 'unverified'].includes(value.status) ||
    !Array.isArray(value.events) || value.events.length > 2 ||
    (value.status === 'recorded') !== (value.events.length > 0)) invalid();
  const ids = new Set();
  for (const event of value.events) {
    if (!exact(event, ['appVersion', 'buildRevision', 'eventId', 'eventName', 'runtimeInstanceId', 'timestamp',
      'errorCode', 'stage', 'causeStatus']) || event.eventName !== 'desktop.bootstrapFailed' ||
      typeof event.buildRevision !== 'string' || !REVISION.test(event.buildRevision) ||
      !identityMatches(event, value.targetIdentity) || !matches(UUID, event.eventId) || !matches(UUID, event.runtimeInstanceId) ||
      ids.has(event.eventId) || typeof event.timestamp !== 'string' ||
      Number.isNaN(Date.parse(event.timestamp)) || new Date(event.timestamp).toISOString() !== event.timestamp ||
      !['recorded', 'missing', 'unverified'].includes(event.causeStatus)) invalid();
    const projected = projectBootstrapFailureFields(event);
    if (event.errorCode !== projected.errorCode || event.stage !== projected.stage ||
      (event.causeStatus === 'recorded') !== (projected.causeStatus === 'recorded')) invalid();
    ids.add(event.eventId);
  }
  return value;
}

// Read only after the existing owner has proved process-tree absence. The
// existing terminal write preserves this projection before fixture deletion.
export async function readLegacyStartupFailureEvidence({ runRoot, artifact, supervisorResult }) {
  const evidence = { schemaVersion: 1, scenarioRunNonce: supervisorResult.runNonce,
    artifactDescriptorSha256: artifact.descriptorSha256,
    targetIdentity: { appVersion: artifact.target.appVersion, buildRevision: artifact.target.buildRevision },
    status: 'unverified', events: [] };
  if (supervisorResult.processTreeAbsent !== true) return validateLegacyStartupFailureEvidence(evidence);
  try {
    const root = await realpath(runRoot);
    const logDirectory = resolve(deriveLegacySourceUserDataRoot(root, supervisorResult.runNonce),
      'runtime', 'logs', 'desktop');
    await ordinaryPath(root, logDirectory, true);
    const events = (await readDesktopLifecycleEvents(logDirectory, { stopped: true })).filter(event =>
      event.eventName === 'desktop.bootstrapFailed' && identityMatches(event, evidence.targetIdentity));
    evidence.events = events.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
    evidence.status = events.length === 0 ? 'notObserved' : 'recorded';
    return validateLegacyStartupFailureEvidence(evidence);
  } catch (error) {
    evidence.status = error?.code === 'ENOENT' ? 'missing' : 'unverified';
    evidence.events = [];
    return validateLegacyStartupFailureEvidence(evidence);
  }
}

export function startupEvidenceAllowsFixtureRemoval(evidence) {
  validateLegacyStartupFailureEvidence(evidence);
  return evidence.status === 'notObserved' ||
    (evidence.status === 'recorded' && evidence.events.every(event => event.causeStatus === 'recorded'));
}

export function projectLegacyStartupTerminalEvidence(saved) {
  const hasOriginal = Object.hasOwn(saved ?? {}, 'originalExceptionEvidence');
  if (!exact(saved, ['binding', 'outcome', 'startupEvidence', ...(hasOriginal ? ['originalExceptionEvidence'] : [])]) ||
    !exact(saved.binding, ['schemaVersion', 'runNonce', 'scenario', 'artifactDescriptorSha256']) ||
    saved.binding.schemaVersion !== 1 || saved.binding.scenario !== 'acceptanceCommandPhase' ||
    !matches(SHA, saved.binding.runNonce) || !matches(SHA, saved.binding.artifactDescriptorSha256)) invalid();
  const evidence = validateLegacyStartupFailureEvidence(saved.startupEvidence);
  if (evidence.artifactDescriptorSha256 !== saved.binding.artifactDescriptorSha256) invalid();
  return { binding: saved.binding, startupEvidence: evidence,
    ...(hasOriginal ? { originalExceptionEvidence: validateLegacyOriginalExceptionEvidence(saved.originalExceptionEvidence, evidence) } : {}) };
}
