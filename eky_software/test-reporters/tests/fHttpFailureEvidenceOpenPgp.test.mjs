import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { validateRunnerFailureEvidence } from '../runnerFailureEvidence.mjs';
import { runFWorker, assertFOriginalProof } from './fHttpFailureFixture.mjs';
import { collectJobFailureEvidence } from '../../apps/desktop/installer/windows-acceptance-harness/ciFailureEvidence.mjs';
import { encryptArchive } from '../../apps/desktop/installer/windows-acceptance-harness/workspaceEncryptedEvidence.mjs';
import { createOpenPgpTestFixture } from '../../apps/desktop/installer/windows-acceptance-harness/openPgpTestFixture.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

for (const mode of ['unexpected', 'diagnostic-read', 'desktop-log-write']) {
test(`HTTP evidence survives OpenPGP encryption and private decryption: ${mode}`, {
  skip: !['win32', 'linux'].includes(process.platform), timeout: 240_000,
}, async () => {
  const fixture = await createOpenPgpTestFixture(ROOT);
  let completed = false;
  try {
    const recipient = await fixture.generate('f-http-recipient');
    await fixture.invokeGpg(recipient.home, ['--pinentry-mode', 'loopback', '--passphrase', '',
      '--quick-add-key', recipient.fingerprint, 'cv25519', 'encr', '1d']);
    const publicPath = await fixture.exportKey(recipient, 'f-http-public.asc');
    const checkout = join(fixture.root, 'empty-checkout');
    await mkdir(checkout);
    const binding = { GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '98765', GITHUB_RUN_ATTEMPT: '1',
      GITHUB_JOB: 'f-http-proof', EKY_EVIDENCE_JOB_KEY: 'f-http-proof-0', GITHUB_SHA: 'a'.repeat(40) };
    const worker = await runFWorker(fixture.root, 'http-worker', { binding, mode });
    assertFOriginalProof(worker);
    const collected = await collectJobFailureEvidence({
      ...binding, RUNNER_TEMP: worker.temp, GITHUB_WORKSPACE: checkout,
      EKY_EVIDENCE_JOB_OUTCOME: 'failure',
      EKY_DIAGNOSTIC_KEY_FINGERPRINT: recipient.fingerprint,
      EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT: recipient.fingerprint,
      EKY_DIAGNOSTIC_PUBLIC_KEY: await readFile(publicPath, 'utf8'),
    });
    await encryptArchive(collected.root, collected);
    const decrypted = await fixture.invokeGpg(recipient.home, ['--decrypt', join(collected.root, 'evidence.json.gz.gpg')]);
    const archive = JSON.parse(gunzipSync(decrypted.stdout));
    assert.equal(archive.manifest.scope, 'ciFailureEvidence');
    assert.equal(archive.manifest.jobOutcome, 'failure');
    assert.equal(archive.manifest.cleanup, 'notInferred');
    assert.deepEqual(archive.manifest.binding, collected.manifest.binding);
    assert.equal(archive.manifest.files.length, worker.records.length, 'F_ARCHIVE_FILE_SET_CHANGED');
    assert.equal(Object.keys(archive.files).length, worker.records.length);
    const originals = new Map(worker.records.map(item => [item.source, item.bytes]));
    const restored = archive.manifest.files.map(entry => {
      assert.equal(entry.kind, 'runnerFailure');
      assert.equal(entry.status, 'retained');
      assert.equal(entry.location, 'runnerTemp');
      const bytes = Buffer.from(archive.files[entry.name], 'base64');
      assert.equal(bytes.length, entry.bytes, 'F_RESTORED_SIZE_MISMATCH');
      assert.equal(sha256(bytes) === entry.sha256, true, 'F_RESTORED_HASH_MISMATCH');
      assert.equal(bytes.equals(originals.get(entry.source) ?? Buffer.alloc(0)), true, 'F_ORIGINAL_BYTES_CHANGED');
      originals.delete(entry.source);
      return { bytes, record: validateRunnerFailureEvidence(JSON.parse(bytes)) };
    });
    assert.equal(originals.size, 0, 'F_ORIGINAL_FILE_MISSING');
    assertFOriginalProof(worker, restored);
    completed = true;
  } finally {
    await fixture.finish({ completed, failed: !completed });
  }
});
}
