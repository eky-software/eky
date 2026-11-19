import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ordinaryPath } from './workspaceEncryptedEvidence.mjs';
import { parseStrictJsonObjectBytes } from './strictJsonObject.mjs';

export const MSI_RESOURCE_TIMING_MAX_BYTES = 64 * 1024;
const filename = 'msi-resource-contract.json';
const error = () => new Error('MSI_RESOURCE_TIMING_EVIDENCE_INVALID');
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === keys.slice().sort().join(',');
const uint = value => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const time = value => Number.isSafeInteger(value) && value >= 0 && value <= 120_000;
const state = value => ['live', 'exited', 'unknown'].includes(value);
const bindingKeys = ['runId', 'attempt', 'job', 'jobKey', 'sourceRevision', 'repetition'];
const armKeys = ['kind', 'captureEntryMs', 'afterQueryMs', 'captureReturnMs', 'releaseRequestedMs', 'exitObservedMs',
  'entryState', 'afterQueryState', 'returnState', 'queryStatus', 'queryPhase', 'nativeCode', 'endSessionCode',
  'holderPresent', 'holderLiveOwned', 'exitCode', 'releaseSettled'];

export function msiResourceTimingBinding(env) {
  const index = /^supervisor-contracts-([01])$/u.exec(env.EKY_EVIDENCE_JOB_KEY ?? '');
  if (env.EKY_MSI_RESOURCE_TIMING_PROOF !== '1' || env.GITHUB_ACTIONS !== 'true' ||
      env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.RUNNER_OS !== 'Windows' ||
      env.RUNNER_ENVIRONMENT !== 'github-hosted' || env.GITHUB_JOB !== 'job-object-feasibility' || !index ||
      index[0] !== env.EKY_EVIDENCE_JOB_KEY ||
      env.EKY_MSI_RESOURCE_TIMING_REPETITION !== String(Number(index[1]) + 1) ||
      !/^[1-9][0-9]*$/u.test(env.GITHUB_RUN_ID ?? '') || !/^[1-9][0-9]*$/u.test(env.GITHUB_RUN_ATTEMPT ?? '') ||
      !/^[a-f0-9]{40}$/u.test(env.GITHUB_SHA ?? '')) throw error();
  return { runId: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT, job: env.GITHUB_JOB,
    jobKey: env.EKY_EVIDENCE_JOB_KEY, sourceRevision: env.GITHUB_SHA,
    repetition: Number(env.EKY_MSI_RESOURCE_TIMING_REPETITION) };
}

export function msiResourceTimingSource(binding) {
  if (!['supervisor-contracts-0', 'supervisor-contracts-1'].includes(binding.jobKey)) throw error();
  return `eky-msi-resource-timing-${binding.jobKey}/${filename}`;
}

export function validateMsiResourceTiming(value) {
  if (!exact(value, ['releaseDelayMs', 'resourceCount', 'positiveControl', 'arms']) || value.releaseDelayMs !== 150 ||
      value.resourceCount !== 2550 || value.positiveControl !== true || !Array.isArray(value.arms) || value.arms.length !== 2) throw error();
  for (const [index, arm] of value.arms.entries()) {
    if (!exact(arm, armKeys) || arm.kind !== ['withoutQuery', 'withQuery'][index] ||
        !time(arm.releaseRequestedMs) || arm.releaseRequestedMs < value.releaseDelayMs ||
        !time(arm.exitObservedMs) || arm.exitObservedMs < arm.releaseRequestedMs ||
        !uint(arm.exitCode) || typeof arm.releaseSettled !== 'boolean') throw error();
    const queryFields = ['captureEntryMs', 'afterQueryMs', 'captureReturnMs', 'entryState', 'afterQueryState',
      'returnState', 'queryStatus', 'queryPhase', 'nativeCode', 'endSessionCode', 'holderPresent', 'holderLiveOwned'];
    if (index === 0) {
      if (queryFields.some(key => arm[key] !== null)) throw error();
      continue;
    }
    if (!time(arm.captureEntryMs) || !time(arm.captureReturnMs) || arm.captureReturnMs < arm.captureEntryMs ||
        !state(arm.entryState) || !state(arm.returnState) ||
        !['observed', 'limited', 'unavailable', 'cancelled'].includes(arm.queryStatus) ||
        !['selection', 'startSession', 'registerResources', 'queryResources', 'membership', 'complete'].includes(arm.queryPhase) ||
        ![arm.nativeCode, arm.endSessionCode].every(code => code === null || uint(code)) ||
        typeof arm.holderPresent !== 'boolean' || typeof arm.holderLiveOwned !== 'boolean' ||
        (arm.holderLiveOwned && !arm.holderPresent)) throw error();
    if (arm.afterQueryMs === null ? arm.afterQueryState !== null :
      !time(arm.afterQueryMs) || arm.afterQueryMs < arm.captureEntryMs || arm.afterQueryMs > arm.captureReturnMs ||
      !state(arm.afterQueryState)) throw error();
    if (arm.queryStatus === 'observed' && (arm.queryPhase !== 'complete' || arm.nativeCode !== 0 || arm.endSessionCode !== 0)) throw error();
  }
  return value;
}

export function validateMsiResourceTimingReport(bytes, binding, source = msiResourceTimingSource(binding)) {
  const value = parseStrictJsonObjectBytes(bytes, { errorCode: error().message, maximumBytes: MSI_RESOURCE_TIMING_MAX_BYTES });
  if (!exact(value, ['schemaVersion', 'operation', 'binding', 'runNonce', 'scenario', 'artifactDescriptorSha256', 'timing', 'cleanup']) ||
      value.schemaVersion !== 1 || value.operation !== 'msiResourceTimingExperiment' ||
      !exact(value.binding, bindingKeys) || bindingKeys.some(key => value.binding[key] !== binding[key]) ||
      source !== msiResourceTimingSource(binding) || typeof value.runNonce !== 'string' || value.runNonce.length !== 64 ||
      !/^[a-f0-9]{64}$/u.test(value.runNonce) ||
      value.scenario !== 'packagedWorkspaceSuccess' || typeof value.artifactDescriptorSha256 !== 'string' ||
      value.artifactDescriptorSha256.length !== 64 || !/^[a-f0-9]{64}$/u.test(value.artifactDescriptorSha256) ||
      !exact(value.cleanup, ['nativeTreesAbsent', 'syntheticBytesPreserved', 'releaseThreadsSettled', 'outerRootCleanup']) ||
      !['nativeTreesAbsent', 'syntheticBytesPreserved', 'releaseThreadsSettled'].every(key => typeof value.cleanup[key] === 'boolean') ||
      value.cleanup.outerRootCleanup !== 'notInferred') throw error();
  validateMsiResourceTiming(value.timing);
  return value;
}

// Retain only the approved projection before the successful native fixture root is removed.
export async function publishMsiResourceTimingReport(env, request, fixture) {
  const binding = msiResourceTimingBinding(env);
  if (!exact(fixture, ['schemaVersion', 'checks', 'timing']) || fixture.schemaVersion !== 1 ||
      !fixture.checks || typeof fixture.checks !== 'object' || Array.isArray(fixture.checks)) throw error();
  validateMsiResourceTiming(fixture.timing);
  const bytesChecks = Object.entries(fixture.checks).filter(([key]) => key.startsWith('bytesPreserved'));
  const value = { schemaVersion: 1, operation: 'msiResourceTimingExperiment', binding,
    runNonce: request.runNonce, scenario: request.scenario, artifactDescriptorSha256: request.artifactDescriptorSha256,
    timing: fixture.timing, cleanup: { nativeTreesAbsent: fixture.checks.bothTreesAbsent === true,
      syntheticBytesPreserved: bytesChecks.length >= 3 && bytesChecks.every(([, passed]) => passed === true) &&
        fixture.checks.timingBulkBytesPreserved === true,
      releaseThreadsSettled: fixture.timing.arms.every(arm => arm.releaseSettled === true), outerRootCleanup: 'notInferred' } };
  const bytes = Buffer.from(JSON.stringify(value));
  validateMsiResourceTimingReport(bytes, binding);
  const root = await realpath(env.RUNNER_TEMP);
  const directory = join(root, `eky-msi-resource-timing-${binding.jobKey}`);
  await mkdir(directory, { mode: 0o700 });
  await ordinaryPath(root, directory, true);
  const path = join(directory, filename);
  await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
  const info = await ordinaryPath(root, path);
  if (info.size !== bytes.length || !(await readFile(path)).equals(bytes)) throw error();
  return { bytes: bytes.length };
}
