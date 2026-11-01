import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { projectExceptionChain, STARTUP_EXCEPTION_LIMITS } from '../../apps/desktop/src/main/startupExceptionEvidence.ts';
import { captureWorkspaceDeletionFailure } from '../../apps/e2e/src/fixtures/captureWorkspaceDeletionFailure.ts';
import { runElectronWorkspaceAdoptionAcceptanceProof, runElectronWorkspaceOriginalInspectionProof } from '../../apps/e2e/src/electron/electronMainCapabilities.ts';
import { createRunnerFailureSink, validateRunnerFailureEvidence } from '../runnerFailureEvidence.mjs';
import { collectJobFailureEvidence } from '../../apps/desktop/installer/windows-acceptance-harness/ciFailureEvidence.mjs';
import { encryptArchive } from '../../apps/desktop/installer/windows-acceptance-harness/workspaceEncryptedEvidence.mjs';
import { createOpenPgpTestFixture } from '../../apps/desktop/installer/windows-acceptance-harness/openPgpTestFixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

test('workspace main projections retain original causes and coverage through OpenPGP delivery', {
  skip: !['win32', 'linux'].includes(process.platform), timeout: 240_000,
}, async () => {
  const fixture = await createOpenPgpTestFixture(root);
  let completed = false;
  try {
    const recipient = await fixture.generate('w73-recipient');
    await fixture.invokeGpg(recipient.home, ['--pinentry-mode', 'loopback', '--passphrase', '',
      '--quick-add-key', recipient.fingerprint, 'cv25519', 'encr', '1d']);
    const publicPath = await fixture.exportKey(recipient, 'w73-public.asc');
    const temp = join(fixture.root, 'runner-temp');
    const checkout = join(fixture.root, 'empty-checkout');
    await mkdir(temp); await mkdir(checkout);
    const binding = { GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '98765', GITHUB_RUN_ATTEMPT: '1',
      GITHUB_JOB: 'w73-proof', EKY_EVIDENCE_JOB_KEY: 'w73-proof-0', GITHUB_SHA: 'a'.repeat(40) };
    const source = new Error('SYNTHETIC_W73_ORIGINAL', { cause: new Error('SYNTHETIC_W73_CAUSE') });
    let deep = new Error('SYNTHETIC_BOTTOM');
    for (let index = 0; index < STARTUP_EXCEPTION_LIMITS.depth + 1; index++) {
      deep = new Error('x'.repeat(STARTUP_EXCEPTION_LIMITS.message + 128), { cause: deep });
    }
    const projection = { request: projectExceptionChain(source), shutdown: projectExceptionChain(deep) };
    const testInfo = { title: 'W7.3 synthetic IPC boundary failure', testId: 'w73-proof',
      file: 'electron/workspaceDeletionPreparation.spec.ts', line: 1, column: 1,
      retry: 0, repeatEachIndex: 0, annotations: [] };
    await captureWorkspaceDeletionFailure({
      // This isolates delivery from the separately tested actual Electron boundary.
      application: { evaluate: async () => projection },
      runtimeInstanceId: '11111111-1111-4111-8111-111111111111', testInfo,
    }, createRunnerFailureSink({ env: binding, tempRoot: temp }));
    assert.equal(testInfo.annotations[0].description, 'partial');
    const adoptionInfo = { ...testInfo, title: 'W7.4 synthetic adoption boundary failure', testId: 'w74-proof', annotations: [] };
    await assert.rejects(runElectronWorkspaceAdoptionAcceptanceProof({ evaluate: async () => ({
      status: 'failed', runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
      exception: projectExceptionChain(new Error('SYNTHETIC_W74_ADOPTION_ORIGINAL', {
        cause: new Error('SYNTHETIC_W74_ADOPTION_CAUSE'),
      })),
    }) }, adoptionInfo, createRunnerFailureSink({ env: binding, tempRoot: temp })),
    /^Error: WORKSPACE_ADOPTION_ACCEPTANCE_PROOF_FAILED$/);
    assert.equal(adoptionInfo.annotations[0].description, 'recorded');
    const originalInfo = { ...testInfo, title: 'W7.4 synthetic original-inspection boundary failure',
      testId: 'w74-original-proof', annotations: [] };
    await assert.rejects(runElectronWorkspaceOriginalInspectionProof({ evaluate: async () => ({
      status: 'failed', runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
      exception: projectExceptionChain(new Error('SYNTHETIC_W74_ROLLBACK_ORIGINAL', {
        cause: new Error('SYNTHETIC_W74_ROLLBACK_CAUSE'),
      })),
    }) }, originalInfo, createRunnerFailureSink({ env: binding, tempRoot: temp })),
    /^Error: WORKSPACE_ORIGINAL_INSPECTION_PROOF_FAILED$/);
    assert.equal(originalInfo.annotations[0].description, 'recorded');
    await runInspectionFailureWorker(fixture.root, temp, binding);
    const originals = new Map();
    for (const directory of await readdir(temp)) {
      for (const file of await readdir(join(temp, directory))) {
        originals.set(`temporary/${directory}/${file}`, await readFile(join(temp, directory, file)));
      }
    }
    assert.equal(originals.size, 11);
    // Synthetic collector identity, not hosted admission or an artifact upload.
    const collected = await collectJobFailureEvidence({ ...binding,
      RUNNER_TEMP: temp, GITHUB_WORKSPACE: checkout, EKY_EVIDENCE_JOB_OUTCOME: 'failure',
      EKY_DIAGNOSTIC_KEY_FINGERPRINT: recipient.fingerprint,
      EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT: recipient.fingerprint,
      EKY_DIAGNOSTIC_PUBLIC_KEY: await readFile(publicPath, 'utf8') });
    await encryptArchive(collected.root, collected);
    const decrypted = await fixture.invokeGpg(recipient.home, ['--decrypt', join(collected.root, 'evidence.json.gz.gpg')]);
    const archive = JSON.parse(gunzipSync(decrypted.stdout));
    assert.equal(archive.manifest.jobOutcome, 'failure');
    assert.equal(archive.manifest.cleanup, 'notInferred');
    assert.equal(archive.manifest.files.length, originals.size);
    const records = archive.manifest.files.map(entry => {
      assert.equal(entry.kind, 'runnerFailure'); assert.equal(entry.status, 'retained');
      const bytes = Buffer.from(archive.files[entry.name], 'base64');
      assert.equal(bytes.length, entry.bytes);
      assert.equal(sha256(bytes) === entry.sha256, true, 'W73_RESTORED_HASH_MISMATCH');
      assert.equal(bytes.equals(originals.get(entry.source) ?? Buffer.alloc(0)), true, 'W73_SOURCE_BYTES_CHANGED');
      originals.delete(entry.source);
      return validateRunnerFailureEvidence(JSON.parse(bytes));
    }).filter(record => record.kind === 'runnerFailure');
    assert.equal(originals.size, 0);
    const request = records.find(record => record.phase === 'workspaceDeletionIpc');
    assert.equal(request.exception.chain[0].message === 'SYNTHETIC_W73_ORIGINAL', true);
    assert.equal(request.exception.chain[1].message === 'SYNTHETIC_W73_CAUSE', true);
    assert.equal(request.exception.chain[0].stack.includes('workspaceDeletionFailureEvidenceOpenPgp'), true);
    const shutdown = records.find(record => record.phase === 'workspaceDeletionShutdown');
    assert.equal(shutdown.exception.incomplete, true);
    assert.equal(shutdown.exception.chain.every(part => part.truncated), true);
    const adoption = records.find(record => record.phase === 'workspaceAdoptionAcceptance');
    assert.equal(adoption.exception.chain[0].message === 'SYNTHETIC_W74_ADOPTION_ORIGINAL', true);
    assert.equal(adoption.exception.chain[1].message === 'SYNTHETIC_W74_ADOPTION_CAUSE', true);
    assert.equal(adoption.exception.chain[0].stack.includes('workspaceDeletionFailureEvidenceOpenPgp'), true);
    const original = records.find(record => record.phase === 'workspaceOriginalInspection');
    assert.equal(original.exception.chain[0].message === 'SYNTHETIC_W74_ROLLBACK_ORIGINAL', true);
    assert.equal(original.exception.chain[1].message === 'SYNTHETIC_W74_ROLLBACK_CAUSE', true);
    assert.equal(original.exception.chain[0].stack.includes('workspaceDeletionFailureEvidenceOpenPgp'), true);
    const inspection = records.find(record => record.phase === 'profileInspectionCatch');
    assert.equal(inspection.exception.chain[0].message === 'SYNTHETIC_W74_INSPECTION_ORIGINAL', true);
    assert.equal(inspection.exception.chain[1].message === 'SYNTHETIC_W74_INSPECTION_CAUSE', true);
    assert.equal(inspection.exception.chain[0].stack.includes('inspection.test.mjs'), true);
    const assertion = records.find(record => record.phase === 'testFailure');
    assert.equal(assertion.exception.chain[0].message.includes('W74_INSPECTION_EXPECTED_SUCCESS'), true);
    assert.equal(JSON.stringify(assertion.exception).includes('SYNTHETIC_W74_INSPECTION_ORIGINAL'), false);
    for (const record of records) {
      assert.equal(record.test.attempt, 0);
      if (record.phase !== 'testFailure') {
        assert.equal(record.test.id.endsWith(':11111111-1111-4111-8111-111111111111'), true);
      }
    }
    completed = true;
  } finally { await fixture.finish({ completed, failed: !completed }); }
});

async function runInspectionFailureWorker(parent, temp, binding) {
  const directory = join(parent, 'inspection-worker');
  await mkdir(directory);
  const moduleUrl = path => new URL(path, import.meta.url).href;
  const file = join(directory, 'inspection.test.mjs');
  const config = join(directory, 'vitest.config.mjs');
  await writeFile(config, `export default { resolve: { alias: {
    vitest: ${JSON.stringify(fileURLToPath(new URL('../../node_modules/vitest/dist/index.js', import.meta.url)))}
  } }, test: { include: ['inspection.test.mjs'],
    maxWorkers: 1, fileParallelism: false, retry: 0, testTimeout: 5000,
    hookTimeout: 2000, includeTaskLocation: true } };`, { flag: 'wx', mode: 0o600 });
  await writeFile(file, `import { resolve } from 'node:path';
import { test, expect, vi } from 'vitest';
import { runProfileSnapshotInspection } from ${JSON.stringify(moduleUrl('../../apps/desktop/src/profileBackup/runProfileSnapshotInspection.ts'))};
import { createRunnerFailureSink } from ${JSON.stringify(moduleUrl('../runnerFailureEvidence.mjs'))};
vi.mock('electron', () => ({ utilityProcess: { fork: vi.fn(() => { throw new Error('UNEXPECTED_INSPECTION_FORK'); }) } }));
test('inspection original exception before safe conversion', async context => {
  const original = new Error('SYNTHETIC_W74_INSPECTION_ORIGINAL', { cause: new Error('SYNTHETIC_W74_INSPECTION_CAUSE') });
  let first;
  const sink = createRunnerFailureSink();
  context.onTestFailed(async () => {
    if (first === undefined) return;
    const task = context.task;
    sink.record({ runner: 'vitest', phase: 'profileInspectionCatch', error: first,
      testName: task.fullTestName, testId: task.id + ':11111111-1111-4111-8111-111111111111',
      file: task.file.filepath, line: task.location?.line, column: task.location?.column,
      attempt: 0, retryCount: 0, repeatCount: 0 });
    await sink.flush();
  });
  const result = await runProfileSnapshotInspection({
    operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', target: { kind: 'unbound' },
    kind: 'inspect', migrationPolicy: 'restoreCompatible', runnerPath: resolve('unused-runner'),
    deployment: { backendRoot: resolve('unused-backend'), migrationsDirectory: resolve('unused-migrations'),
      nativeResourceRoot: resolve('unused-native') },
    reservation: { assertMainOwned: async () => {}, invalidate() {}, bind() { throw new Error('UNEXPECTED_BIND'); } },
    readActiveContext: async () => { throw original; }, assertAuthority() {}, signal: new AbortController().signal,
    observeException(error) { first ??= error; },
  }).catch(error => error);
  expect(first === original).toBe(true);
  expect(result.message === 'PROFILE_SNAPSHOT_VALIDATION_FAILED' && result.causeCode === 'unknown' && result.cause === undefined).toBe(true);
  expect(false, 'W74_INSPECTION_EXPECTED_SUCCESS').toBe(true);
});`, { flag: 'wx', mode: 0o600 });
  const env = { ...process.env, ...binding, CI: '1', NO_COLOR: '1', TEMP: temp, TMP: temp, TMPDIR: temp };
  delete env.NODE_TEST_CONTEXT; delete env.FORCE_COLOR;
  const child = spawnSync(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'),
    'run', '--config', config, '--reporter=default',
    '--reporter=' + fileURLToPath(new URL('../vitestFailureReporter.mjs', import.meta.url))], {
    cwd: directory, env, encoding: 'utf8', timeout: 30_000, maxBuffer: 512 * 1024, windowsHide: true,
  });
  await writeFile(join(directory, 'output.private.json'), JSON.stringify({ status: child.status,
    signal: child.signal, stdout: child.stdout, stderr: child.stderr, processError: child.error?.code ?? null }),
  { flag: 'wx', mode: 0o600 });
  assert.equal(child.error === undefined && child.signal === null, true, 'INSPECTION_WORKER_INTERRUPTED');
  assert.equal(child.status, 1, 'INSPECTION_EXPECTED_ASSERTION_DID_NOT_FAIL');
  const output = (child.stdout ?? '') + (child.stderr ?? '');
  for (const marker of ['SYNTHETIC_W74_INSPECTION_ORIGINAL', 'SYNTHETIC_W74_INSPECTION_CAUSE']) {
    assert.equal(output.includes(marker), false, 'INSPECTION_ORIGINAL_LEAKED_TO_PUBLIC_OUTPUT');
  }
}
