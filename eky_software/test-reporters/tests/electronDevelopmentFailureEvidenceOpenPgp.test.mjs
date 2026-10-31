import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';

import { createOpenPgpTestFixture } from '../../apps/desktop/installer/windows-acceptance-harness/openPgpTestFixture.mjs';
import { collectJobFailureEvidence } from '../../apps/desktop/installer/windows-acceptance-harness/ciFailureEvidence.mjs';
import { encryptArchive } from '../../apps/desktop/installer/windows-acceptance-harness/workspaceEncryptedEvidence.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

test('development Electron original survives real entrypoint exit and existing OpenPGP delivery', {
  skip: process.platform !== 'win32' ? 'Windows-owned Electron consumer only; not a Linux Electron path.' : false,
  timeout: 120_000,
}, async () => {
  // Ephemeral TEST-key agent IPC must not inherit a deep checkout path.
  const fixture = await createOpenPgpTestFixture(tmpdir());
  let completed = false;
  try {
    const recipient = await fixture.generate('electron-recipient');
    await fixture.invokeGpg(recipient.home, ['--pinentry-mode', 'loopback', '--passphrase', '',
      '--quick-add-key', recipient.fingerprint, 'cv25519', 'encr', '1d']);
    const publicPath = await fixture.exportKey(recipient, 'electron-public.asc');
    const directory = join(fixture.root, 'electron');
    const temp = join(directory, 'temporary');
    const checkout = join(directory, 'checkout');
    const output = join(checkout, 'eky_software/apps/e2e/test-results', `run-${randomUUID()}`);
    await mkdir(temp, { recursive: true }); await mkdir(output, { recursive: true });
    await writeFile(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }), { flag: 'wx' });
    const env = { GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '98765', GITHUB_RUN_ATTEMPT: '1',
      GITHUB_JOB: 'electron', EKY_EVIDENCE_JOB_KEY: 'core-electron-0', GITHUB_SHA: 'a'.repeat(40),
      EKY_EVIDENCE_JOB_OUTCOME: 'failure', RUNNER_TEMP: temp, GITHUB_WORKSPACE: checkout,
      TEMP: temp, TMP: temp, TMPDIR: temp, NODE_TEST_CONTEXT: undefined, CI: '1',
      EKY_DIAGNOSTIC_KEY_FINGERPRINT: recipient.fingerprint,
      EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT: recipient.fingerprint,
      EKY_DIAGNOSTIC_PUBLIC_KEY: await readFile(publicPath, 'utf8') };
    const sourcePath = path => new URL(path, import.meta.url).href;
    await writeFile(join(directory, 'fixture.spec.ts'), `
      import { test } from ${JSON.stringify(sourcePath('../../apps/e2e/src/fixtures/isolatedElectronTest.ts'))};
      test.use({ e2eElectronStartupMode: 'backendStartFailure' });
      test('DESK-STARTUP-ORIGINAL-001 synthetic unexpected startup failure', async ({ e2eElectron }) => {
        throw new Error('PROOF_BODY_MUST_NOT_RUN');
      });`, { flag: 'wx' });
    const configPath = join(directory, 'playwright.config.ts');
    await writeFile(configPath, `
      import { ELECTRON_E2E_TEST_TIMEOUT_MILLISECONDS } from ${JSON.stringify(sourcePath('../../apps/e2e/src/fixtures/electronLaunchBudgets.ts'))};
      export default { testDir: '.', testMatch: 'fixture.spec.ts', outputDir: ${JSON.stringify(output)},
        workers: 1, retries: 0, timeout: ELECTRON_E2E_TEST_TIMEOUT_MILLISECONDS,
        reporter: [[${JSON.stringify(fileURLToPath(new URL('../../apps/e2e/scripts/safeCiReporter.mjs', import.meta.url)))}]] };`, { flag: 'wx' });
    const child = await fixture.run(process.execPath, [join(ROOT, 'apps/e2e/node_modules/@playwright/test/cli.js'),
      'test', '--config', configPath], 60_000, { env, cwd: directory });
    assert.equal(child.status, 1, 'ELECTRON_PROOF_UNEXPECTED_FAILURE_REQUIRED');
    const publicOutput = Buffer.concat([child.stdout, child.stderr]).toString('utf8');
    assert.equal(publicOutput.includes('SYNTHETIC-E2E-STARTUP-ORIGINAL'), false);
    assert.equal(publicOutput.includes('SYNTHETIC-E2E-STARTUP-CAUSE'), false);
    assert.equal(publicOutput.includes('PROOF_BODY_MUST_NOT_RUN'), false);
    const terminal = publicOutput.split(/\r?\n/u).filter(line => line.startsWith('EKY_E2E_REPORT '))
      .map(line => JSON.parse(line.slice('EKY_E2E_REPORT '.length))).find(record => record.event === 'end');
    assert.ok(terminal, 'ELECTRON_PROOF_PUBLIC_TERMINAL_MISSING');
    assert.equal(terminal.status, 'failed');
    assert.equal(terminal.selected, 1);
    assert.equal(terminal.unexpected, 1);

    // Redaction control only: read this operation's one known synthetic config,
    // never include the config or its session in the collected evidence.
    const runDirectories = (await readdir(join(temp, 'eky-e2e'), { withFileTypes: true }))
      .filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && /^run-[A-Za-z0-9_-]+$/u.test(entry.name));
    assert.equal(runDirectories.length, 1, 'ELECTRON_PROOF_OWNED_ROOT_MISSING');
    const control = JSON.parse(await readFile(join(temp, 'eky-e2e', runDirectories[0].name,
      'DESK-STARTUP-ORIGINAL-001', 'electron-config.json'), 'utf8'));
    const sessionSecret = control.backend.sessionSecret;
    assert.equal(typeof sessionSecret === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(sessionSecret), true,
      'ELECTRON_PROOF_REDACTION_CONTROL_MISSING');
    assert.equal(publicOutput.includes(sessionSecret), false);

    const collected = await collectJobFailureEvidence(env);
    await encryptArchive(collected.root, collected);
    const decrypted = await fixture.invokeGpg(recipient.home, ['--decrypt', join(collected.root, 'evidence.json.gz.gpg')]);
    const value = JSON.parse(gunzipSync(decrypted.stdout));
    const entries = value.manifest.files.filter(file => file.status === 'retained');
    const records = entries.map(file => {
      const bytes = Buffer.from(value.files[file.name], 'base64');
      assert.equal(bytes.length, file.bytes);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
      return { file, record: JSON.parse(bytes) };
    });
    const original = records.find(({ file, record }) => file.kind === 'runnerFailure' &&
      record.kind === 'runnerFailure' && record.phase === 'electronStartup-runtimeStartup')?.record;
    assert.ok(original, 'ELECTRON_PROOF_ORIGINAL_MISSING');
    assert.equal(records.some(({ record }) => JSON.stringify(record).includes(sessionSecret)), false,
      'ELECTRON_PROOF_SESSION_DISCLOSURE');
    assert.equal(original.binding.kind, 'github');
    assert.equal(original.binding.runId, env.GITHUB_RUN_ID);
    assert.equal(original.binding.attempt, env.GITHUB_RUN_ATTEMPT);
    assert.equal(original.binding.sourceRevision, env.GITHUB_SHA);
    assert.equal(original.binding.jobKey, env.EKY_EVIDENCE_JOB_KEY);
    assert.equal(original.test.attempt, 0);
    assert.equal(/:[a-f0-9-]{36}$/u.test(original.test.id), true, 'ELECTRON_PROOF_RUNTIME_BINDING_INVALID');
    assert.equal(original.test.id.endsWith(':' + control.runtimeInstanceId), true);
    assert.equal(original.exception.chain[0].message === 'BACKEND_READINESS_TIMEOUT', true,
      'ELECTRON_PROOF_SOURCE_CODE_INVALID');
    assertOriginalRedaction(original, sessionSecret);
    assert.equal(original.exception.chain[2].message === 'SYNTHETIC-E2E-STARTUP-CAUSE', true,
      'ELECTRON_PROOF_ORIGINAL_CAUSE_INVALID');
    assert.equal(original.exception.incomplete, false);
    assert.equal(JSON.stringify(original).includes('DESKTOP_START_FAILED'), false);
    assert.equal(entries.some(file => file.source.endsWith('/electron-config.json')), false);
    const lifecycle = records.find(({ file }) => file.kind === 'electronLifecycle')?.record;
    assert.ok(lifecycle, 'ELECTRON_PROOF_LIFECYCLE_MISSING');
    assert.equal(lifecycle.launchExitCode, 1);
    assert.equal(lifecycle.firstLaunchFailure.phase, 'firstWindow');
    assert.equal(lifecycle.firstLaunchFailure.reason, 'processExited');
    assert.equal(lifecycle.ownership.owner.status, 'processTreeAbsent');
    assert.equal(lifecycle.cleanup.api, 'completed');
    assert.equal(lifecycle.cleanup.runtime, 'completed');
    assert.equal(lifecycle.cleanup.port, 'released');
    assert.equal(lifecycle.cleanup.runRoot, 'retained');
    assert.equal(value.manifest.jobOutcome, 'failure');
    assert.equal(value.manifest.cleanup, 'notInferred');
    completed = true;
  } finally {
    await fixture.finish({ completed, failed: !completed });
  }
});

function assertOriginalRedaction(record, secret) {
  assert.equal(JSON.stringify(record).includes(secret), false, 'ELECTRON_PROOF_SESSION_DISCLOSURE');
  assert.equal(record.exception.chain[1].message === 'SYNTHETIC-E2E-STARTUP-ORIGINAL [redacted]', true,
    'ELECTRON_PROOF_MESSAGE_REDACTION_INVALID');
  assert.equal(record.exception.chain[1].stack.split(/\r?\n/u)[0] ===
    'Error: SYNTHETIC-E2E-STARTUP-ORIGINAL [redacted]', true, 'ELECTRON_PROOF_STACK_REDACTION_INVALID');
}

test('redaction assertion failure never publishes the full or partial synthetic session', () => {
  const secret = 'synthetic-session-redaction-control';
  for (const exposed of [secret, secret.slice(0, 16)]) {
    const record = { exception: { chain: [{}, { message: 'SYNTHETIC-E2E-STARTUP-ORIGINAL [redacted]',
      stack: `Error: SYNTHETIC-E2E-STARTUP-ORIGINAL ${exposed}` }] } };
    assert.throws(() => assertOriginalRedaction(record, secret), error => {
      assert.equal(error.message.includes(exposed), false);
      assert.equal(JSON.stringify(error).includes(exposed), false);
      return true;
    });
  }
});
