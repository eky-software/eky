import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, lstat, mkdir, open, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { createGzip } from 'node:zlib';
import { validateWorkspaceCallerBinding, validateWorkspaceCallerResult, workspaceCallerResultIdentity } from './workspaceCallerResult.mjs';
import encryptionFailureCodes from './encryptedEvidenceFailureCodes.json' with { type: 'json' };
import { W6B2_INSTALLER_LOG_FILE, W6B2_INSTALLER_LOG_RECEIPT,
  W6B2_INSTALLER_LOG_MAX_BYTES } from '../../src/main/w6b2PackagedInstallerLog.ts';
import { readCommandPhaseJson } from './acceptanceCommandPhaseInput.mjs';

const MiB = 1024 * 1024;
export const EVIDENCE_FILE_MAX_BYTES = 64 * MiB;
export const EVIDENCE_TOTAL_MAX_BYTES = 512 * MiB;
const MAX_TOTAL = EVIDENCE_TOTAL_MAX_BYTES;
const OUTCOMES = new Set(['success', 'failure', 'cancelled', 'skipped', 'unknown']);
const HERE = dirname(fileURLToPath(import.meta.url));
const DELIVERY_PROOF_MODE = 'encrypted-evidence-delivery-proof';
const DELIVERY_PROOF_SCENARIO = 'syntheticEncryptedEvidenceDelivery';
const DELIVERY_PROOF_FILE = 'command-export.stderr.private.log';
const DELIVERY_PROOF_BYTES = Buffer.from('EKY synthetic encrypted delivery proof v1\n', 'utf8');
const ENCRYPTION_FAILURE_CODES = new Set(encryptionFailureCodes);
const HELPER_START_FAILED = 'EVIDENCE_HELPER_START_FAILED';
const FAULT_SCENARIOS = new Set([
  'acceptanceInterruption', 'activeWorkspaceFirstStartFailure', 'passiveWorkspaceMigrationFailure',
]);
const CAPTURE_FILES = Object.freeze({
  'capture.etl': 256 * MiB,
  'event-statistics.private.log': EVIDENCE_FILE_MAX_BYTES,
  'event-statistics.stderr.private.log': EVIDENCE_FILE_MAX_BYTES,
  'command-export.private.log': 128 * MiB,
  'command-export.stderr.private.log': EVIDENCE_FILE_MAX_BYTES,
  'export-metadata.private.json': MiB,
  'event-statistics.failure.private.txt': EVIDENCE_FILE_MAX_BYTES,
  'analyze.failure.private.txt': EVIDENCE_FILE_MAX_BYTES,
  'start.failure.private.txt': EVIDENCE_FILE_MAX_BYTES,
  'stop.failure.private.txt': EVIDENCE_FILE_MAX_BYTES,
  'start.private.log': EVIDENCE_FILE_MAX_BYTES,
  'start.stderr.private.log': EVIDENCE_FILE_MAX_BYTES,
  'stop.private.log': EVIDENCE_FILE_MAX_BYTES,
  'stop.stderr.private.log': EVIDENCE_FILE_MAX_BYTES,
  'before.private.log': EVIDENCE_FILE_MAX_BYTES,
  'before.stderr.private.log': EVIDENCE_FILE_MAX_BYTES,
  'after.private.log': EVIDENCE_FILE_MAX_BYTES,
  'after.stderr.private.log': EVIDENCE_FILE_MAX_BYTES,
  'after-cancel.private.log': EVIDENCE_FILE_MAX_BYTES,
  'after-cancel.stderr.private.log': EVIDENCE_FILE_MAX_BYTES,
  'collectors-before-stop.private.log': EVIDENCE_FILE_MAX_BYTES,
  'collectors-before-stop.stderr.private.log': EVIDENCE_FILE_MAX_BYTES,
});
function fail() { throw new Error('WORKSPACE_ENCRYPTED_EVIDENCE_UNVERIFIED'); }
function outcome(value) { return OUTCOMES.has(value) ? value : 'unknown'; }

class RetentionFailure extends Error {
  constructor(reason) {
    super('WORKSPACE_ENCRYPTED_EVIDENCE_UNVERIFIED');
    this.reason = reason;
  }
}
function rejectRetention(reason) { throw new RetentionFailure(reason); }

export function retentionFailureCode(error) {
  if (error instanceof RetentionFailure) return error.reason;
  switch (error?.code) {
    case 'ENOENT': return 'sourceMissing';
    case 'EACCES': case 'EPERM': return 'accessDenied';
    case 'ENOSPC': return 'storageFull';
    case 'EIO': return 'ioFailure';
    default: return 'unclassified';
  }
}

export async function assertWorkspaceInstallerLogReceipt(callerRoot, proof, expectedBinding) {
  const binding = validateWorkspaceCallerBinding(await readCommandPhaseJson(join(callerRoot, 'binding.json')));
  const identity = workspaceCallerResultIdentity(join(callerRoot, 'result.json'), {
    expectedBuildRevision: binding.buildRevision, expectedDescriptorSha256: binding.artifactDescriptorSha256,
    ...(binding.faultScenario === null ? {} : { faultScenario: binding.faultScenario }),
  });
  const receipt = await readCommandPhaseJson(join(callerRoot, W6B2_INSTALLER_LOG_RECEIPT));
  if (identity.invocationId !== binding.invocationId ||
      (expectedBinding && !isDeepStrictEqual(binding, expectedBinding)) ||
      !isDeepStrictEqual(receipt.binding, binding) || receipt.status !== 'retained' ||
      receipt.bytes !== proof.bytes || receipt.sha256 !== proof.sha256) {
    throw new Error('workspaceInstallerLogUnverified');
  }
}

// Only known files below the caller's private temp directory may enter the envelope.
export async function ordinaryPath(root, path, directory = false) {
  const base = await realpath(root);
  const rel = relative(base, resolve(path));
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) rejectRetention('pathRejected');
  const parts = rel.split(sep);
  let current = base;
  let stat;
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    stat = await lstat(current);
    if (stat.isSymbolicLink() || await realpath(current) !== current) rejectRetention('pathRejected');
    if (index < parts.length - 1 || directory) { if (!stat.isDirectory()) rejectRetention('pathRejected'); }
    else if (!stat.isFile() || stat.nlink !== 1) rejectRetention('pathRejected');
  }
  return stat;
}

export async function retain(root, source, destination, limit) {
  const before = await ordinaryPath(root, source);
  if (before.size > limit) rejectRetention('sizeLimitExceeded');
  const input = await open(source, 'r');
  try {
    const identity = await input.stat();
    if (!identity.isFile() || identity.nlink !== 1 || identity.ino !== before.ino || identity.dev !== before.dev) {
      rejectRetention('identityChanged');
    }
    const output = await open(destination, 'wx', 0o600);
    const hash = createHash('sha256');
    let bytes = 0;
    try {
      const buffer = Buffer.alloc(64 * 1024);
      for (;;) {
        const { bytesRead } = await input.read(buffer, 0, buffer.length, null);
        if (!bytesRead) break;
        bytes += bytesRead;
        if (bytes > limit) rejectRetention('sizeLimitExceeded');
        const chunk = buffer.subarray(0, bytesRead);
        hash.update(chunk);
        let written = 0;
        while (written < bytesRead) {
          const result = await output.write(chunk, written, bytesRead - written);
          if (result.bytesWritten === 0) rejectRetention('writeIncomplete');
          written += result.bytesWritten;
        }
      }
    } finally { await output.close(); }
    const after = await input.stat();
    const pathAfter = await ordinaryPath(root, source);
    if (bytes !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs ||
        after.ctimeMs !== before.ctimeMs || pathAfter.ino !== before.ino || pathAfter.dev !== before.dev) {
      rejectRetention('sourceChanged');
    }
    return { bytes, sha256: hash.digest('hex') };
  } finally { await input.close(); }
}

export function evidenceBinding(env) {
  const faultScenario = env.EKY_WORKSPACE_FAULT_SCENARIO ?? '';
  if (faultScenario !== '' && !FAULT_SCENARIOS.has(faultScenario)) fail();
  if (!/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? '') ||
      !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT ?? '') ||
      !/^[12]$/.test(env.EKY_WORKSPACE_REPETITION ?? '') ||
      !/^[0-9a-f]{40}$/.test(env.EXPECTED_BUILD_REVISION ?? '') ||
      !/^[0-9a-f]{64}$/.test(env.EXPECTED_DESCRIPTOR_SHA256 ?? '')) fail();
  return { runId: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT,
    repetition: env.EKY_WORKSPACE_REPETITION,
    scenario: faultScenario ? 'packagedWorkspaceFaultRollback' : 'packagedWorkspaceSuccess',
    ...(faultScenario ? { faultScenario } : {}),
    buildRevision: env.EXPECTED_BUILD_REVISION, artifactDescriptorSha256: env.EXPECTED_DESCRIPTOR_SHA256 };
}

export function deliveryProofBinding(env) {
  if (env.GITHUB_ACTIONS !== 'true' || env.RUNNER_OS !== 'Windows' ||
      env.RUNNER_ENVIRONMENT !== 'github-hosted' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
      env.GITHUB_JOB !== DELIVERY_PROOF_MODE || env.EKY_EVIDENCE_DELIVERY_PROOF !== '1' ||
      !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? '') ||
      !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT ?? '') ||
      !/^[0-9a-f]{40}$/.test(env.GITHUB_SHA ?? '')) fail();
  return { runId: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT,
    scenario: DELIVERY_PROOF_SCENARIO, sourceRevision: env.GITHUB_SHA };
}

function evidenceRoot(temp, binding) {
  return binding.scenario === DELIVERY_PROOF_SCENARIO
    ? join(temp, `eky-encrypted-delivery-proof-${binding.runId}-${binding.attempt}`)
    : join(temp, `eky-encrypted-workspace-${binding.runId}-${binding.attempt}-${binding.repetition}`);
}

export async function prepareEvidence(env) {
  return prepareBoundEvidence(env, evidenceBinding(env));
}

export function evidenceRecipient(env) {
  const fingerprint = env.EKY_DIAGNOSTIC_KEY_FINGERPRINT ?? '';
  const key = env.EKY_DIAGNOSTIC_PUBLIC_KEY ?? '';
  if (!/^[0-9A-F]{40}$/.test(fingerprint) || env.EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT !== fingerprint ||
      key.length > 64 * 1024 || !/^-----BEGIN PGP PUBLIC KEY BLOCK-----[\s\S]+-----END PGP PUBLIC KEY BLOCK-----\s*$/.test(key) ||
      key.includes('PRIVATE KEY')) fail();
  return { fingerprint, key };
}

async function prepareBoundEvidence(env, binding) {
  const { fingerprint, key } = evidenceRecipient(env);
  const temp = await realpath(env.RUNNER_TEMP);
  const root = evidenceRoot(temp, binding);
  await mkdir(root, { mode: 0o700 });
  const invocationId = randomUUID().replaceAll('-', '');
  const context = { binding, invocationId, fingerprint };
  await writeFile(join(root, 'context.private.json'), JSON.stringify(context), { flag: 'wx', mode: 0o600 });
  await writeFile(join(root, 'recipient.asc'), key, { flag: 'wx' });
  return { root, callerResultPath: join(temp, `eky-workspace-caller-${invocationId}`, 'result.json') };
}

export async function collectEvidence(env, root) {
  return collectBoundEvidence(env, root, evidenceBinding(env));
}

async function collectBoundEvidence(env, root, binding) {
  const temp = await realpath(env.RUNNER_TEMP);
  const synthetic = binding.scenario === DELIVERY_PROOF_SCENARIO;
  const expectedRoot = evidenceRoot(temp, binding);
  if (root !== expectedRoot) fail();
  await ordinaryPath(temp, root, true);
  const contextPath = join(root, 'context.private.json');
  if ((await ordinaryPath(temp, contextPath)).size > 4096) fail();
  const context = JSON.parse(await readFile(contextPath, 'utf8'));
  if (JSON.stringify(context.binding) !== JSON.stringify(binding) || !/^[0-9a-f]{32}$/.test(context.invocationId) ||
      !/^[0-9A-F]{40}$/.test(context.fingerprint)) fail();
  const stage = join(root, 'retained');
  await mkdir(stage);
  const manifest = { schemaVersion: 1, binding: { ...binding, invocationId: context.invocationId },
    outcomes: { test: outcome(env.EKY_TEST_OUTCOME), artifact: outcome(env.EKY_ARTIFACT_OUTCOME),
      captureStart: outcome(env.EKY_CAPTURE_START_OUTCOME), captureStop: outcome(env.EKY_CAPTURE_STOP_OUTCOME),
      analysis: outcome(env.EKY_ANALYSIS_OUTCOME) },
    cleanup: 'unverified', captureClosed: false, files: [], unresolvedEvidenceHold: true };
  if (synthetic) {
    for (const name of Object.keys(manifest.outcomes)) manifest.outcomes[name] = 'skipped';
  }
  let total = 0;
  const add = async (source, name, limit, validate) => {
    const entry = { name, status: 'unverified' };
    manifest.files.push(entry);
    try {
      const proof = await retain(temp, source, join(stage, name), Math.min(limit, MAX_TOTAL - total));
      await validate?.(proof);
      total += proof.bytes;
      Object.assign(entry, proof, { status: 'retained' });
    } catch (error) {
      entry.status = error.code === 'ENOENT' ? 'missing' : 'unverified';
      entry.failureCode = retentionFailureCode(error);
    }
  };
  const capture = synthetic ? join(root, 'synthetic-input') : join(temp, 'eky-inspector-capture');
  try {
    const marker = await ordinaryPath(temp, join(capture, 'stopped'));
    manifest.captureClosed = manifest.outcomes.captureStop === 'success' && marker.size === 0;
  } catch { /* An ETL without a confirmed stop is not a complete capture. */ }
  const files = synthetic ? [[DELIVERY_PROOF_FILE, CAPTURE_FILES[DELIVERY_PROOF_FILE]]] : Object.entries(CAPTURE_FILES);
  for (const [name, limit] of files) {
    if (name === 'capture.etl' && !manifest.captureClosed) manifest.files.push({ name, status: 'stopUnverified' });
    else await add(join(capture, name), name, limit);
  }
  if (synthetic) {
    const entry = manifest.files[0];
    if (entry.status !== 'retained' || entry.bytes !== DELIVERY_PROOF_BYTES.length ||
        entry.sha256 !== createHash('sha256').update(DELIVERY_PROOF_BYTES).digest('hex')) fail();
  } else {
    await add(join(temp, `eky-workspace-caller-${context.invocationId}`, 'result.json'), 'caller-result.json', 8192);
  }
  if (!synthetic && manifest.files.at(-1).status === 'retained') {
    try {
      const caller = validateWorkspaceCallerResult(JSON.parse(await readFile(join(stage, 'caller-result.json'), 'utf8')),
        { schemaVersion: 1, invocationId: context.invocationId, scenario: binding.scenario,
          faultScenario: binding.faultScenario ?? null,
          buildRevision: binding.buildRevision, artifactDescriptorSha256: binding.artifactDescriptorSha256 });
      const result = caller.outcome;
      manifest.cleanup = result.processTreeAbsent === true && result.productProcessAbsent === true &&
        result.fixtureRemoved === true && result.fixtureCleanupResultCode === 'fixtureRemoved' &&
        result.phaseWriterResultCode === 'writerAbsent' &&
        ['notRequired', 'processTreeAbsent'].includes(result.supervisorCleanupResultCode) &&
        ['notRequired', 'semanticCleanupCompleted'].includes(result.semanticCleanupResultCode) &&
        result.postconditionResultCode === 'exactProductsAbsent' &&
        result.removalPostconditionResultCode === 'installerFootprintAbsent' ? 'verified' : 'unverified';
    } catch { /* Retain invalid/incomplete bytes without trusting their cleanup claim. */ }
  }
  if (!synthetic) {
    const callerRoot = join(temp, `eky-workspace-caller-${context.invocationId}`);
    await add(join(callerRoot, W6B2_INSTALLER_LOG_RECEIPT), W6B2_INSTALLER_LOG_RECEIPT, 8192);
    await add(join(callerRoot, W6B2_INSTALLER_LOG_FILE), W6B2_INSTALLER_LOG_FILE, W6B2_INSTALLER_LOG_MAX_BYTES,
      proof => assertWorkspaceInstallerLogReceipt(callerRoot, proof, {
        schemaVersion: 1, invocationId: context.invocationId, scenario: binding.scenario,
        faultScenario: binding.faultScenario ?? null, buildRevision: binding.buildRevision,
        artifactDescriptorSha256: binding.artifactDescriptorSha256,
      }));
  }
  const archivePath = join(root, 'evidence.private.json.gz');
  await writeEvidenceArchive({ temp, stage, archivePath, manifest });
  return { archivePath, fingerprint: context.fingerprint, manifest };
}

export async function writeEvidenceArchive({ temp, stage, archivePath, manifest }) {
  async function* jsonChunks() {
    yield '{"manifest":' + JSON.stringify(manifest) + ',"files":{';
    let separator = '';
    for (const entry of manifest.files.filter(value => value.status === 'retained')) {
      yield separator + JSON.stringify(entry.name) + ':"';
      const path = join(stage, entry.name);
      await ordinaryPath(temp, path);
      const hash = createHash('sha256');
      let bytes = 0;
      for await (const chunk of createReadStream(path, { encoding: 'base64' })) {
        const decoded = Buffer.from(chunk, 'base64');
        bytes += decoded.length;
        hash.update(decoded);
        yield chunk;
      }
      if (bytes !== entry.bytes || hash.digest('hex') !== entry.sha256) fail();
      yield '"'; separator = ',';
    }
    yield '}}';
  }
  await pipeline(Readable.from(jsonChunks()), createGzip(), createWriteStream(archivePath, { flags: 'wx', mode: 0o600 }));
}

export async function prepareDeliveryProof(env) {
  const binding = deliveryProofBinding(env);
  const { root } = await prepareBoundEvidence(env, binding);
  // Never inspect the runner's capture or caller directories for this fixed fixture.
  const input = join(root, 'synthetic-input');
  await mkdir(input);
  await writeFile(join(input, DELIVERY_PROOF_FILE), DELIVERY_PROOF_BYTES, { flag: 'wx', mode: 0o600 });
  return { root, collected: await collectBoundEvidence(env, root, binding) };
}

async function verifyDeliveryProofInvocation(env, observePhase) {
  observePhase('invocationContext');
  deliveryProofBinding(env);
  observePhase('nodeVersion');
  if (!isAbsolute(env.GITHUB_EVENT_PATH ?? '') ||
      process.versions.node !== (await readFile(resolve(HERE, '../../../../.node-version'), 'utf8')).trim()) fail();
  observePhase('eventFile');
  const event = await lstat(env.GITHUB_EVENT_PATH);
  if (!event.isFile() || event.isSymbolicLink() || event.size > MiB) fail();
  observePhase('eventJson');
  if (JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8')).inputs?.mode !== DELIVERY_PROOF_MODE) fail();
  observePhase('checkoutRevision');
  await new Promise((accept, reject) => {
    execFile('git.exe', ['rev-parse', 'HEAD'], { cwd: HERE, timeout: 10_000, maxBuffer: 4096, windowsHide: true },
      (error, stdout) => error || stdout.trim() !== env.GITHUB_SHA
        ? reject(new Error('WORKSPACE_ENCRYPTED_EVIDENCE_UNVERIFIED')) : accept());
  });
}

export function encryptionFailureCode(error, stderr) {
  if (['ENOENT', 'EACCES', 'EPERM'].includes(error?.code)) return HELPER_START_FAILED;
  // Accept exactly one known line, not a token found inside an arbitrary error.
  const match = typeof stderr === 'string' && stderr.length <= 128
    ? /^([A-Z_]+)\r?\n$/u.exec(stderr) : null;
  return match && match[0] === stderr && ENCRYPTION_FAILURE_CODES.has(match[1])
    ? match[1] : 'EVIDENCE_ENCRYPTION_FAILED';
}

export function encryptArchive(root, collected, reportFailureCode = false) {
  return new Promise((accept, reject) => {
    const executable = { win32: 'pwsh.exe', linux: 'pwsh' }[process.platform];
    if (!executable) {
      const failure = new Error('WORKSPACE_ENCRYPTED_EVIDENCE_UNVERIFIED');
      if (reportFailureCode) failure.evidenceCode = 'EVIDENCE_PLATFORM_UNSUPPORTED';
      reject(failure); return;
    }
    execFile(executable, ['-NoProfile', '-NonInteractive', '-File', join(HERE, 'sealWorkspaceEvidence.ps1'),
      '-ArchivePath', collected.archivePath, '-OutputPath', join(root, 'evidence.json.gz.gpg'),
      '-PublicKeyPath', join(root, 'recipient.asc'), '-ExpectedFingerprint', collected.fingerprint,
      '-WorkRoot', root, ...(reportFailureCode ? ['-ReportFailureCode'] : [])],
    { timeout: 120_000, maxBuffer: 64 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (!error) { accept(); return; }
      const failure = new Error('WORKSPACE_ENCRYPTED_EVIDENCE_UNVERIFIED');
      if (reportFailureCode) failure.evidenceCode = encryptionFailureCode(error, stderr);
      reject(failure);
    });
  });
}

export async function runEvidence(mode, env = process.env) {
  if (process.platform !== 'win32' || env.GITHUB_ACTIONS !== 'true' || env.RUNNER_OS !== 'Windows' ||
      !isAbsolute(env.RUNNER_TEMP ?? '') || !isAbsolute(env.GITHUB_OUTPUT ?? '')) fail();
  if (mode === 'prepare') {
    const prepared = await prepareEvidence(env);
    await appendFile(env.GITHUB_OUTPUT, `root=${prepared.root}\ncaller_result_path=${prepared.callerResultPath}\n`);
    return;
  }
  let root;
  let collected;
  let deliveryPhase = 'invocationContext';
  try {
    if (mode === 'delivery-proof') {
      await verifyDeliveryProofInvocation(env, phase => { deliveryPhase = phase; });
      deliveryPhase = 'evidenceCollection';
      ({ root, collected } = await prepareDeliveryProof(env));
    } else {
      if (mode !== 'seal') fail();
      root = env.EKY_EVIDENCE_ROOT;
      collected = await collectEvidence(env, root);
    }
    deliveryPhase = 'encryption';
    await encryptArchive(root, collected, mode === 'delivery-proof');
    deliveryPhase = 'ciphertextVerification';
    const ciphertext = join(root, 'evidence.json.gz.gpg');
    const proof = await ordinaryPath(await realpath(env.RUNNER_TEMP), ciphertext);
    if (proof.size === 0 || proof.size > MAX_TOTAL * 2) fail();
    console.log(JSON.stringify({ schemaVersion: 1,
      operation: mode === 'delivery-proof' ? DELIVERY_PROOF_SCENARIO : 'workspaceEncryptedEvidence',
      status: 'sealed', outcomes: collected.manifest.outcomes, cleanup: collected.manifest.cleanup,
      captureClosed: collected.manifest.captureClosed,
      retainedFiles: collected.manifest.files.filter(item => item.status === 'retained').length }));
    deliveryPhase = 'outputPublication';
    await appendFile(env.GITHUB_OUTPUT, `ciphertext=${ciphertext}\nsealed=true\n`);
  } catch (error) {
    // Only code-owned phases cross the public boundary; never the native error.
    if (mode === 'delivery-proof') {
      const errorCode = deliveryPhase === 'encryption' &&
        (error?.evidenceCode === HELPER_START_FAILED || ENCRYPTION_FAILURE_CODES.has(error?.evidenceCode))
        ? { errorCode: error.evidenceCode } : {};
      console.error(JSON.stringify({ schemaVersion: 1,
        operation: DELIVERY_PROOF_SCENARIO, status: 'failed', phase: deliveryPhase, ...errorCode }));
    }
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const execution = process.argv[2] === 'delivery-proof' && process.argv.length !== 3
    ? Promise.reject(new Error('WORKSPACE_ENCRYPTED_EVIDENCE_UNVERIFIED')) : runEvidence(process.argv[2]);
  execution.catch(() => { console.error('WORKSPACE_ENCRYPTED_EVIDENCE_UNVERIFIED'); process.exitCode = 1; });
}
