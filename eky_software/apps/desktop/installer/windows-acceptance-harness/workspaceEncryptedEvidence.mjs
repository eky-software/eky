import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, lstat, mkdir, open, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';
import { validateWorkspaceCallerResult } from './workspaceCallerResult.mjs';

const MiB = 1024 * 1024;
const MAX_TOTAL = 400 * MiB;
const OUTCOMES = new Set(['success', 'failure', 'cancelled', 'skipped', 'unknown']);
const HERE = dirname(fileURLToPath(import.meta.url));
const DELIVERY_PROOF_MODE = 'encrypted-evidence-delivery-proof';
const DELIVERY_PROOF_SCENARIO = 'syntheticEncryptedEvidenceDelivery';
const DELIVERY_PROOF_FILE = 'command-export.stderr.private.log';
const DELIVERY_PROOF_BYTES = Buffer.from('EKY synthetic encrypted delivery proof v1\n', 'utf8');
const CAPTURE_FILES = Object.freeze({
  'capture.etl': 256 * MiB,
  'event-statistics.private.log': 32 * MiB,
  'event-statistics.stderr.private.log': 8 * MiB,
  'command-export.private.log': 64 * MiB,
  'command-export.stderr.private.log': 8 * MiB,
  'export-metadata.private.json': MiB,
  'event-statistics.failure.private.txt': MiB,
  'analyze.failure.private.txt': MiB,
  'start.failure.private.txt': MiB,
  'stop.failure.private.txt': MiB,
  'start.private.log': MiB,
  'start.stderr.private.log': MiB,
  'stop.private.log': MiB,
  'stop.stderr.private.log': MiB,
  'before.private.log': MiB,
  'before.stderr.private.log': MiB,
  'after.private.log': MiB,
  'after.stderr.private.log': MiB,
  'after-cancel.private.log': MiB,
  'after-cancel.stderr.private.log': MiB,
  'collectors-before-stop.private.log': MiB,
  'collectors-before-stop.stderr.private.log': MiB,
});
function fail() { throw new Error('WORKSPACE_ENCRYPTED_EVIDENCE_UNVERIFIED'); }
function outcome(value) { return OUTCOMES.has(value) ? value : 'unknown'; }

// Only known files below the caller's private temp directory may enter the envelope.
async function ordinaryPath(root, path, directory = false) {
  const base = await realpath(root);
  const rel = relative(base, resolve(path));
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) fail();
  const parts = rel.split(sep);
  let current = base;
  let stat;
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    stat = await lstat(current);
    if (stat.isSymbolicLink() || await realpath(current) !== current) fail();
    if (index < parts.length - 1 || directory) { if (!stat.isDirectory()) fail(); }
    else if (!stat.isFile() || stat.nlink !== 1) fail();
  }
  return stat;
}

async function retain(root, source, destination, limit) {
  const before = await ordinaryPath(root, source);
  if (before.size > limit) fail();
  const input = await open(source, 'r');
  try {
    const identity = await input.stat();
    if (!identity.isFile() || identity.nlink !== 1 || identity.ino !== before.ino || identity.dev !== before.dev) fail();
    const output = await open(destination, 'wx', 0o600);
    const hash = createHash('sha256');
    let bytes = 0;
    try {
      const buffer = Buffer.alloc(64 * 1024);
      for (;;) {
        const { bytesRead } = await input.read(buffer, 0, buffer.length, null);
        if (!bytesRead) break;
        bytes += bytesRead;
        if (bytes > limit) fail();
        const chunk = buffer.subarray(0, bytesRead);
        hash.update(chunk);
        let written = 0;
        while (written < bytesRead) {
          const result = await output.write(chunk, written, bytesRead - written);
          if (result.bytesWritten === 0) fail();
          written += result.bytesWritten;
        }
      }
    } finally { await output.close(); }
    const after = await input.stat();
    const pathAfter = await ordinaryPath(root, source);
    if (bytes !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs ||
        after.ctimeMs !== before.ctimeMs || pathAfter.ino !== before.ino || pathAfter.dev !== before.dev) fail();
    return { bytes, sha256: hash.digest('hex') };
  } finally { await input.close(); }
}

export function evidenceBinding(env) {
  if (!/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? '') ||
      !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT ?? '') ||
      !/^[12]$/.test(env.EKY_WORKSPACE_REPETITION ?? '') ||
      !/^[0-9a-f]{40}$/.test(env.EXPECTED_BUILD_REVISION ?? '') ||
      !/^[0-9a-f]{64}$/.test(env.EXPECTED_DESCRIPTOR_SHA256 ?? '')) fail();
  return { runId: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT,
    repetition: env.EKY_WORKSPACE_REPETITION, scenario: 'packagedWorkspaceSuccess',
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

async function prepareBoundEvidence(env, binding) {
  const fingerprint = env.EKY_DIAGNOSTIC_KEY_FINGERPRINT ?? '';
  const key = env.EKY_DIAGNOSTIC_PUBLIC_KEY ?? '';
  if (!/^[0-9A-F]{40}$/.test(fingerprint) || env.EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT !== fingerprint ||
      key.length > 64 * 1024 || !/^-----BEGIN PGP PUBLIC KEY BLOCK-----[\s\S]+-----END PGP PUBLIC KEY BLOCK-----\s*$/.test(key) ||
      key.includes('PRIVATE KEY')) fail();
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
  const add = async (source, name, limit) => {
    const entry = { name, status: 'unverified' };
    manifest.files.push(entry);
    try {
      const proof = await retain(temp, source, join(stage, name), Math.min(limit, MAX_TOTAL - total));
      total += proof.bytes;
      Object.assign(entry, proof, { status: 'retained' });
    } catch (error) { entry.status = error.code === 'ENOENT' ? 'missing' : 'unverified'; }
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
        { schemaVersion: 1, invocationId: context.invocationId, scenario: binding.scenario, faultScenario: null,
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
  const archivePath = join(root, 'evidence.private.json.gz');
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
  return { archivePath, fingerprint: context.fingerprint, manifest };
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

async function verifyDeliveryProofInvocation(env) {
  deliveryProofBinding(env);
  if (!isAbsolute(env.GITHUB_EVENT_PATH ?? '') ||
      process.versions.node !== (await readFile(resolve(HERE, '../../../../.node-version'), 'utf8')).trim()) fail();
  const event = await lstat(env.GITHUB_EVENT_PATH);
  if (!event.isFile() || event.isSymbolicLink() || event.size > MiB) fail();
  if (JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8')).inputs?.mode !== DELIVERY_PROOF_MODE) fail();
  await new Promise((accept, reject) => {
    execFile('git.exe', ['rev-parse', 'HEAD'], { cwd: HERE, timeout: 10_000, maxBuffer: 4096, windowsHide: true },
      (error, stdout) => error || stdout.trim() !== env.GITHUB_SHA
        ? reject(new Error('WORKSPACE_ENCRYPTED_EVIDENCE_UNVERIFIED')) : accept());
  });
}

export function encryptArchive(root, collected) {
  return new Promise((accept, reject) => {
    execFile('pwsh.exe', ['-NoProfile', '-NonInteractive', '-File', join(HERE, 'sealWorkspaceEvidence.ps1'),
      '-ArchivePath', collected.archivePath, '-OutputPath', join(root, 'evidence.json.gz.gpg'),
      '-PublicKeyPath', join(root, 'recipient.asc'), '-ExpectedFingerprint', collected.fingerprint,
      '-WorkRoot', root], { timeout: 120_000, maxBuffer: 64 * 1024, windowsHide: true },
    error => error ? reject(new Error('WORKSPACE_ENCRYPTED_EVIDENCE_UNVERIFIED')) : accept());
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
  if (mode === 'delivery-proof') {
    await verifyDeliveryProofInvocation(env);
    ({ root, collected } = await prepareDeliveryProof(env));
  } else {
    if (mode !== 'seal') fail();
    root = env.EKY_EVIDENCE_ROOT;
    collected = await collectEvidence(env, root);
  }
  await encryptArchive(root, collected);
  const ciphertext = join(root, 'evidence.json.gz.gpg');
  const proof = await ordinaryPath(await realpath(env.RUNNER_TEMP), ciphertext);
  if (proof.size === 0 || proof.size > MAX_TOTAL * 2) fail();
  console.log(JSON.stringify({ schemaVersion: 1,
    operation: mode === 'delivery-proof' ? DELIVERY_PROOF_SCENARIO : 'workspaceEncryptedEvidence',
    status: 'sealed', outcomes: collected.manifest.outcomes, cleanup: collected.manifest.cleanup,
    captureClosed: collected.manifest.captureClosed,
    retainedFiles: collected.manifest.files.filter(item => item.status === 'retained').length }));
  await appendFile(env.GITHUB_OUTPUT, `ciphertext=${ciphertext}\nsealed=true\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const execution = process.argv[2] === 'delivery-proof' && process.argv.length !== 3
    ? Promise.reject(new Error('WORKSPACE_ENCRYPTED_EVIDENCE_UNVERIFIED')) : runEvidence(process.argv[2]);
  execution.catch(() => { console.error('WORKSPACE_ENCRYPTED_EVIDENCE_UNVERIFIED'); process.exitCode = 1; });
}
