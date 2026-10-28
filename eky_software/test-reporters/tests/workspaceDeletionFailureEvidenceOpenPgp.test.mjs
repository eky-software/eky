import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { projectExceptionChain, STARTUP_EXCEPTION_LIMITS } from '../../apps/desktop/src/main/startupExceptionEvidence.ts';
import { captureWorkspaceDeletionFailure } from '../../apps/e2e/src/fixtures/captureWorkspaceDeletionFailure.ts';
import { createRunnerFailureSink, validateRunnerFailureEvidence } from '../runnerFailureEvidence.mjs';
import { collectJobFailureEvidence } from '../../apps/desktop/installer/windows-acceptance-harness/ciFailureEvidence.mjs';
import { encryptArchive } from '../../apps/desktop/installer/windows-acceptance-harness/workspaceEncryptedEvidence.mjs';
import { createOpenPgpTestFixture } from '../../apps/desktop/installer/windows-acceptance-harness/openPgpTestFixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

test('W7.3 main projections retain original causes and coverage through OpenPGP delivery', {
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
    const originals = new Map();
    for (const directory of await readdir(temp)) {
      for (const file of await readdir(join(temp, directory))) {
        originals.set(`temporary/${directory}/${file}`, await readFile(join(temp, directory, file)));
      }
    }
    assert.equal(originals.size, 3);
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
    for (const record of records) {
      assert.equal(record.test.attempt, 0);
      assert.equal(record.test.id.endsWith(':11111111-1111-4111-8111-111111111111'), true);
    }
    completed = true;
  } finally { await fixture.finish({ completed, failed: !completed }); }
});
