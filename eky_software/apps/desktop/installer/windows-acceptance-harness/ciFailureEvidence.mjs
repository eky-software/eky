import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { appendFile, lstat, mkdir, open, opendir, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  assertWorkspaceInstallerLogReceipt, encryptArchive, evidenceRecipient, ordinaryPath, retain, writeEvidenceArchive,
  EVIDENCE_FILE_MAX_BYTES, EVIDENCE_TOTAL_MAX_BYTES,
} from './workspaceEncryptedEvidence.mjs';
import commandBudgets from '../windows-process-supervisor/supervisorCommandBudgets.json' with { type: 'json' };
import { projectPlaywrightFailureReport } from './playwrightFailureReport.mjs';
import { LEGACY_STARTUP_TERMINAL_FILENAME, projectLegacyStartupTerminalEvidence } from './legacyStartupFailureEvidence.mjs';
import { parseStrictJsonObjectBytes } from './strictJsonObject.mjs';
import { inspectionSandboxProbeBinding } from '../../scripts/profileInspection/linuxProfileInspectionContract.mjs';
import { nativePreparationRecordMaximumBytes, validateNativePreparationEvidence,
  windowsNativePreparationBinding } from '../../scripts/profileInspection/nativeBuildFailureEvidence.mjs';
import { W6B2_INSTALLER_LOG_FILE, W6B2_INSTALLER_LOG_RECEIPT,
  W6B2_INSTALLER_LOG_MAX_BYTES } from '../../src/main/w6b2PackagedInstallerLog.ts';
import { STARTUP_EXCEPTION_CONTROL, STARTUP_EXCEPTION_SUFFIX, STARTUP_EXCEPTION_LIMITS,
  validateStartupExceptionEvidence } from '../../src/main/startupExceptionEvidence.ts';
import { validateRunnerFailureEvidence } from '../../../../test-reporters/runnerFailureEvidence.mjs';
import { msiWindowEvidenceContract, validateMsiWindowEvidence } from './msiWindowEvidence.mjs';
import { readCommandPhaseJson } from './acceptanceCommandPhaseInput.mjs';
import { PHASE_WIRE_LIMITS, validatePhaseHandoffCollector } from '../../e2e/workspaceDeletionPhaseHandoff.ts';
import { MSI_RESOURCE_TIMING_MAX_BYTES, msiResourceTimingBinding, msiResourceTimingSource,
  validateMsiResourceTimingReport } from './msiResourceTimingEvidence.mjs';

const MiB = 1024 * 1024;
const MAX_FILE = EVIDENCE_FILE_MAX_BYTES;
const MAX_TOTAL = EVIDENCE_TOTAL_MAX_BYTES;
const MAX_FILES = 256;
const MAX_ENTRIES = 4096;
const MAX_DEPTH = 9;
const MAX_SOURCE_MILLISECONDS = 5000;
const MAX_DISCOVERY_MILLISECONDS = MAX_SOURCE_MILLISECONDS / 2;
const outcomes = new Set(['success', 'failure', 'cancelled', 'skipped']);
const runPattern = 'run-[a-f0-9-]{36}';
const failure = () => new Error('CI_FAILURE_EVIDENCE_UNVERIFIED');
const commandPhases = new Set(['publishFailure', ...Object.values(commandBudgets)
  .filter(plan => Array.isArray(plan.phases)).flatMap(plan => plan.phases.map(([phase]) => phase))]);

// Source names are test-tool contracts, not a glob over profiles or the runner.
export function evidenceSourceKind(area, path) {
  if (area === 'results' && /^run-[a-f0-9-]{36}\/[^/]+\/failure\.private\.json$/u.test(path)) return 'workspaceDeletionPhaseObservation';
  if (area === 'reports' && new RegExp(`^${runPattern}/results\\.private\\.json$`, 'u').test(path)) return 'playwrightReport';
  if (area === 'results' && new RegExp(`^${runPattern}/[^/]+/(?:backend-startup|process-output|failure)\\.private\\.json$`, 'u').test(path)) return 'processOutput';
  if (area === 'results' && new RegExp(`^${runPattern}/(?!\\.{1,2}/)[^/]+/electron-lifecycle\\.json$`, 'u').test(path)) return 'electronLifecycle';
  if (area !== 'temporary') return null;
  if (/^eky-msi-resource-timing-supervisor-contracts-[01]\/msi-resource-contract\.json$/u.test(path)) return 'msiResourceTiming';
  if (/^eky supervisor [a-zA-Z0-9]+\/(?:policy-result\.json|[1-9][0-9]*-(?:source|target|uninstall)\.log)$/u.test(path)) return 'msiPolicyEvidence';
  if (/^eky-desktop-smoke\/[a-f0-9]{32}\/(?:result\/desktop-smoke-result\.json|smoke-output\.private\.json)$/u.test(path)) return 'packagedSmoke';
  if (/^eky-desktop-smoke\/[a-f0-9]{32}\/result\/[a-f0-9-]{36}\.startup-exception\.private\.json$/u.test(path)) return 'startupException';
  const fixturePrefix = '(?:(?:eky supervisor [a-zA-Z0-9]+/temporary|eky-t-[a-zA-Z0-9]+)/)?';
  if (new RegExp(`^${fixturePrefix}eky-acceptance-command-[a-f0-9]{32}/scenario/${msiWindowEvidenceContract.filenamePrefix}[0-9]{3}\\.private\\.json$`, 'u').test(path)) return 'msiWindowObservation';
  if (new RegExp(`^${fixturePrefix}eky-test-errors-[a-f0-9-]{36}/(?:[0-9]{3}-[a-f0-9-]{36}|[a-f0-9-]{36}\\.summary)\\.private\\.json$`, 'u').test(path)) return 'runnerFailure';
  const workspaceLog = new RegExp(`^${fixturePrefix}eky-workspace-caller-[a-f0-9]{32}/([^/]+)$`, 'u').exec(path);
  if (workspaceLog && [W6B2_INSTALLER_LOG_FILE, W6B2_INSTALLER_LOG_RECEIPT].includes(workspaceLog[1])) return 'workspaceInstallerEvidence';
  if (new RegExp(`^${fixturePrefix}eky-acceptance-command-[a-f0-9]{32}/fixtureCleanup/${LEGACY_STARTUP_TERMINAL_FILENAME.replace('.', '\\.')}$`, 'u').test(path)) return 'legacyStartupEvidence';
  if (new RegExp(`^${fixturePrefix}eky-(?:clean|upgrade|legacy|workspace)-caller-[a-f0-9]{32}/result\\.json$`, 'u').test(path)) return 'nativeResult';
  if (/^eky supervisor [a-zA-Z0-9]+\/(?:result\.json|worker-result\.json|ci-step\.(?:stdout|stderr)\.private|supervisor-(?:[1-9]|1[0-6])\.(?:stdout|stderr)\.private|supervisor-output\.private\.json)$/u.test(path)) return 'nativeResult';
  const command = new RegExp(`^${fixturePrefix}eky-acceptance-command-[a-f0-9]{32}/([^/]+)/(?:result|worker-result)\\.json$`, 'u').exec(path);
  if (command && commandPhases.has(command[1])) return 'nativeResult';
  return null;
}

export function jobEvidenceBinding(env) {
  if (!/^[1-9][0-9]*$/u.test(env.GITHUB_RUN_ID ?? '')
    || !/^[1-9][0-9]*$/u.test(env.GITHUB_RUN_ATTEMPT ?? '')
    || !/^[A-Za-z0-9_-]{1,120}$/u.test(env.GITHUB_JOB ?? '')
    || !/^[A-Za-z0-9_-]{1,120}$/u.test(env.EKY_EVIDENCE_JOB_KEY ?? '')
    || !/^[a-f0-9]{40}$/u.test(env.GITHUB_SHA ?? '')) throw failure();
  return { runId: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT,
    job: env.GITHUB_JOB, jobKey: env.EKY_EVIDENCE_JOB_KEY, sourceRevision: env.GITHUB_SHA };
}

// Only the trusted caller supplies a split-checkout receipt. Never accept a report path from it.
function splitCheckout(env, selection) {
  if (selection === undefined) return null;
  if (!selection || selection.controlSha !== env.GITHUB_SHA || env.GITHUB_ACTIONS !== 'true' ||
      env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_REF !== 'refs/heads/main' ||
      env.RUNNER_ENVIRONMENT !== 'github-hosted' || env.RUNNER_OS !== 'Windows' ||
      !['failure', 'cancelled'].includes(env.EKY_EVIDENCE_JOB_OUTCOME) || env.EKY_MSI_RESOURCE_TIMING_PROOF) throw failure();
  const keys = Object.keys(selection).sort().join(',');
  if (keys === 'controlSha,sourceStatus' && selection.sourceStatus === 'notVerified') return { status: 'notVerified' };
  if (keys !== 'controlSha,sourceCheckout,sourceIdentity,sourceStatus' || selection.sourceStatus !== 'verifiedBeforeWork' ||
      typeof selection.sourceCheckout !== 'string' || !/^[a-f0-9]{40}$/u.test(selection.sourceCheckout) ||
      /^0{40}$/u.test(selection.sourceCheckout) || typeof selection.sourceIdentity !== 'string' ||
      !/^(?:0|[1-9][0-9]{0,38}):[1-9][0-9]{0,38}$/u.test(selection.sourceIdentity)) throw failure();
  return { status: 'verifiedBeforeWork', revision: selection.sourceCheckout, identity: selection.sourceIdentity };
}

export async function collectJobFailureEvidence(env, { nativeTemp = env.RUNNER_TEMP, now = () => performance.now(), sourceSelection } = {}) {
  const binding = jobEvidenceBinding(env);
  const split = splitCheckout(env, sourceSelection);
  const timingBinding = env.EKY_MSI_RESOURCE_TIMING_PROOF === '1' ? msiResourceTimingBinding(env) : null;
  const successful = env.EKY_EVIDENCE_JOB_OUTCOME === 'success';
  const timingOnly = successful && timingBinding !== null;
  const policySuccess = env.GITHUB_ACTIONS === 'true' && env.RUNNER_OS === 'Windows' &&
    env.RUNNER_ENVIRONMENT === 'github-hosted' && env.GITHUB_EVENT_NAME === 'workflow_dispatch' &&
    binding.job === 'msi-file-version-policy' && binding.jobKey === 'msi-policy-0';
  if (successful && !timingBinding && !policySuccess) throw failure();
  const { fingerprint, key } = evidenceRecipient(env);
  const temp = await realpath(env.RUNNER_TEMP);
  const checkout = await realpath(env.GITHUB_WORKSPACE);
  const reportsRoot = split ? join(checkout, 'source') : checkout;
  const native = await realpath(nativeTemp);
  if (split) {
    const outside = (root, other) => {
      const path = relative(root, other);
      return isAbsolute(path) || path === '..' || path.startsWith('..' + sep);
    };
    if (!isAbsolute(env.GITHUB_WORKSPACE) || relative(checkout, env.GITHUB_WORKSPACE) !== '' ||
        !(await lstat(env.GITHUB_WORKSPACE)).isDirectory() ||
        [temp, native].some(path => !outside(checkout, path) || !outside(path, checkout))) throw failure();
  }
  const assertSourceIdentity = async () => {
    await ordinaryPath(checkout, reportsRoot, true);
    const stat = await lstat(reportsRoot, { bigint: true });
    if (!stat.isDirectory() || `${stat.dev}:${stat.ino}` !== split.identity) throw failure();
  };
  if (split?.status === 'verifiedBeforeWork') await assertSourceIdentity();
  const root = join(temp, `eky-job-evidence-${binding.runId}-${binding.attempt}-${binding.jobKey}-${randomUUID()}`);
  await mkdir(root, { mode: 0o700 });
  await writeFile(join(root, 'recipient.asc'), key, { flag: 'wx', mode: 0o600 });
  const stage = join(root, 'retained');
  await mkdir(stage, { mode: 0o700 });
  const manifest = { schemaVersion: 1, binding, scope: timingOnly ? 'msiResourceTimingExperiment' : 'ciFailureEvidence',
    jobOutcome: outcomes.has(env.EKY_EVIDENCE_JOB_OUTCOME) ? env.EKY_EVIDENCE_JOB_OUTCOME : 'unknown',
    cleanup: 'notInferred', unresolvedEvidenceHold: true,
    publicCommandLog: 'githubWorkflowLog', files: [], sources: [],
    exclusions: ['databases', 'profiles', 'environment', 'configuration', 'unreviewedTraces', 'memoryDumps', 'dependencyToolRawOutput'] };
  if (split) manifest.sourceCheckout = split.revision ? { status: split.status, revision: split.revision } : { status: split.status };
  if (timingBinding) manifest.approvedExceptions = ['boundedMsiResourceTiming'];
  const linuxCompilation = binding.job === inspectionSandboxProbeBinding.job && binding.jobKey === inspectionSandboxProbeBinding.jobKey;
  const windowsCompilation = binding.job === windowsNativePreparationBinding.job && binding.jobKey === windowsNativePreparationBinding.jobKey;
  if (linuxCompilation || windowsCompilation) {
    manifest.approvedExceptions = ['boundedNativeBuildFailure'];
    manifest.exclusions = manifest.exclusions.map(value => value === 'dependencyToolRawOutput'
      ? 'unapprovedDependencyToolRawOutput' : value);
  }
  let total = 0;
  const select = async (base, path, area, location, relativePath) => {
    const kind = evidenceSourceKind(area, relativePath);
    if (kind === null) return;
    if (kind === 'msiResourceTiming' && (!timingBinding || relativePath !== msiResourceTimingSource(timingBinding))) return;
    if (manifest.files.length >= MAX_FILES) return;
    const name = `${String(manifest.files.length).padStart(4, '0')}.private`;
    const entry = { name, source: `${area}/${relativePath}`, location, kind, status: 'unverified' };
    manifest.files.push(entry);
    try {
      if (split && area !== 'temporary') await assertSourceIdentity();
      const info = await ordinaryPath(base, path);
      const installerLog = kind === 'workspaceInstallerEvidence' && relativePath.endsWith('/' + W6B2_INSTALLER_LOG_FILE);
      const nativePreparation = kind === 'processOutput' && windowsCompilation &&
        relativePath.endsWith('/preparation/process-output.private.json');
      const fileLimit = kind === 'msiResourceTiming' ? MSI_RESOURCE_TIMING_MAX_BYTES :
        kind === 'workspaceDeletionPhaseObservation' ? PHASE_WIRE_LIMITS.bytes : installerLog ? W6B2_INSTALLER_LOG_MAX_BYTES :
        kind === 'msiWindowObservation' ? msiWindowEvidenceContract.maximumBytes :
        nativePreparation ? nativePreparationRecordMaximumBytes :
          ['startupException', 'runnerFailure'].includes(kind) ? STARTUP_EXCEPTION_LIMITS.fileBytes : MAX_FILE;
      if (info.size > fileLimit) { entry.status = 'tooLarge'; return; }
      if (info.size > MAX_TOTAL - total) { entry.status = 'totalLimit'; return; }
      let proof = await retain(base, path, join(stage, name), Math.min(fileLimit, MAX_TOTAL - total));
      if (kind === 'msiResourceTiming') validateMsiResourceTimingReport(await readFile(join(stage, name)), timingBinding, relativePath);
      if (kind === 'workspaceDeletionPhaseObservation' &&
          validatePhaseHandoffCollector(await readFile(join(stage, name)), binding, relativePath) === undefined) throw failure();
      if (kind === 'processOutput') {
        const bytes = await readFile(join(stage, name));
        const record = parseStrictJsonObjectBytes(bytes, { errorCode: 'nativePreparationEvidenceInvalid', maximumBytes: MAX_FILE });
        if (record.operation === 'electronE2ePreparation') {
          if (!nativePreparation || bytes.length > nativePreparationRecordMaximumBytes) throw failure();
          validateNativePreparationEvidence(record, binding, relativePath.split('/')[0].slice(4));
        } else if (Object.hasOwn(record, 'nativeCompilationEvidence') &&
          (!linuxCompilation || !relativePath.endsWith('/preparation/process-output.private.json') ||
            record.operation !== 'linuxProfileInspection' || record.phase !== 'preparation' ||
            record.causeCode !== 'PROFILE_INSPECTION_NATIVE_BUILD_FAILED')) throw failure();
      }
      if (installerLog) {
        await assertWorkspaceInstallerLogReceipt(dirname(path), proof);
      }
      if (kind === 'msiWindowObservation') {
        const observation = validateMsiWindowEvidence(parseStrictJsonObjectBytes(await readFile(join(stage, name)),
          { errorCode: 'msiWindowEvidenceInvalid', maximumBytes: msiWindowEvidenceContract.maximumBytes }), binding, relativePath);
        const requestPath = join(dirname(path), 'request.json');
        const requestInfo = await ordinaryPath(base, requestPath);
        if (requestInfo.size > MiB) throw failure();
        // Read only for binding; never copy the request, command or arguments into evidence.
        const request = await readCommandPhaseJson(requestPath);
        // Only the configured temporary parent may be an alias. ordinaryPath
        // above still requires every child directory and file to be canonical and link-free.
        const workingDirectories = [dirname(path)];
        for (const [configuredRoot, canonicalRoot] of [[env.RUNNER_TEMP, temp], [nativeTemp, native]]) {
          if (canonicalRoot === base) workingDirectories.push(resolve(configuredRoot, dirname(relativePath)));
        }
        if (request.schemaVersion !== 1 ||
            ['runNonce', 'scenario', 'artifactDescriptorSha256'].some(key => request[key] !== observation[key]) ||
            !workingDirectories.includes(request.workingDirectory)) throw failure();
      }
      if (kind === 'runnerFailure') {
        const record = validateRunnerFailureEvidence(parseStrictJsonObjectBytes(await readFile(join(stage, name)),
          { errorCode: 'runnerFailureEvidenceInvalid', maximumBytes: STARTUP_EXCEPTION_LIMITS.fileBytes }));
        const source = record.binding;
        if (source.kind !== 'github' || ['runId', 'attempt', 'job', 'sourceRevision'].some(key => source[key] !== binding[key]) ||
            (source.jobKeySource === 'explicit' ? source.jobKey !== binding.jobKey : source.jobKey !== binding.job) ||
            basename(dirname(path)) !== `eky-test-errors-${record.invocationId}` ||
            basename(path).endsWith('.summary.private.json') !== (record.kind === 'runnerFailureSummary') ||
            (record.kind === 'runnerFailure' && !basename(path).startsWith(`${String(record.sequence).padStart(3, '0')}-`)) ||
            (record.kind === 'runnerFailureSummary' && basename(path) !== `${record.invocationId}.summary.private.json`)) throw failure();
        if (record.kind === 'runnerFailureSummary') entry.deliveryStatus = record.status;
      }
      if (kind === 'startupException') {
        const record = validateStartupExceptionEvidence(parseStrictJsonObjectBytes(await readFile(join(stage, name)),
          { errorCode: 'startupExceptionEvidenceInvalid', maximumBytes: STARTUP_EXCEPTION_LIMITS.fileBytes }));
        const controlPath = join(dirname(path), STARTUP_EXCEPTION_CONTROL);
        const before = await ordinaryPath(base, controlPath);
        if (before.size > 4096) throw failure();
        const controlBytes = await readFile(controlPath);
        const after = await ordinaryPath(base, controlPath);
        if (controlBytes.length !== before.size || ['ino', 'dev', 'size', 'mtimeMs', 'ctimeMs'].some(key => before[key] !== after[key])) throw failure();
        const control = parseStrictJsonObjectBytes(controlBytes, { errorCode: 'startupExceptionEvidenceInvalid', maximumBytes: 4096 });
        if (Object.keys(control).sort().join(',') !== 'appVersion,buildRevision,scenarioRunNonce,schemaVersion' ||
            control.schemaVersion !== 1 || control.scenarioRunNonce !== record.scenarioRunNonce ||
            control.appVersion !== record.appVersion || typeof control.buildRevision !== 'string' ||
            !/^[a-f0-9]{7,40}$/u.test(control.buildRevision) ||
            !control.buildRevision.startsWith(record.buildRevision) ||
            !(split ? split.revision : binding.sourceRevision)?.startsWith(control.buildRevision) ||
            basename(dirname(dirname(path))) !== record.scenarioRunNonce.slice(0, 32) ||
            basename(path) !== `${record.runtimeInstanceId}${STARTUP_EXCEPTION_SUFFIX}`) throw failure();
      }
      if (kind === 'playwrightReport' || kind === 'legacyStartupEvidence') {
        const project = kind === 'playwrightReport' ? projectPlaywrightFailureReport : projectLegacyStartupTerminalEvidence;
        const retained = await readFile(join(stage, name));
        const value = kind === 'legacyStartupEvidence'
          ? parseStrictJsonObjectBytes(retained, { errorCode: 'legacyStartupEvidenceInvalid', maximumBytes: MAX_FILE })
          : JSON.parse(retained.toString('utf8'));
        const bytes = Buffer.from(JSON.stringify(project(value)));
        if (bytes.length > MAX_FILE || bytes.length > MAX_TOTAL - total) { entry.status = 'tooLarge'; return; }
        entry.sourceProof = proof;
        entry.projection = kind === 'playwrightReport' ? 'failureFieldsWithoutConfigurationOrInlineAttachments'
          : Object.hasOwn(value, 'originalExceptionEvidence')
            ? 'boundStartupExceptionWithoutOutcomeOrProfile'
            : 'boundBootstrapCauseAndStageWithoutOutcomeOrProfile';
        await writeFile(join(stage, name), bytes);
        proof = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
      }
      if (split && area !== 'temporary') await assertSourceIdentity();
      total += proof.bytes;
      Object.assign(entry, proof, { status: 'retained' });
    } catch (error) { entry.status = error.code === 'ENOENT' ? 'missing' : 'unverified'; }
  };
  if (timingBinding) {
    const source = msiResourceTimingSource(timingBinding);
    await select(temp, join(temp, source), 'temporary', 'runnerTemp', source);
    const retained = manifest.files.some(file => file.kind === 'msiResourceTiming' && file.status === 'retained');
    manifest.sources.push({ area: 'msiResourceTiming', location: 'runnerTemp', status: retained ? 'complete' : 'unverified',
      examinedEntries: 1, fileLimit: 1 });
    if (timingOnly && !retained) throw failure();
  }
  for (const [area, location, base, start] of timingOnly ? [] : [
    ['reports', 'checkout', checkout, join(reportsRoot, 'eky_software/apps/e2e/playwright-report')],
    ['results', 'checkout', checkout, join(reportsRoot, 'eky_software/apps/e2e/test-results')],
    ['temporary', 'runnerTemp', temp, temp],
    ...(native === temp ? [] : [['temporary', 'nativeTemp', native, native]]),
  ]) {
    const fileLimit = area === 'temporary' && native === temp ? MAX_FILES / 2 : MAX_FILES / 4;
    const source = { area, location, status: 'complete', examinedEntries: 0, fileLimit };
    manifest.sources.push(source);
    if (split?.status === 'notVerified' && area !== 'temporary') {
      source.status = 'unverified';
      continue;
    }
    const firstFile = manifest.files.length;
    const candidates = [];
    const startedAt = now();
    const deadline = startedAt + MAX_SOURCE_MILLISECONDS;
    const discoveryDeadline = startedAt + MAX_DISCOVERY_MILLISECONDS;
    const exhausted = () => manifest.files.length - firstFile >= fileLimit
      || now() >= deadline;
    const walk = async (directory, prefix, depth) => {
      if (depth > MAX_DEPTH || source.examinedEntries >= MAX_ENTRIES || now() >= discoveryDeadline || manifest.files.length >= MAX_FILES) {
        source.status = 'limited'; return;
      }
      if (directory !== base) await ordinaryPath(base, directory, true);
      const entries = [];
      for await (const item of await opendir(directory)) {
        if (now() >= discoveryDeadline) { source.status = 'limited'; break; }
        if (depth === 0 && area === 'temporary' && !/^(?:eky supervisor |eky-(?:test-errors-|t-|acceptance-command-|desktop-smoke$|(?:clean|upgrade|legacy|workspace)-caller-))/u.test(item.name)) continue;
        // Before a verified checkout only direct, run-bound reporter failures can be attributed to this job.
        if (depth === 0 && split?.status === 'notVerified' && !/^eky-test-errors-[a-f0-9-]{36}$/u.test(item.name)) continue;
        if (depth === 0 && area !== 'temporary' && !new RegExp(`^${runPattern}$`, 'u').test(item.name)) continue;
        if (++source.examinedEntries > MAX_ENTRIES) { source.status = 'limited'; break; }
        const path = join(directory, item.name);
        const rel = prefix ? `${prefix}/${item.name}` : item.name;
        let modified = 0;
        try { modified = (await lstat(path)).mtimeMs; } catch { source.status = 'partial'; }
        entries.push({ item, path, rel, modified });
      }
      // Current reports get their own quota; newest native roots precede retained earlier tests.
      const runnerDirectory = /^eky-test-errors-[a-f0-9-]{36}$/u.test(basename(directory));
      entries.sort((left, right) => runnerDirectory
        ? Number(right.item.name.endsWith('.summary.private.json')) - Number(left.item.name.endsWith('.summary.private.json')) ||
          left.item.name.localeCompare(right.item.name)
        : right.modified - left.modified || left.rel.localeCompare(right.rel));
      for (const { item, path, rel } of entries) {
        if (now() >= discoveryDeadline || manifest.files.length >= MAX_FILES) { source.status = 'limited'; break; }
        if (split?.status === 'notVerified' && depth > 0 && (item.isDirectory() || evidenceSourceKind(area, rel) !== 'runnerFailure')) continue;
        if (item.isDirectory()) {
          if (['node_modules', '.npm-cache', 'cache', 'user-data', 'profiles', 'database', 'storage'].includes(item.name)) continue;
          try { await walk(path, rel, depth + 1); } catch { source.status = 'partial'; }
        } else if (item.isSymbolicLink()) {
          source.status = 'partial';
          if (evidenceSourceKind(area, rel)) candidates.push({ path, rel });
        } else if (item.isFile() && evidenceSourceKind(area, rel)) candidates.push({ path, rel });
      }
    };
    try { await walk(start, '', 0); }
    catch (error) { source.status = error.code === 'ENOENT' ? 'missing' : 'unverified'; }
    // Reserve half the unchanged source budget for retaining already found evidence.
    // Reserve each invocation's summary and first error before repeated errors.
    const invocationOffsets = new Map();
    const ordered = candidates.map(item => {
      const kind = evidenceSourceKind(area, item.rel);
      let round = 0;
      if (kind === 'runnerFailure' && !basename(item.path).endsWith('.summary.private.json')) {
        const invocation = dirname(item.path);
        const offset = invocationOffsets.get(invocation) ?? 0;
        invocationOffsets.set(invocation, offset + 1);
        round = offset;
      }
      return { ...item, priority: kind === 'runnerFailure' ? 0 : kind === 'msiWindowObservation' ? 1 : 2, round };
    });
    ordered.sort((left, right) => left.priority - right.priority || left.round - right.round);
    for (const { path, rel } of ordered) {
      if (exhausted() || manifest.files.length >= MAX_FILES) { source.status = 'limited'; break; }
      await select(base, path, area, location, rel);
    }
  }
  if (split?.status === 'verifiedBeforeWork') await assertSourceIdentity();
  const archivePath = join(root, 'evidence.private.json.gz');
  await writeEvidenceArchive({ temp, stage, archivePath, manifest });
  return { root, archivePath, fingerprint, manifest };
}

export function jobEvidenceGit(env, platform = process.platform) {
  const tools = { win32: { runner: 'Windows', git: 'git.exe' }, linux: { runner: 'Linux', git: 'git' } }[platform];
  if (!tools || env.RUNNER_OS !== tools.runner
    || env.GITHUB_ACTIONS !== 'true' || env.RUNNER_ENVIRONMENT !== 'github-hosted'
    || !['push', 'schedule', 'workflow_dispatch', 'pull_request'].includes(env.GITHUB_EVENT_NAME)) throw failure();
  return tools.git;
}

export async function runJobEvidence(env = process.env) {
  const git = jobEvidenceGit(env);
  if (!isAbsolute(env.GITHUB_OUTPUT ?? '') || !isAbsolute(env.GITHUB_EVENT_PATH ?? '')) throw failure();
  const eventInfo = await lstat(env.GITHUB_EVENT_PATH);
  if (!eventInfo.isFile() || eventInfo.isSymbolicLink() || eventInfo.size > 2 * MiB) throw failure();
  const event = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8'));
  if (env.GITHUB_EVENT_NAME === 'pull_request' &&
    (!env.GITHUB_REPOSITORY || event.pull_request?.head?.repo?.full_name !== env.GITHUB_REPOSITORY)) throw failure();
  if (event.pull_request && event.pull_request.head?.repo?.full_name !== env.GITHUB_REPOSITORY) throw failure();
  await new Promise((accept, reject) => {
    execFile(git, ['rev-parse', 'HEAD'], { cwd: env.GITHUB_WORKSPACE,
      timeout: 10_000, maxBuffer: 4096, windowsHide: true }, (error, stdout) => {
      if (error || stdout.trim() !== env.GITHUB_SHA) reject(failure()); else accept();
    });
  });
  const collected = await collectJobFailureEvidence(env, { nativeTemp: tmpdir() });
  await appendFile(env.GITHUB_OUTPUT, await sealAndDescribe(env, collected));
}

async function sealAndDescribe(env, collected) {
  await encryptArchive(collected.root, collected, true);
  const ciphertext = join(collected.root, 'evidence.json.gz.gpg');
  const info = await ordinaryPath(await realpath(env.RUNNER_TEMP), ciphertext);
  if (info.size === 0 || info.size > MAX_TOTAL * 2) throw failure();
  console.log(JSON.stringify({ operation: 'ciFailureEvidence', status: 'sealed',
    retainedFiles: collected.manifest.files.filter(file => file.status === 'retained').length,
    missingOrRejectedFiles: collected.manifest.files.filter(file => file.status !== 'retained').length,
    sourceCoverage: collected.manifest.sources.map(({ area, status }) => ({ area, status })) }));
  return `ciphertext=${ciphertext}\nsealed=true\n`;
}

// Roll back through the same handle, never through a pathname that may have changed.
export async function publishToEmptyStepOutput(handle, result, verifyOutput) {
  await verifyOutput(0n);
  try {
    await handle.writeFile(result);
    await verifyOutput(BigInt(Buffer.byteLength(result)));
  } catch (error) {
    try { await handle.truncate(0); }
    catch (cleanup) { throw new AggregateError([error, cleanup], 'CI_FAILURE_EVIDENCE_UNVERIFIED', { cause: error }); }
    throw error;
  }
}

// Called only by the split-checkout controller while it owns the source read reservation.
// A command-file handle publishes the ciphertext path, never an input-selected result path.
export async function sealSplitJobFailureEvidence(env, sourceSelection) {
  if (process.platform !== 'win32' || !splitCheckout(env, sourceSelection)) throw failure();
  const temp = await realpath(env.RUNNER_TEMP);
  const output = env.GITHUB_OUTPUT;
  if (!isAbsolute(output ?? '') || /[\r\n]/u.test(temp) ||
      relative(join(temp, '_runner_file_commands'), dirname(output)) !== '' ||
      !/^set_output_[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(basename(output))) throw failure();
  await ordinaryPath(temp, output);
  const handle = await open(output, 'r+');
  try {
    const initial = await handle.stat({ bigint: true });
    const verifyOutput = async (size) => {
      await ordinaryPath(temp, output);
      const current = await lstat(output, { bigint: true });
      if (!initial.isFile() || initial.nlink !== 1n || initial.size !== 0n ||
          current.dev !== initial.dev || current.ino !== initial.ino || current.nlink !== 1n || current.size !== size) throw failure();
    };
    await verifyOutput(0n);
    const collected = await collectJobFailureEvidence(env, { nativeTemp: tmpdir(), sourceSelection });
    const result = await sealAndDescribe(env, collected);
    await publishToEmptyStepOutput(handle, result, verifyOutput);
  } finally { await handle.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runJobEvidence().catch(() => { console.error('CI_FAILURE_EVIDENCE_UNVERIFIED'); process.exitCode = 1; });
}
