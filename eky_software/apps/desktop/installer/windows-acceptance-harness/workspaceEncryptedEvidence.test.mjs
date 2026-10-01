import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { link, mkdir, mkdtemp, open, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';
import { collectEvidence, deliveryProofBinding, evidenceBinding, prepareDeliveryProof, prepareEvidence } from './workspaceEncryptedEvidence.mjs';
import { validateWorkspaceCallerResult } from './workspaceCallerResult.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
async function fixture(t) {
  const temp = await mkdtemp(join(await realpath(tmpdir()), 'eky-encrypted-test-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const env = { RUNNER_TEMP: temp, GITHUB_RUN_ID: '12345', GITHUB_RUN_ATTEMPT: '1',
    EKY_WORKSPACE_REPETITION: '1', EXPECTED_BUILD_REVISION: 'a'.repeat(40),
    EXPECTED_DESCRIPTOR_SHA256: 'b'.repeat(64), EKY_DIAGNOSTIC_KEY_FINGERPRINT: 'A'.repeat(40),
    EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT: 'A'.repeat(40),
    EKY_DIAGNOSTIC_PUBLIC_KEY: '-----BEGIN PGP PUBLIC KEY BLOCK-----\nsynthetic-not-a-real-key\n-----END PGP PUBLIC KEY BLOCK-----',
    EKY_TEST_OUTCOME: 'failure', EKY_ARTIFACT_OUTCOME: 'success', EKY_CAPTURE_START_OUTCOME: 'success',
    EKY_CAPTURE_STOP_OUTCOME: 'success', EKY_ANALYSIS_OUTCOME: 'failure' };
  const prepared = await prepareEvidence(env);
  const capture = join(temp, 'eky-inspector-capture');
  await mkdir(capture);
  await mkdir(dirname(prepared.callerResultPath));
  return { env, ...prepared, capture };
}
async function envelope(collected) {
  return JSON.parse(gunzipSync(await readFile(collected.archivePath)));
}

function proofEnvironment(env) {
  return { ...env, GITHUB_ACTIONS: 'true', RUNNER_OS: 'Windows', RUNNER_ENVIRONMENT: 'github-hosted',
    GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_JOB: 'encrypted-evidence-delivery-proof',
    EKY_EVIDENCE_DELIVERY_PROOF: '1', GITHUB_SHA: 'c'.repeat(40) };
}

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
  assert.equal(value.manifest.files.find(x => x.name === 'caller-result.json').status, 'missing');
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
  const next = await prepareEvidence({ ...f.env, GITHUB_RUN_ATTEMPT: '2' });
  await rm(f.capture, { recursive: true });
  await writeFile(join(foreign, 'command-export.private.log'), 'excluded directory');
  await symlink(foreign, f.capture, 'junction');
  value = await envelope(await collectEvidence({ ...f.env, GITHUB_RUN_ATTEMPT: '2' }, next.root));
  assert.equal(value.manifest.files.find(x => x.name === 'command-export.private.log').status, 'unverified');
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
    assert.equal(result.stderr.trim(), 'WORKSPACE_ENCRYPTED_EVIDENCE_UNVERIFIED');
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
