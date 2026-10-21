import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { validateRunnerFailureEvidence } from '../runnerFailureEvidence.mjs';
import { runD2Worker, assertOriginalProof } from './d2SecretBrokerFailureFixture.mjs';
import { collectJobFailureEvidence } from '../../apps/desktop/installer/windows-acceptance-harness/ciFailureEvidence.mjs';
import { encryptArchive } from '../../apps/desktop/installer/windows-acceptance-harness/workspaceEncryptedEvidence.mjs';
import { createOpenPgpTestFixture } from '../../apps/desktop/installer/windows-acceptance-harness/openPgpTestFixture.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

test('D2 broker evidence: OpenPGP boundary proof with isolated TEST key', {
  skip: !['win32', 'linux'].includes(process.platform), timeout: 240_000,
}, async () => {
  const fixture = await createOpenPgpTestFixture(ROOT);
  let completed = false;
  try {
    const recipient = await fixture.generate('d2-recipient');
    await fixture.invokeGpg(recipient.home, ['--pinentry-mode', 'loopback', '--passphrase', '',
      '--quick-add-key', recipient.fingerprint, 'cv25519', 'encr', '1d']);
    const publicPath = await fixture.exportKey(recipient, 'd2-public.asc');
    const checkout = join(fixture.root, 'empty-checkout');
    await mkdir(checkout);
    // Synthetic collector binding, not a hosted invocation or proof of CI admission/upload.
    const binding = { GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '98765', GITHUB_RUN_ATTEMPT: '1',
      GITHUB_JOB: 'd2-proof', EKY_EVIDENCE_JOB_KEY: 'd2-proof-0', GITHUB_SHA: 'a'.repeat(40) };
    const worker = await runD2Worker(fixture.root, 'broker-worker', { binding });
    assertOriginalProof(worker);
    const env = { ...binding, RUNNER_TEMP: worker.temp, GITHUB_WORKSPACE: checkout,
      EKY_EVIDENCE_JOB_OUTCOME: 'failure', EKY_DIAGNOSTIC_KEY_FINGERPRINT: recipient.fingerprint,
      EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT: recipient.fingerprint,
      EKY_DIAGNOSTIC_PUBLIC_KEY: await readFile(publicPath, 'utf8') };
    const collected = await collectJobFailureEvidence(env);
    await encryptArchive(collected.root, collected);
    const decrypted = await fixture.invokeGpg(recipient.home, ['--decrypt', join(collected.root, 'evidence.json.gz.gpg')]);
    const archive = JSON.parse(gunzipSync(decrypted.stdout));
    assert.equal(archive.manifest.scope, 'ciFailureEvidence');
    assert.equal(archive.manifest.jobOutcome, 'failure');
    assert.equal(archive.manifest.cleanup, 'notInferred');
    assert.equal(isDeepStrictEqual(archive.manifest.binding, collected.manifest.binding), true, 'D2_ARCHIVE_BINDING_MISMATCH');
    assert.equal(archive.manifest.files.length, worker.records.length, 'D2_ARCHIVE_FILE_SET_CHANGED');
    assert.equal(Object.keys(archive.files).length, worker.records.length);
    const originals = new Map(worker.records.map(item => [item.source, item.bytes]));
    const restored = archive.manifest.files.map(entry => {
      assert.equal(entry.kind, 'runnerFailure', 'D2_UNEXPECTED_CAPTURE_KIND');
      assert.equal(entry.status, 'retained', 'D2_CAPTURE_NOT_RETAINED');
      assert.equal(entry.location, 'runnerTemp');
      const bytes = Buffer.from(archive.files[entry.name], 'base64');
      assert.equal(bytes.length, entry.bytes, 'D2_RESTORED_SIZE_MISMATCH');
      assert.equal(sha256(bytes) === entry.sha256, true, 'D2_RESTORED_HASH_MISMATCH');
      const original = originals.get(entry.source);
      assert.equal(original !== undefined && bytes.equals(original), true, 'D2_ORIGINAL_BYTES_CHANGED');
      originals.delete(entry.source);
      return { bytes, record: validateRunnerFailureEvidence(JSON.parse(bytes)) };
    });
    assert.equal(originals.size, 0, 'D2_ORIGINAL_FILE_MISSING');
    assertOriginalProof(worker, restored);
    completed = true;
  } finally { await fixture.finish({ completed, failed: !completed }); }
});
