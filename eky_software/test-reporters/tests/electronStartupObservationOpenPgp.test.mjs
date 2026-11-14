import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { gunzipSync } from 'node:zlib';

import { RUNNER_FAILURE_ROOT_PREFIX, validateRunnerFailureEvidence } from '../runnerFailureEvidence.mjs';
import { collectJobFailureEvidence } from '../../apps/desktop/installer/windows-acceptance-harness/ciFailureEvidence.mjs';
import { encryptArchive } from '../../apps/desktop/installer/windows-acceptance-harness/workspaceEncryptedEvidence.mjs';
import { createOpenPgpTestFixture } from '../../apps/desktop/installer/windows-acceptance-harness/openPgpTestFixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = path => new URL(path, import.meta.url).href;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const scenarios = [
  { name: 'current-work', stage: 'backendHealth', phase: 'work', version: 3 },
  { name: 'current-cleanup', stage: 'secretDrain', phase: 'cleanup', version: 3 },
  { name: 'legacy', version: 2 },
];
const markers = ['SYNTHETIC_STARTUP_ORIGINAL', 'SYNTHETIC_STARTUP_CAUSE', 'SYNTHETIC_STARTUP_CLEANUP'];
const secret = 'synthetic-startup-session-redaction-control';
const cleanup = { api: 'completed', runtime: 'unverified', port: 'released', runRoot: 'retained' };

test('shared startup capture and separate original failures survive lifecycle collection and OpenPGP', {
  skip: !['win32', 'linux'].includes(process.platform), timeout: 120_000,
}, async () => {
  // Reporting-only fixture: no Electron, native process owner, backend or build.
  const fixture = await createOpenPgpTestFixture(tmpdir());
  let completed = false;
  try {
    const directory = join(fixture.root, 'startup');
    await mkdir(join(directory, 'temporary'), { recursive: true });
    const temp = await realpath(join(directory, 'temporary'));
    const checkout = join(directory, 'checkout');
    const run = `run-${randomUUID()}`;
    const output = join(checkout, 'eky_software/apps/e2e/test-results', run);
    await mkdir(output, { recursive: true });
    const binding = { GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '98765', GITHUB_RUN_ATTEMPT: '2',
      GITHUB_JOB: 'startup-proof', EKY_EVIDENCE_JOB_KEY: 'startup-proof-0', GITHUB_SHA: 'a'.repeat(40) };
    await writeFile(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }), { flag: 'wx' });
    await writeFile(join(directory, 'startup.spec.ts'), `
import { test, expect } from ${JSON.stringify(source('../../apps/e2e/node_modules/@playwright/test/index.mjs'))};
import { isDeepStrictEqual } from 'node:util';
import { createElectronE2eStartupObservation, parseElectronE2eStartupObservation }
  from ${JSON.stringify(source('../../apps/desktop/e2e/electronE2eStartupObservation.ts'))};
import { emitDesktopStartupObservation, desktopStartupStagePhases }
  from ${JSON.stringify(source('../../apps/desktop/src/main/desktopStartupObservation.ts'))};
import { captureElectronStartupObservation }
  from ${JSON.stringify(source('../../apps/e2e/src/fixtures/launchElectronRuntime.ts'))};
import { reportElectronLifecycleEvidence }
  from ${JSON.stringify(source('../../apps/e2e/src/fixtures/reportElectronLifecycleEvidence.ts'))};
import { createRunnerFailureSink } from ${JSON.stringify(source('../runnerFailureEvidence.mjs'))};

for (const scenario of ${JSON.stringify(scenarios)}) {
  test(scenario.name, async ({}, info) => {
    let now = 100;
    const observation = createElectronE2eStartupObservation(() => now);
    observation.record('compositionStarted');
    now = 107;
    observation.recordBackendStartupStage('migration.initialAttestation.entered');
    now = 119;
    if (scenario.version === 3) {
      expect(desktopStartupStagePhases[scenario.stage] === scenario.phase).toBe(true);
      emitDesktopStartupObservation(signal => observation.recordMainStartup(signal), scenario.stage, 'entered');
    }
    const current = observation.snapshot();
    const wire = scenario.version === 2 ? {
      schemaVersion: 2, backendStartup: current.backendStartup,
      checkpoints: current.checkpoints, truncated: current.truncated,
    } : current;
    const read = Promise.resolve(JSON.parse(JSON.stringify(wire)));
    const finishCapture = captureElectronStartupObservation(() => read);
    await read;
    const startupCapture = finishCapture();
    expect(startupCapture.status === 'captured').toBe(true);
    expect(isDeepStrictEqual(startupCapture.observation, parseElectronE2eStartupObservation(wire))).toBe(true);
    const sink = createRunnerFailureSink();
    const context = { runner: 'playwright', testName: info.title, testId: info.testId,
      file: info.file, line: info.line, column: info.column,
      attempt: info.retry, repeatCount: info.repeatEachIndex };
    const original = new Error('SYNTHETIC_STARTUP_ORIGINAL ' + process.env.SYNTHETIC_STARTUP_SECRET,
      { cause: new Error('SYNTHETIC_STARTUP_CAUSE') });
    const closeError = new Error('SYNTHETIC_STARTUP_CLEANUP');
    sink.record({ ...context, phase: 'electronStartup-runtimeStartup', error: original });
    sink.record({ ...context, phase: 'electronPublicCloseObservation', error: closeError });
    const delivery = await sink.flush();
    expect(delivery.status === 'recorded' && delivery.recorded === 2).toBe(true);
    await reportElectronLifecycleEvidence(info, {
      launch: [{ phase: 'firstWindow', status: 'failed', reason: 'processExited' }],
      observationsTruncated: false, startupCapture,
      cleanup: ${JSON.stringify(cleanup)}, launchExitCode: 1,
      firstLaunchFailure: { startupGeneration: 1, phase: 'firstWindow', reason: 'processExited' },
      publicCloseFailure: { startupGeneration: 1, reason: 'failed' },
    });
    // Deliberate assertion failure, never a rethrow of either private exception.
    expect(false, 'STARTUP_OBSERVATION_EXPECTED_SUCCESS').toBe(true);
  });
}
`, { flag: 'wx', mode: 0o600 });
    const config = join(directory, 'playwright.config.ts');
    await writeFile(config, `export default {
      testDir: '.', testMatch: 'startup.spec.ts', outputDir: ${JSON.stringify(output)},
      workers: 1, retries: 0, timeout: 5000, globalTimeout: 30000,
      reporter: [[${JSON.stringify(fileURLToPath(new URL('../../apps/e2e/scripts/safeCiReporter.mjs', import.meta.url)))}]],
    };`, { flag: 'wx', mode: 0o600 });
    const child = await fixture.run(process.execPath, [join(root, 'apps/e2e/node_modules/@playwright/test/cli.js'),
      'test', '--config', config], 60_000, { cwd: directory, env: { ...binding,
        TEMP: temp, TMP: temp, TMPDIR: temp, CI: '1', NODE_TEST_CONTEXT: undefined,
        SYNTHETIC_STARTUP_SECRET: secret } });
    assert.equal(child.signal, null, 'STARTUP_PROOF_PROCESS_INTERRUPTED');
    assert.equal(child.status, 1, 'STARTUP_PROOF_EXPECTED_ASSERTIONS_DID_NOT_FAIL');
    const publicOutput = Buffer.concat([child.stdout, child.stderr]).toString('utf8');
    for (const text of [...markers, secret, 'mainStartup', 'backendHealth', 'secretDrain',
      'migration.initialAttestation.entered', 'STARTUP_OBSERVATION_EXPECTED_SUCCESS']) {
      assert.equal(publicOutput.includes(text), false, 'STARTUP_PROOF_PUBLIC_DISCLOSURE');
    }
    const rows = publicOutput.split(/\r?\n/u).filter(line => line.startsWith('EKY_E2E_REPORT '))
      .map(line => JSON.parse(line.slice('EKY_E2E_REPORT '.length)));
    const terminal = rows.find(row => row.event === 'end');
    assert.equal(terminal?.status, 'failed');
    assert.equal(terminal.selected, scenarios.length);
    assert.equal(terminal.unexpected, scenarios.length);
    assert.equal(terminal.globalErrors, 0);
    const attempts = rows.filter(row => row.event === 'testEnd');
    assert.equal(attempts.length, scenarios.length);
    for (const attempt of attempts) {
      assert.equal(attempt.status, 'failed');
      assert.equal(attempt.retry, 0);
      assert.equal(attempt.errorClass, 'testError');
      assert.equal(isDeepStrictEqual(attempt.electronLifecycle, {
        status: 'captured', attempt: 0, startupGeneration: 1, launchPhase: 'firstWindow',
        nativeCapture: 'notRequested', backendFailure: null, launchExitCode: 1,
        observationsTruncated: false, cleanup,
        publicCloseFailure: { startupGeneration: 1, reason: 'failed' },
      }), true, 'STARTUP_PROOF_PUBLIC_PROJECTION_CHANGED');
    }

    const originals = new Map();
    for (const attempt of await readdir(output, { withFileTypes: true })) {
      if (!attempt.isDirectory()) continue;
      const bytes = await readFile(join(output, attempt.name, 'electron-lifecycle.json'));
      originals.set(`results/${run}/${attempt.name}/electron-lifecycle.json`, bytes);
    }
    assert.equal(originals.size, scenarios.length, 'STARTUP_PROOF_LIFECYCLES_MISSING');
    for (const name of await readdir(temp)) {
      if (!name.startsWith(RUNNER_FAILURE_ROOT_PREFIX)) continue;
      for (const file of await readdir(join(temp, name))) {
        originals.set(`temporary/${name}/${file}`, await readFile(join(temp, name, file)));
      }
    }
    assert.equal(originals.size, 16, 'STARTUP_PROOF_SOURCE_SET_CHANGED');
    const recipient = await fixture.generate('startup-recipient');
    await fixture.invokeGpg(recipient.home, ['--pinentry-mode', 'loopback', '--passphrase', '',
      '--quick-add-key', recipient.fingerprint, 'cv25519', 'encr', '1d']);
    const publicPath = await fixture.exportKey(recipient, 'startup-public.asc');
    // Synthetic job identity tests collection, not hosted admission or upload.
    const collected = await collectJobFailureEvidence({ ...binding, RUNNER_TEMP: temp,
      GITHUB_WORKSPACE: checkout, EKY_EVIDENCE_JOB_OUTCOME: 'failure',
      EKY_DIAGNOSTIC_KEY_FINGERPRINT: recipient.fingerprint,
      EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT: recipient.fingerprint,
      EKY_DIAGNOSTIC_PUBLIC_KEY: await readFile(publicPath, 'utf8') });
    await encryptArchive(collected.root, collected);
    const decrypted = await fixture.invokeGpg(recipient.home, ['--decrypt', join(collected.root, 'evidence.json.gz.gpg')]);
    const archive = JSON.parse(gunzipSync(decrypted.stdout));
    const expectedBinding = { runId: binding.GITHUB_RUN_ID, attempt: binding.GITHUB_RUN_ATTEMPT,
      job: binding.GITHUB_JOB, jobKey: binding.EKY_EVIDENCE_JOB_KEY, sourceRevision: binding.GITHUB_SHA };
    assert.deepEqual(archive.manifest.binding, expectedBinding);
    assert.equal(archive.manifest.jobOutcome, 'failure');
    assert.equal(archive.manifest.cleanup, 'notInferred');
    assert.equal(archive.manifest.unresolvedEvidenceHold, true);
    assert.equal(archive.manifest.files.length, originals.size);
    assert.equal(Object.keys(archive.files).length, originals.size);
    const restored = archive.manifest.files.map(entry => {
      assert.equal(entry.status, 'retained', 'STARTUP_PROOF_SOURCE_NOT_RETAINED');
      assert.equal(['runnerFailure', 'electronLifecycle'].includes(entry.kind), true);
      assert.equal(entry.location, entry.kind === 'electronLifecycle' ? 'checkout' : 'runnerTemp');
      const bytes = Buffer.from(archive.files[entry.name], 'base64');
      const original = originals.get(entry.source);
      assert.equal(original !== undefined && bytes.equals(original), true, 'STARTUP_PROOF_SOURCE_BYTES_CHANGED');
      assert.equal(bytes.length, entry.bytes);
      assert.equal(sha256(bytes) === entry.sha256, true, 'STARTUP_PROOF_HASH_CHANGED');
      assert.equal(bytes.includes(Buffer.from(secret)), false, 'STARTUP_PROOF_SESSION_DISCLOSURE');
      originals.delete(entry.source);
      const record = JSON.parse(bytes);
      return { kind: entry.kind, record: entry.kind === 'runnerFailure' ? validateRunnerFailureEvidence(record) : record };
    });
    assert.equal(originals.size, 0, 'STARTUP_PROOF_SOURCE_MISSING');
    const lifecycles = restored.filter(item => item.kind === 'electronLifecycle').map(item => item.record);
    const failures = restored.filter(item => item.kind === 'runnerFailure').map(item => item.record);
    for (const scenario of scenarios) {
      const matches = lifecycles.filter(item => scenario.version === 2
        ? item.startupCapture.observation.schemaVersion === 2
        : item.startupCapture.observation.mainStartup?.stage === scenario.stage);
      assert.equal(matches.length, 1, 'STARTUP_PROOF_OBSERVATION_NOT_UNIQUE');
      const lifecycle = matches[0];
      assert.equal(lifecycle.startupCapture.status, 'captured');
      const observation = lifecycle.startupCapture.observation;
      assert.equal(observation.schemaVersion, scenario.version);
      assert.deepEqual(observation.backendStartup,
        { status: 'observed', stage: 'migration.initialAttestation.entered', elapsedMs: 7 });
      assert.deepEqual(observation.checkpoints, [{ checkpoint: 'compositionStarted', elapsedMs: 0 }]);
      assert.equal(observation.truncated, false);
      if (scenario.version === 3) assert.deepEqual(observation.mainStartup,
        { status: 'observed', stage: scenario.stage, phase: scenario.phase, event: 'entered', elapsedMs: 19 });
      else assert.equal(Object.hasOwn(observation, 'mainStartup'), false);
      assert.deepEqual(lifecycle.cleanup, cleanup);
      assert.equal(lifecycle.attempt, 0);
      const records = failures.filter(item => item.kind === 'runnerFailure' && item.test.name === scenario.name);
      assert.equal(records.length, 3, 'STARTUP_PROOF_FAILURES_NOT_SEPARATE');
      const primary = records.find(item => item.phase === 'electronStartup-runtimeStartup');
      const close = records.find(item => item.phase === 'electronPublicCloseObservation');
      const assertion = records.find(item => item.phase === 'testFailure');
      assert.ok(primary && close && assertion, 'STARTUP_PROOF_FAILURE_PHASE_MISSING');
      assert.equal(primary.invocationId, close.invocationId);
      assert.equal(primary.sequence, 1); assert.equal(close.sequence, 2);
      assert.equal(isDeepStrictEqual(primary.test, close.test), true, 'STARTUP_PROOF_TEST_BINDING_CHANGED');
      assert.equal(primary.test.id === assertion.test.id, true, 'STARTUP_PROOF_ASSERTION_BINDING_CHANGED');
      assert.equal(primary.exception.chain.length, 2);
      assert.equal(primary.exception.chain[0].message === markers[0] + ' [redacted]', true, 'STARTUP_PROOF_ORIGINAL_CHANGED');
      assert.equal(primary.exception.chain[1].message === markers[1], true, 'STARTUP_PROOF_CAUSE_CHANGED');
      assert.equal(close.exception.chain.length, 1);
      assert.equal(close.exception.chain[0].message === markers[2], true, 'STARTUP_PROOF_CLEANUP_CHANGED');
      for (const record of [primary, close]) {
        assert.equal(record.exception.incomplete, false);
        for (const part of record.exception.chain) {
          assert.equal(part.truncated, false);
          assert.equal(part.stack?.includes('startup.spec.ts'), true, 'STARTUP_PROOF_STACK_MISSING');
        }
      }
      assert.equal(primary.exception.chain[0].stack?.includes(markers[0] + ' [redacted]'), true, 'STARTUP_PROOF_STACK_REDACTION_MISSING');
      assert.equal(assertion.exception.chain[0].message?.includes('STARTUP_OBSERVATION_EXPECTED_SUCCESS'), true);
      assert.equal(markers.some(marker => JSON.stringify(assertion.exception).includes(marker)), false);
      for (const record of records) {
        assert.deepEqual(record.binding, { kind: 'github', ...expectedBinding, jobKeySource: 'explicit' });
        assert.equal(record.runner, 'playwright');
        assert.equal(record.test.attempt, 0); assert.equal(record.test.repeatCount, 0);
      }
    }
    const summaries = failures.filter(item => item.kind === 'runnerFailureSummary');
    assert.equal(summaries.length, 4);
    for (const summary of summaries) {
      assert.equal(summary.status, 'recorded');
      assert.equal(summary.rejected, 0); assert.equal(summary.omitted, 0); assert.equal(summary.limited, false);
      assert.equal(summary.recorded, failures.filter(item => item.kind === 'runnerFailure' &&
        item.invocationId === summary.invocationId).length);
    }
    completed = true;
  } finally { await fixture.finish({ completed, failed: !completed }); }
});
