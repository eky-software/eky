import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { link, mkdir, mkdtemp, open, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';
import { collectEvidence, deliveryProofBinding, encryptionFailureCode, evidenceBinding, prepareDeliveryProof, prepareEvidence, retain, retentionFailureCode,
  EVIDENCE_FILE_MAX_BYTES, EVIDENCE_TOTAL_MAX_BYTES } from './workspaceEncryptedEvidence.mjs';
import encryptionFailureCodes from './encryptedEvidenceFailureCodes.json' with { type: 'json' };
import { validateWorkspaceCallerResult } from './workspaceCallerResult.mjs';
import { retainWorkspaceInstallerLog } from './workspaceInstallerLogEvidence.mjs';
import { W6B2_INSTALLER_LOG_FILE, W6B2_INSTALLER_LOG_RECEIPT,
  W6B2_INSTALLER_LOG_MAX_BYTES } from '../../src/main/w6b2PackagedInstallerLog.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

test('retention failure codes never copy native messages, paths or arbitrary properties', () => {
  for (const [code, expected] of [['ENOENT', 'sourceMissing'], ['EACCES', 'accessDenied'],
    ['EPERM', 'accessDenied'], ['ENOSPC', 'storageFull'], ['EIO', 'ioFailure'],
    ['UNKNOWN PRIVATE CONTENT', 'unclassified'], [undefined, 'unclassified']]) {
    const error = Object.assign(new Error('PRIVATE native message and path'), {
      code, reason: 'PRIVATE injected reason', retentionCode: 'PRIVATE injected code',
    });
    assert.equal(retentionFailureCode(error), expected);
  }
  assert.equal(retentionFailureCode(null), 'unclassified');
});

test('retention distinguishes oversized input from a source changed during copying', async t => {
  const f = await fixture(t);
  const source = join(f.capture, 'capture.etl');
  const bytes = Buffer.from('synthetic trace bytes');
  await writeFile(source, bytes);
  await assert.rejects(retain(f.env.RUNNER_TEMP, source, join(f.root, 'too-large'), bytes.length - 1), error => {
    assert.equal(retentionFailureCode(error), 'sizeLimitExceeded');
    return true;
  });
  const probe = await open(source, 'r');
  const prototype = Object.getPrototypeOf(probe);
  const read = prototype.read;
  await probe.close();
  let changed = false;
  t.mock.method(prototype, 'read', async function (...args) {
    const result = await read.apply(this, args);
    if (!changed && result.bytesRead > 0) {
      changed = true;
      await writeFile(source, 'shorter');
    }
    return result;
  });
  await assert.rejects(retain(f.env.RUNNER_TEMP, source, join(f.root, 'changed'), 1024), error => {
    assert.equal(retentionFailureCode(error), 'sourceChanged');
    return true;
  });
  assert.equal(changed, true);
  assert.equal(await readFile(source, 'utf8'), 'shorter');
});

test('encryption failure parsing accepts only a complete known line and separates helper startup', () => {
  for (const code of encryptionFailureCodes) {
    for (const newline of ['\n', '\r\n']) {
      assert.equal(encryptionFailureCode({ code: 1 }, code + newline), code);
    }
  }
  for (const stderr of [undefined, '', 'EVIDENCE_KEY_INVALID', 'EVIDENCE_KEY_INVALID\nPRIVATE',
    'PRIVATE\nEVIDENCE_KEY_INVALID\n', 'EVIDENCE_UNKNOWN\n', 'EVIDENCE_KEY_INVALID\n\n',
    'C:\\private\\secret.txt', 'PRIVATE'.repeat(30), Buffer.from('EVIDENCE_KEY_INVALID\n')]) {
    assert.equal(encryptionFailureCode({ code: 1 }, stderr), 'EVIDENCE_ENCRYPTION_FAILED');
  }
  for (const code of ['ENOENT', 'EACCES', 'EPERM']) {
    assert.equal(encryptionFailureCode({ code }, 'private executable location'), 'EVIDENCE_HELPER_START_FAILED');
  }
  assert.equal(encryptionFailureCode({ code: 'ETIMEDOUT' }, ''), 'EVIDENCE_ENCRYPTION_FAILED');
});
async function fixture(t, overrides = {}) {
  const temp = await mkdtemp(join(await realpath(tmpdir()), 'eky-encrypted-test-'));
  t.after(async () => { if (t.passed === true && !t.signal.aborted) await rm(temp, { recursive: true, force: true }); });
  const env = { RUNNER_TEMP: temp, GITHUB_RUN_ID: '12345', GITHUB_RUN_ATTEMPT: '1',
    EKY_WORKSPACE_REPETITION: '1', EXPECTED_BUILD_REVISION: 'a'.repeat(40),
    EXPECTED_DESCRIPTOR_SHA256: 'b'.repeat(64), EKY_DIAGNOSTIC_KEY_FINGERPRINT: 'A'.repeat(40),
    EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT: 'A'.repeat(40),
    EKY_DIAGNOSTIC_PUBLIC_KEY: '-----BEGIN PGP PUBLIC KEY BLOCK-----\nsynthetic-not-a-real-key\n-----END PGP PUBLIC KEY BLOCK-----',
    EKY_TEST_OUTCOME: 'failure', EKY_ARTIFACT_OUTCOME: 'success', EKY_CAPTURE_START_OUTCOME: 'success',
    EKY_CAPTURE_STOP_OUTCOME: 'success', EKY_ANALYSIS_OUTCOME: 'failure', ...overrides };
  const prepared = await prepareEvidence(env);
  const capture = join(temp, 'eky-inspector-capture');
  await mkdir(capture);
  await mkdir(dirname(prepared.callerResultPath));
  return { env, ...prepared, capture };
}
async function envelope(collected) {
  return JSON.parse(gunzipSync(await readFile(collected.archivePath)));
}

test('shared retention budgets are 64 MiB per ordinary file and 512 MiB in total', () => {
  assert.equal(EVIDENCE_FILE_MAX_BYTES, 64 * 1024 * 1024);
  assert.equal(EVIDENCE_TOTAL_MAX_BYTES, 512 * 1024 * 1024);
});

for (const [name, limit] of [['start.private.log', 64], ['command-export.private.log', 128]]) {
  for (const extra of [0, 1]) {
    test(`workspace ${name} keeps its ${limit} MiB boundary: ${extra} extra bytes`, async t => {
      const f = await fixture(t);
      const bytes = limit * 1024 * 1024 + extra;
      const source = join(f.capture, name);
      const handle = await open(source, 'wx');
      try { await handle.truncate(bytes); } finally { await handle.close(); }
      const collected = await collectEvidence(f.env, f.root);
      const entry = collected.manifest.files.find(value => value.name === name);
      if (extra === 0) {
        assert.equal(entry.status, 'retained');
        assert.equal(entry.bytes, bytes);
        const retained = await readFile(join(f.root, 'retained', name));
        assert.equal(retained.length, bytes);
        assert.equal(createHash('sha256').update(retained).digest('hex'), entry.sha256);
      } else {
        assert.equal(entry.status, 'unverified');
        assert.equal(entry.failureCode, 'sizeLimitExceeded');
        assert.equal(Object.hasOwn((await envelope(collected)).files, name), false);
      }
      const check = await open(source, 'r');
      try { assert.equal((await check.stat()).size, bytes); } finally { await check.close(); }
    });
  }
}

async function installerLogFixture(t) {
  const f = await fixture(t, { EKY_WORKSPACE_FAULT_SCENARIO: 'passiveWorkspaceMigrationFailure', EKY_TEST_OUTCOME: 'cancelled' });
  const context = JSON.parse(await readFile(join(f.root, 'context.private.json'), 'utf8'));
  const binding = { schemaVersion: 1, invocationId: context.invocationId,
    scenario: context.binding.scenario, faultScenario: context.binding.faultScenario,
    buildRevision: context.binding.buildRevision, artifactDescriptorSha256: context.binding.artifactDescriptorSha256 };
  const proofRoot = join(f.env.RUNNER_TEMP, 'synthetic-proof');
  await mkdir(join(proofRoot, 'result'), { recursive: true });
  await writeFile(join(dirname(f.callerResultPath), 'binding.json'), JSON.stringify(binding));
  return { ...f, proofRoot, binding, resultPath: f.callerResultPath, processTreeAbsent: true };
}

test('cancelled workspace preserves the native log before fixture removal and without a caller terminal', async t => {
  const f = await installerLogFixture(t);
  const bytes = Buffer.from('Action start: synthetic interrupted target installation\n');
  await writeFile(join(f.proofRoot, 'result', W6B2_INSTALLER_LOG_FILE), bytes);
  assert.equal(await retainWorkspaceInstallerLog(f), true);
  await rm(f.proofRoot, { recursive: true });
  const value = await envelope(await collectEvidence(f.env, f.root));
  assert.deepEqual(Buffer.from(value.files[W6B2_INSTALLER_LOG_FILE], 'base64'), bytes);
  const receipt = JSON.parse(Buffer.from(value.files[W6B2_INSTALLER_LOG_RECEIPT], 'base64'));
  assert.deepEqual(receipt.binding, f.binding);
  assert.equal(receipt.status, 'retained');
  assert.equal(value.manifest.cleanup, 'unverified');
  assert.equal(value.manifest.outcomes.test, 'cancelled');
  assert.equal(value.manifest.files.find(entry => entry.name === 'caller-result.json').status, 'missing');
});

test('workspace retention and archive preserve a full native MSI log at the 64 MiB boundary', async t => {
  const f = await installerLogFixture(t);
  const bytes = 64 * 1024 * 1024;
  const source = join(f.proofRoot, 'result', W6B2_INSTALLER_LOG_FILE);
  const file = await open(source, 'wx');
  try {
    await file.truncate(bytes);
    await file.write(Buffer.from('synthetic MSI first action'), 0, 26, 0);
    await file.write(Buffer.from('synthetic MSI last action'), 0, 25, bytes - 25);
  } finally { await file.close(); }
  const expectedHash = createHash('sha256').update(await readFile(source)).digest('hex');
  assert.equal(await retainWorkspaceInstallerLog(f), true);
  await rm(f.proofRoot, { recursive: true });
  const value = await envelope(await collectEvidence(f.env, f.root));
  const retained = Buffer.from(value.files[W6B2_INSTALLER_LOG_FILE], 'base64');
  assert.equal(retained.length, bytes);
  assert.equal(createHash('sha256').update(retained).digest('hex'), expectedHash);
  const receipt = JSON.parse(Buffer.from(value.files[W6B2_INSTALLER_LOG_RECEIPT], 'base64'));
  assert.equal(receipt.bytes, bytes);
  assert.equal(receipt.sha256, expectedHash);
});

test('bound target MSI log cannot exceed the remaining aggregate budget after workspace capture', async t => {
  const f = await installerLogFixture(t);
  const source = join(f.proofRoot, 'result', W6B2_INSTALLER_LOG_FILE);
  const file = await open(source, 'wx');
  try { await file.truncate(64 * 1024 * 1024); } finally { await file.close(); }
  assert.equal(await retainWorkspaceInstallerLog(f), true);
  await writeFile(join(f.capture, 'stopped'), '');
  for (const [name, bytes] of [['capture.etl', 256], ['event-statistics.private.log', 64],
    ['command-export.private.log', 128]]) {
    const handle = await open(join(f.capture, name), 'wx');
    try { await handle.truncate(bytes * 1024 * 1024); } finally { await handle.close(); }
  }
  const collected = await collectEvidence(f.env, f.root);
  assert.equal(collected.manifest.files.find(value => value.name === 'capture.etl').status, 'retained');
  const retained = collected.manifest.files.filter(value => value.status === 'retained');
  assert.ok(retained.reduce((sum, value) => sum + value.bytes, 0) <= 512 * 1024 * 1024);
  const rejected = collected.manifest.files.find(value => value.name === W6B2_INSTALLER_LOG_FILE);
  assert.equal(rejected.status, 'unverified');
  assert.equal(rejected.failureCode, 'sizeLimitExceeded');
  assert.equal(Object.hasOwn(rejected, 'bytes'), false);
  await assert.rejects(readFile(join(f.root, 'retained', W6B2_INSTALLER_LOG_FILE)), { code: 'ENOENT' });
  assert.equal((await open(source, 'r').then(async handle => {
    try { return await handle.stat(); } finally { await handle.close(); }
  })).size, 64 * 1024 * 1024);
});

test('unverified process exit, foreign binding and oversized logs never authorize fixture removal', async t => {
  const f = await installerLogFixture(t);
  const source = join(f.proofRoot, 'result', W6B2_INSTALLER_LOG_FILE);
  await writeFile(source, 'synthetic retained source');
  assert.equal(await retainWorkspaceInstallerLog({ ...f, processTreeAbsent: false }), false);
  await assert.rejects(readFile(join(dirname(f.resultPath), W6B2_INSTALLER_LOG_RECEIPT)), { code: 'ENOENT' });
  await assert.rejects(retainWorkspaceInstallerLog({ ...f, binding: { ...f.binding, buildRevision: 'c'.repeat(40) } }));
  const file = await open(source, 'r+');
  try { await file.truncate(W6B2_INSTALLER_LOG_MAX_BYTES + 1); } finally { await file.close(); }
  assert.equal(await retainWorkspaceInstallerLog(f), false);
  const value = await envelope(await collectEvidence(f.env, f.root));
  const receipt = JSON.parse(Buffer.from(value.files[W6B2_INSTALLER_LOG_RECEIPT], 'base64'));
  assert.equal(receipt.failureCode, 'sizeLimitExceeded');
  assert.equal(Object.hasOwn(value.files, W6B2_INSTALLER_LOG_FILE), false);
  assert.equal((await open(source, 'r').then(async handle => { try { return await handle.stat(); } finally { await handle.close(); } })).size,
    W6B2_INSTALLER_LOG_MAX_BYTES + 1);
});

test('a log disappearing during copying preserves its fixture instead of becoming historical missing', async t => {
  const f = await installerLogFixture(t);
  const source = join(f.proofRoot, 'result', W6B2_INSTALLER_LOG_FILE);
  const moved = join(f.proofRoot, 'result', 'moved.private.log');
  await writeFile(source, 'original synthetic native log');
  const handle = await open(source, 'r');
  const sourceIdentity = await handle.stat();
  const prototype = Object.getPrototypeOf(handle);
  const read = prototype.read;
  await handle.close();
  let changed = false;
  t.mock.method(prototype, 'read', async function (...args) {
    const result = await read.apply(this, args);
    const identity = await this.stat();
    if (!changed && result.bytesRead > 0 && identity.ino === sourceIdentity.ino && identity.dev === sourceIdentity.dev) {
      changed = true;
      await rename(source, moved);
    }
    return result;
  });
  assert.equal(await retainWorkspaceInstallerLog(f), false);
  assert.equal(changed, true);
  const receipt = JSON.parse(await readFile(join(dirname(f.resultPath), W6B2_INSTALLER_LOG_RECEIPT), 'utf8'));
  assert.equal(receipt.status, 'unverified');
  assert.equal(receipt.failureCode, 'sourceMissing');
  assert.equal(await readFile(moved, 'utf8'), 'original synthetic native log');
  const value = await envelope(await collectEvidence(f.env, f.root));
  assert.equal(Object.hasOwn(value.files, W6B2_INSTALLER_LOG_FILE), false);
});

test('a historical package with no native log retains an explicit missing receipt', async t => {
  const f = await installerLogFixture(t);
  assert.equal(await retainWorkspaceInstallerLog(f), true);
  const receipt = JSON.parse(await readFile(join(dirname(f.resultPath), W6B2_INSTALLER_LOG_RECEIPT), 'utf8'));
  assert.equal(receipt.status, 'missing');
  assert.equal(receipt.failureCode, 'sourceMissing');
});

for (const changed of ['bytes', 'binding', 'status']) {
  test(`workspace collection rejects an untrusted saved installer log: ${changed}`, async t => {
    const f = await installerLogFixture(t);
    await writeFile(join(f.proofRoot, 'result', W6B2_INSTALLER_LOG_FILE), 'synthetic native log');
    assert.equal(await retainWorkspaceInstallerLog(f), true);
    const callerRoot = dirname(f.resultPath);
    const receiptPath = join(callerRoot, W6B2_INSTALLER_LOG_RECEIPT);
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    if (changed === 'bytes') await writeFile(join(callerRoot, W6B2_INSTALLER_LOG_FILE), 'changed native log');
    else {
      if (changed === 'binding') receipt.binding.invocationId = 'e'.repeat(32);
      else receipt.status = 'unverified';
      await writeFile(receiptPath, JSON.stringify(receipt));
    }
    const value = await envelope(await collectEvidence(f.env, f.root));
    assert.equal(Object.hasOwn(value.files, W6B2_INSTALLER_LOG_FILE), false);
    assert.equal(value.manifest.files.find(entry => entry.name === W6B2_INSTALLER_LOG_FILE).status, 'unverified');
  });
}

function proofEnvironment(env) {
  return { ...env, GITHUB_ACTIONS: 'true', RUNNER_OS: 'Windows', RUNNER_ENVIRONMENT: 'github-hosted',
    GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_JOB: 'encrypted-evidence-delivery-proof',
    EKY_EVIDENCE_DELIVERY_PROOF: '1', GITHUB_SHA: 'c'.repeat(40) };
}

const FAULT_SCENARIOS = ['acceptanceInterruption', 'activeWorkspaceFirstStartFailure', 'passiveWorkspaceMigrationFailure'];

test('workspace evidence keeps the success default and admits only the exact diagnostic fault selection', async t => {
  const f = await fixture(t);
  const expected = { runId: '12345', attempt: '1', repetition: '1', scenario: 'packagedWorkspaceSuccess',
    buildRevision: 'a'.repeat(40), artifactDescriptorSha256: 'b'.repeat(64) };
  assert.deepEqual(evidenceBinding(f.env), expected);
  assert.deepEqual(evidenceBinding({ ...f.env, EKY_WORKSPACE_FAULT_SCENARIO: '' }), expected);
  for (const faultScenario of FAULT_SCENARIOS) {
    assert.deepEqual(evidenceBinding({ ...f.env, EKY_WORKSPACE_FAULT_SCENARIO: faultScenario }), {
      ...expected, scenario: 'packagedWorkspaceFaultRollback', faultScenario,
    });
  }
  for (const value of ['unknown', 'preUpdateRecoveryPointFailure', 'AcceptanceInterruption',
    'acceptanceInterruption ', 'activeWorkspaceFirstStartFailure\n', false, 0, {}]) {
    assert.throws(() => evidenceBinding({ ...f.env, EKY_WORKSPACE_FAULT_SCENARIO: value }),
      /WORKSPACE_ENCRYPTED_EVIDENCE_UNVERIFIED/u);
  }
});

for (const faultScenario of FAULT_SCENARIOS) for (const testOutcome of ['failure', 'cancelled']) {
  test(`fault evidence preserves stopped capture and exact binding without a caller: ${faultScenario}/${testOutcome}`, async t => {
    const f = await fixture(t, { EKY_WORKSPACE_FAULT_SCENARIO: faultScenario, EKY_TEST_OUTCOME: testOutcome });
    const context = JSON.parse(await readFile(join(f.root, 'context.private.json'), 'utf8'));
    assert.equal(context.binding.scenario, 'packagedWorkspaceFaultRollback');
    assert.equal(context.binding.faultScenario, faultScenario);
    assert.ok(f.callerResultPath.includes(`eky-workspace-caller-${context.invocationId}`));
    await writeFile(join(f.capture, 'stopped'), '');
    await writeFile(join(f.capture, 'capture.etl'), 'synthetic stopped capture');
    const value = await envelope(await collectEvidence(f.env, f.root));
    assert.deepEqual(value.manifest.binding, { ...context.binding, invocationId: context.invocationId });
    assert.equal(value.manifest.outcomes.test, testOutcome);
    assert.equal(value.manifest.captureClosed, true);
    assert.equal(value.manifest.cleanup, 'unverified');
    assert.equal(value.manifest.unresolvedEvidenceHold, true);
    assert.equal(value.manifest.files.find(x => x.name === 'caller-result.json').status, 'missing');
    assert.equal(Buffer.from(value.files['capture.etl'], 'base64').toString(), 'synthetic stopped capture');
  });
}

test('fault evidence rejects changed selection, context and attempt before collection', async t => {
  const f = await fixture(t, { EKY_WORKSPACE_FAULT_SCENARIO: 'activeWorkspaceFirstStartFailure' });
  for (const changed of [{ EKY_WORKSPACE_FAULT_SCENARIO: 'passiveWorkspaceMigrationFailure' },
    { EKY_WORKSPACE_FAULT_SCENARIO: '' }, { GITHUB_RUN_ATTEMPT: '2' },
    { EKY_WORKSPACE_REPETITION: '2' }, { EXPECTED_BUILD_REVISION: 'c'.repeat(40) },
    { EXPECTED_DESCRIPTOR_SHA256: 'd'.repeat(64) }]) {
    await assert.rejects(collectEvidence({ ...f.env, ...changed }, f.root), /WORKSPACE_ENCRYPTED_EVIDENCE_UNVERIFIED/u);
  }
  const path = join(f.root, 'context.private.json');
  const context = JSON.parse(await readFile(path, 'utf8'));
  context.binding.faultScenario = 'passiveWorkspaceMigrationFailure';
  await writeFile(path, JSON.stringify(context));
  await assert.rejects(collectEvidence(f.env, f.root), /WORKSPACE_ENCRYPTED_EVIDENCE_UNVERIFIED/u);
});

test('only an exactly bound fault caller can attest cleanup; conflicting bytes remain private evidence', async t => {
  for (const mismatch of ['none', 'faultScenario', 'scenario', 'invocationId', 'buildRevision', 'outcome']) {
    const f = await fixture(t, { EKY_WORKSPACE_FAULT_SCENARIO: 'activeWorkspaceFirstStartFailure' });
    const context = JSON.parse(await readFile(join(f.root, 'context.private.json'), 'utf8'));
    const binding = { schemaVersion: 1, invocationId: context.invocationId,
      scenario: context.binding.scenario, faultScenario: context.binding.faultScenario,
      buildRevision: f.env.EXPECTED_BUILD_REVISION, artifactDescriptorSha256: f.env.EXPECTED_DESCRIPTOR_SHA256 };
    const caller = { binding: { ...binding }, outcome: {
      schemaVersion: 1, scenario: binding.scenario, faultScenario: binding.faultScenario,
      status: 'failed', errorCode: 'commandCancelled', processTreeAbsent: true, productProcessAbsent: true,
      fixtureRemoved: true, fixtureCleanupResultCode: 'fixtureRemoved', phaseWriterResultCode: 'writerAbsent',
      supervisorCleanupResultCode: 'processTreeAbsent', semanticCleanupResultCode: 'semanticCleanupCompleted',
      postconditionResultCode: 'exactProductsAbsent', removalPostconditionResultCode: 'installerFootprintAbsent',
    } };
    if (mismatch === 'faultScenario') caller.binding.faultScenario = 'passiveWorkspaceMigrationFailure';
    if (mismatch === 'scenario') caller.binding.scenario = 'packagedWorkspaceSuccess';
    if (mismatch === 'invocationId') caller.binding.invocationId = '0'.repeat(32);
    if (mismatch === 'buildRevision') caller.binding.buildRevision = 'c'.repeat(40);
    if (mismatch === 'outcome') caller.outcome.faultScenario = 'passiveWorkspaceMigrationFailure';
    if (mismatch === 'none') assert.doesNotThrow(() => validateWorkspaceCallerResult(caller, binding));
    else assert.throws(() => validateWorkspaceCallerResult(caller, binding));
    await writeFile(f.callerResultPath, JSON.stringify(caller));
    const value = await envelope(await collectEvidence(f.env, f.root));
    assert.equal(value.manifest.cleanup, mismatch === 'none' ? 'verified' : 'unverified', mismatch);
    assert.equal(value.manifest.outcomes.test, 'failure');
    assert.equal(value.manifest.binding.faultScenario, binding.faultScenario);
    assert.equal(value.manifest.files.find(x => x.name === 'caller-result.json').status, 'retained');
  }
});

test('first failure retains allowed bytes and independent outcomes without collecting other files', async t => {
  const f = await fixture(t);
  await writeFile(join(f.capture, 'stopped'), '');
  const trace = Buffer.alloc(131_077, 0x89);
  await writeFile(join(f.capture, 'capture.etl'), trace);
  await writeFile(join(f.capture, 'command-export.stderr.private.log'), 'synthetic native failure');
  await writeFile(join(f.capture, 'after.private.log'), 'WPR is not recording');
  await writeFile(join(f.capture, 'collectors-before-stop.private.log'), 'synthetic collector status');
  await writeFile(join(f.capture, 'not-allowlisted.txt'), 'must not enter archive');
  await writeFile(f.callerResultPath, '{"unfinished":true}');
  const collected = await collectEvidence(f.env, f.root);
  const value = await envelope(collected);
  assert.equal(value.manifest.outcomes.test, 'failure');
  assert.equal(value.manifest.outcomes.artifact, 'success');
  assert.equal(value.manifest.outcomes.analysis, 'failure');
  assert.equal(value.manifest.cleanup, 'unverified');
  assert.equal(value.manifest.unresolvedEvidenceHold, true);
  assert.equal(value.manifest.captureClosed, true);
  assert.equal(Object.hasOwn(value.files, 'not-allowlisted.txt'), false);
  assert.equal(Object.hasOwn(value.files, 'after.private.log'), true);
  assert.equal(Object.hasOwn(value.files, 'collectors-before-stop.private.log'), true);
  assert.equal(Buffer.from(value.files['capture.etl'], 'base64').equals(trace), true);
  for (const entry of value.manifest.files.filter(x => x.status === 'retained')) {
    const content = Buffer.from(value.files[entry.name], 'base64');
    assert.equal(content.length, entry.bytes);
    assert.equal(createHash('sha256').update(content).digest('hex') === entry.sha256, true);
  }
  assert.equal((await readFile(f.callerResultPath, 'utf8')).length > 0, true);
});

test('an unverified recorder stop excludes ETL but preserves available exporter errors', async t => {
  const f = await fixture(t);
  f.env.EKY_CAPTURE_STOP_OUTCOME = 'failure';
  await writeFile(join(f.capture, 'stopped'), '');
  await writeFile(join(f.capture, 'capture.etl'), 'partial');
  await writeFile(join(f.capture, 'command-export.stderr.private.log'), 'synthetic error');
  const value = await envelope(await collectEvidence(f.env, f.root));
  assert.equal(value.manifest.captureClosed, false);
  assert.equal(value.manifest.files.find(x => x.name === 'capture.etl').status, 'stopUnverified');
  assert.equal(Object.hasOwn(value.files, 'capture.etl'), false);
  assert.equal(Object.hasOwn(value.files, 'command-export.stderr.private.log'), true);
});

test('attempts, repetitions and invocation generations never overwrite first-failure evidence', async t => {
  const f = await fixture(t);
  await assert.rejects(prepareEvidence(f.env));
  const next = await prepareEvidence({ ...f.env, GITHUB_RUN_ATTEMPT: '2' });
  const other = await prepareEvidence({ ...f.env, EKY_WORKSPACE_REPETITION: '2' });
  assert.notEqual(f.root, next.root);
  assert.notEqual(f.root, other.root);
  assert.notEqual(f.callerResultPath, next.callerResultPath);
  await assert.rejects(collectEvidence({ ...f.env, EXPECTED_BUILD_REVISION: 'c'.repeat(40) }, f.root));
});

test('failed caller booleans do not override unverified semantic cleanup', async t => {
  const f = await fixture(t);
  const context = JSON.parse(await readFile(join(f.root, 'context.private.json'), 'utf8'));
  const binding = { schemaVersion: 1, invocationId: context.invocationId, scenario: 'packagedWorkspaceSuccess',
    faultScenario: null, buildRevision: f.env.EXPECTED_BUILD_REVISION,
    artifactDescriptorSha256: f.env.EXPECTED_DESCRIPTOR_SHA256 };
  const caller = { binding, outcome: {
    schemaVersion: 1, scenario: binding.scenario, status: 'failed', errorCode: 'semanticCleanupFailed',
    processTreeAbsent: true, productProcessAbsent: true, fixtureRemoved: true,
    fixtureCleanupResultCode: 'fixtureRemoved', phaseWriterResultCode: 'writerAbsent',
    supervisorCleanupResultCode: 'processTreeAbsent', semanticCleanupResultCode: 'semanticCleanupFailed',
    postconditionResultCode: 'exactProductsAbsent', removalPostconditionResultCode: 'installerFootprintAbsent',
  } };
  assert.doesNotThrow(() => validateWorkspaceCallerResult(caller, binding));
  await writeFile(f.callerResultPath, JSON.stringify(caller));
  const value = await envelope(await collectEvidence(f.env, f.root));
  assert.equal(value.manifest.files.find(x => x.name === 'caller-result.json').status, 'retained');
  assert.equal(value.manifest.cleanup, 'unverified');
});

test('missing and oversized files are explicit and do not become complete evidence', async t => {
  const f = await fixture(t);
  const file = await open(join(f.capture, 'export-metadata.private.json'), 'wx');
  await file.truncate(1024 * 1024 + 1);
  await file.close();
  f.env.EKY_ANALYSIS_OUTCOME = 'private arbitrary error';
  const value = await envelope(await collectEvidence(f.env, f.root));
  assert.equal(value.manifest.outcomes.analysis, 'unknown');
  assert.equal(value.manifest.cleanup, 'unverified');
  assert.equal(value.manifest.files.find(x => x.name === 'export-metadata.private.json').status, 'unverified');
  assert.equal(value.manifest.files.find(x => x.name === 'export-metadata.private.json').failureCode, 'sizeLimitExceeded');
  assert.equal(value.manifest.files.find(x => x.name === 'caller-result.json').status, 'missing');
  assert.equal(value.manifest.files.find(x => x.name === 'caller-result.json').failureCode, 'sourceMissing');
  assert.equal(Object.keys(value.files).length, 0);
});

test('hardlinks and redirected directories cannot pull unrelated content into the archive', async t => {
  const f = await fixture(t);
  const foreign = join(f.env.RUNNER_TEMP, 'unrelated');
  await mkdir(foreign);
  await writeFile(join(foreign, 'original'), 'excluded');
  await link(join(foreign, 'original'), join(f.capture, 'command-export.private.log'));
  let value = await envelope(await collectEvidence(f.env, f.root));
  assert.equal(value.manifest.files.find(x => x.name === 'command-export.private.log').status, 'unverified');
  assert.equal(value.manifest.files.find(x => x.name === 'command-export.private.log').failureCode, 'pathRejected');
  const next = await prepareEvidence({ ...f.env, GITHUB_RUN_ATTEMPT: '2' });
  await rm(f.capture, { recursive: true });
  await writeFile(join(foreign, 'command-export.private.log'), 'excluded directory');
  await symlink(foreign, f.capture, 'junction');
  value = await envelope(await collectEvidence({ ...f.env, GITHUB_RUN_ATTEMPT: '2' }, next.root));
  assert.equal(value.manifest.files.find(x => x.name === 'command-export.private.log').status, 'unverified');
  assert.equal(value.manifest.files.find(x => x.name === 'command-export.private.log').failureCode, 'pathRejected');
});

test('invalid bindings and unverified or secret key input are denied before enabling capture', async t => {
  const f = await fixture(t);
  for (const patch of [{ GITHUB_RUN_ID: '../escape' }, { GITHUB_RUN_ATTEMPT: '0' },
    { EKY_WORKSPACE_REPETITION: '3' }, { EXPECTED_BUILD_REVISION: 'wrong' }]) {
    assert.throws(() => evidenceBinding({ ...f.env, ...patch }));
  }
  for (const patch of [{ EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT: '' },
    { EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT: 'B'.repeat(40) },
    { EKY_DIAGNOSTIC_PUBLIC_KEY: '-----BEGIN PGP PRIVATE KEY BLOCK-----' }]) {
    await assert.rejects(prepareEvidence({ ...f.env, GITHUB_RUN_ATTEMPT: '2', ...patch }));
  }
});

test('delivery proof has a closed opt-in identity without weakening the normal artifact binding', async t => {
  const f = await fixture(t);
  const env = proofEnvironment(f.env);
  assert.deepEqual(deliveryProofBinding(env), { runId: '12345', attempt: '1',
    scenario: 'syntheticEncryptedEvidenceDelivery', sourceRevision: 'c'.repeat(40) });
  assert.deepEqual(evidenceBinding(env), evidenceBinding(f.env));
  for (const patch of [{ GITHUB_ACTIONS: 'false' }, { RUNNER_OS: 'Linux' },
    { RUNNER_ENVIRONMENT: 'self-hosted' }, { GITHUB_EVENT_NAME: 'pull_request' },
    { GITHUB_EVENT_NAME: 'push' }, { GITHUB_JOB: 'workspace_consumer' },
    { EKY_EVIDENCE_DELIVERY_PROOF: '' }, { EKY_EVIDENCE_DELIVERY_PROOF: 'true' },
    { GITHUB_RUN_ID: '../escape' }, { GITHUB_RUN_ATTEMPT: '0' }, { GITHUB_SHA: 'unknown' }]) {
    assert.throws(() => deliveryProofBinding({ ...env, ...patch }), /^Error: WORKSPACE_ENCRYPTED_EVIDENCE_UNVERIFIED$/);
  }
  assert.throws(() => evidenceBinding({ ...env, EXPECTED_DESCRIPTOR_SHA256: '' }));
});

test('delivery proof archives only fixed synthetic bytes and claims no test, capture or cleanup success', async t => {
  const f = await fixture(t);
  await writeFile(join(f.capture, 'command-export.stderr.private.log'), 'UNRELATED PRIVATE RUNNER DATA');
  await writeFile(join(f.capture, 'capture.etl'), 'UNRELATED PRIVATE TRACE');
  await writeFile(join(f.capture, 'stopped'), '');
  await writeFile(f.callerResultPath, 'UNRELATED PRIVATE CALLER');
  const env = proofEnvironment(f.env);
  delete env.EXPECTED_BUILD_REVISION;
  delete env.EXPECTED_DESCRIPTOR_SHA256;
  delete env.EKY_WORKSPACE_REPETITION;
  const { root, collected } = await prepareDeliveryProof(env);
  const value = await envelope(collected);
  assert.deepEqual(Object.keys(value.files), ['command-export.stderr.private.log']);
  const bytes = Buffer.from(value.files['command-export.stderr.private.log'], 'base64');
  assert.equal(bytes.toString('utf8'), 'EKY synthetic encrypted delivery proof v1\n');
  assert.deepEqual(value.manifest.files, [{ name: 'command-export.stderr.private.log', status: 'retained',
    bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }]);
  const { invocationId, ...binding } = value.manifest.binding;
  assert.match(invocationId, /^[0-9a-f]{32}$/);
  assert.deepEqual(binding, deliveryProofBinding(env));
  assert.deepEqual(value.manifest.outcomes, { test: 'skipped', artifact: 'skipped',
    captureStart: 'skipped', captureStop: 'skipped', analysis: 'skipped' });
  assert.equal(value.manifest.cleanup, 'unverified');
  assert.equal(value.manifest.captureClosed, false);
  assert.equal(value.manifest.unresolvedEvidenceHold, true);
  assert.notEqual(root, f.root);
  await assert.rejects(collectEvidence(f.env, root));
  const original = await readFile(collected.archivePath);
  await assert.rejects(prepareDeliveryProof(env));
  assert.equal((await readFile(collected.archivePath)).equals(original), true);
  const next = await prepareDeliveryProof({ ...env, GITHUB_RUN_ATTEMPT: '2' });
  assert.notEqual(next.root, root);
  assert.notEqual(next.collected.manifest.binding.invocationId, invocationId);
});

test('delivery proof rejects missing commissioning before creating an evidence directory', async t => {
  const f = await fixture(t);
  const env = proofEnvironment(f.env);
  for (const patch of [{ EKY_DIAGNOSTIC_PUBLIC_KEY: '' }, { EKY_DIAGNOSTIC_KEY_FINGERPRINT: '' },
    { EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT: '' }, { EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT: 'B'.repeat(40) },
    { EKY_DIAGNOSTIC_PUBLIC_KEY: '-----BEGIN PGP PRIVATE KEY BLOCK-----' }]) {
    await assert.rejects(prepareDeliveryProof({ ...env, ...patch }), /^Error: WORKSPACE_ENCRYPTED_EVIDENCE_UNVERIFIED$/);
  }
  await assert.rejects(readFile(join(f.env.RUNNER_TEMP, 'eky-encrypted-delivery-proof-12345-1', 'context.private.json')),
    { code: 'ENOENT' });
});

test('delivery proof CLI rejects extra arguments and non-opt-in invocations without raw output or publication', async t => {
  const f = await fixture(t);
  const event = join(f.env.RUNNER_TEMP, 'event.json');
  const output = join(f.env.RUNNER_TEMP, 'output.txt');
  await writeFile(event, JSON.stringify({ inputs: { mode: 'contracts' } }));
  await writeFile(output, '');
  for (const [extra, patch] of [[['private-extra-argument'], {}], [[], { GITHUB_EVENT_NAME: 'push' }],
    [[], { EKY_EVIDENCE_DELIVERY_PROOF: '' }], [[], {}]]) {
    const result = spawnSync(process.execPath, [join(HERE, 'workspaceEncryptedEvidence.mjs'), 'delivery-proof', ...extra], {
      env: { ...process.env, ...proofEnvironment(f.env), GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output, ...patch },
      encoding: 'utf8', timeout: 10_000, maxBuffer: 4096, windowsHide: true,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    const phase = Object.keys(patch).length > 0 ? 'invocationContext' : 'eventJson';
    const failure = process.platform === 'win32' && extra.length === 0
      ? JSON.stringify({ schemaVersion: 1, operation: 'syntheticEncryptedEvidenceDelivery', status: 'failed', phase }) + '\n'
      : '';
    assert.equal(result.stderr, failure + 'WORKSPACE_ENCRYPTED_EVIDENCE_UNVERIFIED\n');
    assert.equal(await readFile(output, 'utf8'), '');
  }
  await assert.rejects(readFile(join(f.env.RUNNER_TEMP, 'eky-encrypted-delivery-proof-12345-1', 'context.private.json')),
    { code: 'ENOENT' });
});

test('real consumer keeps mandatory result, first-attempt capture and encrypted-only publication separate', async () => {
  const source = await readFile(resolve(HERE, '../../../../../.github/workflows/windows-acceptance-v2-workspace.yml'), 'utf8');
  const consumer = source.split('  workspace_consumer:')[1].split('  workspace_fault_consumer:')[0];
  const blocks = consumer.split('      - name:');
  const block = name => blocks.find(value => value.startsWith(' ' + name));
  const execution = block('Run supervised workspace success once');
  assert.match(execution, /timeout-minutes: 25/);
  assert.match(execution, /verifyWorkspaceCallerResult/);
  assert.doesNotMatch(execution, /continue-on-error|captureInstaller|sealWorkspace|\|\| true/);
  assert.match(block('Reverify downloaded workspace artifact'), /always\(\)/);
  assert.doesNotMatch(block('Reverify downloaded workspace artifact'), /continue-on-error/);
  assert.ok(consumer.indexOf('Start optional workspace evidence capture') < consumer.indexOf('Run supervised workspace success once'));
  assert.ok(consumer.indexOf('Stop optional workspace evidence capture') < consumer.indexOf('Seal workspace evidence before publication'));
  assert.doesNotMatch(consumer, /-Mode analyze/);
  assert.match(block('Seal workspace evidence before publication'), /always\(\)/);
  assert.match(block('Prepare optional encrypted workspace evidence'), /VERIFIED_FINGERPRINT/);
  assert.match(block('Prepare optional encrypted workspace evidence'), /head\.repo\.full_name == github\.repository/);
  const upload = block('Upload encrypted workspace evidence only');
  assert.match(upload, /outputs\.sealed == 'true'/);
  assert.match(upload, /path: \$\{\{ steps\.evidence_seal\.outputs\.ciphertext \}\}/);
  assert.doesNotMatch(upload, /\.etl|\.log|\.private|\*\*|recipient/);
  assert.match(upload, /retention-days: 1/);
  assert.match(upload, /overwrite: false/);
  assert.match(source, /installer:test:encrypted-evidence/);
});
