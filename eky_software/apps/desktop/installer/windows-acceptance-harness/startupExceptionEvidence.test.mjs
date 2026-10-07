import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { link, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createStartupExceptionCapture, projectStartupException, startupExceptionDirectory,
  STARTUP_EXCEPTION_CONTROL, STARTUP_EXCEPTION_SUFFIX, STARTUP_EXCEPTION_LIMITS,
  validateStartupExceptionEvidence } from '../../src/main/startupExceptionEvidence.ts';
import { readLegacyOriginalExceptionEvidence, originalExceptionEvidenceAllowsRemoval,
  prepareLegacyStartupExceptionControl } from './legacyOriginalExceptionEvidence.mjs';
import { projectLegacyStartupTerminalEvidence } from './legacyStartupFailureEvidence.mjs';

const binding = { scenarioRunNonce: 'b'.repeat(64), appVersion: '0.2.81',
  buildRevision: 'a'.repeat(40), runtimeInstanceId: '12345678-1234-4abc-8abc-1234567890ab' };
const startup = { schemaVersion: 1, scenarioRunNonce: binding.scenarioRunNonce, artifactDescriptorSha256: 'c'.repeat(64),
  targetIdentity: { appVersion: binding.appVersion, buildRevision: binding.buildRevision }, status: 'notObserved', events: [] };

async function fixture(t) {
  const runRoot = await realpath(await mkdtemp(join(tmpdir(), 'eky-exception-test-')));
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  const tempPath = join(runRoot, 'source-smoke-temp');
  const root = startupExceptionDirectory(tempPath, binding.scenarioRunNonce);
  const userDataPath = join(root, 'user-data');
  await mkdir(userDataPath, { recursive: true });
  await mkdir(join(root, 'result'));
  const { runtimeInstanceId, ...identity } = binding;
  await writeFile(join(root, 'result', STARTUP_EXCEPTION_CONTROL), JSON.stringify({ schemaVersion: 1, ...identity }));
  const input = { enabled: true, tempPath, userDataPath, token: binding.scenarioRunNonce,
    runtimeInstanceId, appVersion: binding.appVersion, buildRevision: binding.buildRevision.slice(0, 12) };
  const reader = { runRoot, artifact: { target: startup.targetIdentity },
    supervisorResult: { runNonce: binding.scenarioRunNonce, processTreeAbsent: true } };
  return { input, reader, root, runRoot };
}

test('original exception projection bounds cause chains and excludes other properties and secrets', () => {
  const secret = 'synthetic-session-secret';
  const error = new Error(`password=EXCLUDED_PASSWORD Bearer EXCLUDED_TOKEN ${secret}`, {
    cause: new Error('original synthetic cause'),
  });
  error.extra = { businessPayload: 'EXCLUDED_PAYLOAD' };
  const record = projectStartupException(error, binding, 'runtimeStartup', [secret]);
  const text = JSON.stringify(record);
  assert.equal(text.includes('EXCLUDED'), false);
  assert.equal(text.includes(secret), false);
  assert.equal(record.chain.length, 2);
  assert.equal(record.chain[1].message === 'original synthetic cause', true);
  assert.equal(record.chain[0].stack.includes('Error:'), true);
  const cycle = new Error('x'.repeat(40000));
  cycle.cause = cycle;
  const bounded = projectStartupException(cycle, binding, 'compositionStartup');
  assert.equal(bounded.incomplete, true);
  assert.equal(bounded.chain[0].truncated, true);
  assert.equal(bounded.chain[0].message.length, STARTUP_EXCEPTION_LIMITS.message);
  const hostile = { get message() { throw new Error('must not execute'); }, toJSON() { throw new Error('must not execute'); } };
  assert.equal(projectStartupException(hostile, binding, 'earlyStartup').incomplete, true);
  assert.throws(() => validateStartupExceptionEvidence({ ...record, extra: true }), /startupExceptionEvidenceInvalid/);
});

test('capture stays disabled for ordinary profiles, mismatched controls and linked controls', async t => {
  const f = await fixture(t);
  assert.equal(typeof createStartupExceptionCapture(f.input), 'function');
  for (const change of [{ enabled: false }, { token: 'invalid' }, { userDataPath: f.runRoot },
    { appVersion: '0.2.6' }, { buildRevision: 'd'.repeat(40) }]) {
    assert.equal(createStartupExceptionCapture({ ...f.input, ...change }), undefined);
  }
  await link(join(f.root, 'result', STARTUP_EXCEPTION_CONTROL), join(f.runRoot, 'linked-control'));
  assert.equal(createStartupExceptionCapture(f.input), undefined);
});

test('a real child boundary retains the first exception after process exit without an acknowledgement wait', async t => {
  const f = await fixture(t);
  const source = pathToFileURL(fileURLToPath(new URL('../../src/main/startupExceptionEvidence.ts', import.meta.url))).href;
  const body = `import { createStartupExceptionCapture } from ${JSON.stringify(source)};
    const capture = createStartupExceptionCapture(${JSON.stringify(f.input)});
    if (!capture) process.exitCode = 2;
    else { capture(new Error('first original synthetic exception', { cause: new Error('synthetic underlying cause') }), 'compositionStartup');
      capture(new Error('EXCLUDED generalized fallback'), 'earlyStartup'); process.exitCode = 1; }`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', body], { stdio: 'ignore' });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  assert.equal(code, 1);
  const evidence = await readLegacyOriginalExceptionEvidence(f.reader, startup);
  assert.equal(evidence.status, 'recorded');
  assert.equal(evidence.exceptions.length, 1);
  assert.equal(evidence.exceptions[0].chain[0].message === 'first original synthetic exception', true);
  assert.equal(evidence.exceptions[0].chain[1].message === 'synthetic underlying cause', true);
  assert.equal(JSON.stringify(evidence).includes('EXCLUDED'), false);
  const saved = { binding: { schemaVersion: 1, runNonce: 'd'.repeat(64), scenario: 'acceptanceCommandPhase',
    artifactDescriptorSha256: startup.artifactDescriptorSha256 }, outcome: {}, startupEvidence: startup,
    originalExceptionEvidence: evidence };
  const projected = projectLegacyStartupTerminalEvidence(saved);
  assert.equal(projected.originalExceptionEvidence.exceptions.length, 1);
  assert.equal(Object.hasOwn(projected, 'outcome'), false);
  await rm(join(f.root, 'user-data'), { recursive: true });
  assert.equal(JSON.parse(JSON.stringify(projected)).originalExceptionEvidence.exceptions[0].chain.length, 2);
});

test('missing, partial, foreign and unowned evidence prevent destructive fixture cleanup', async t => {
  const f = await fixture(t);
  const failed = { ...startup, status: 'missing' };
  assert.equal((await readLegacyOriginalExceptionEvidence(f.reader, failed)).status, 'missing');
  const output = join(f.root, 'result', `${binding.runtimeInstanceId}${STARTUP_EXCEPTION_SUFFIX}`);
  await writeFile(output, '{"schemaVersion":1');
  assert.equal((await readLegacyOriginalExceptionEvidence(f.reader, failed)).status, 'unverified');
  await writeFile(output, JSON.stringify(projectStartupException(new Error('synthetic'),
    { ...binding, scenarioRunNonce: 'd'.repeat(64) }, 'earlyStartup')));
  assert.equal((await readLegacyOriginalExceptionEvidence(f.reader, failed)).status, 'unverified');
  assert.equal((await readLegacyOriginalExceptionEvidence({ ...f.reader,
    supervisorResult: { ...f.reader.supervisorResult, processTreeAbsent: false } }, failed)).status, 'unverified');
  assert.equal(originalExceptionEvidenceAllowsRemoval({ status: 'unverified' }), false);
  assert.equal(originalExceptionEvidenceAllowsRemoval({ status: 'missing' }), false);
});

test('exclusive per-runtime output cannot overwrite a preserved first exception', async t => {
  const f = await fixture(t);
  const output = join(f.root, 'result', `${binding.runtimeInstanceId}${STARTUP_EXCEPTION_SUFFIX}`);
  await writeFile(output, 'original retained bytes');
  createStartupExceptionCapture(f.input)(new Error('replacement'), 'compositionStartup');
  // A failed exclusive write neither replaces the file nor becomes a public error.
  assert.equal((await readFile(output, 'utf8')) === 'original retained bytes', true);
});

test('two target starts reuse the exact control but never replace mismatched evidence', async t => {
  const f = await fixture(t);
  await prepareLegacyStartupExceptionControl(f.runRoot, binding.scenarioRunNonce, startup.targetIdentity);
  await prepareLegacyStartupExceptionControl(f.runRoot, binding.scenarioRunNonce, startup.targetIdentity);
  await assert.rejects(prepareLegacyStartupExceptionControl(f.runRoot, binding.scenarioRunNonce,
    { ...startup.targetIdentity, buildRevision: 'd'.repeat(40) }), /legacyStartupEvidenceInvalid/);
  const failed = await readLegacyOriginalExceptionEvidence({ ...f.reader,
    supervisorResult: { ...f.reader.supervisorResult, status: 'failed' } }, startup);
  assert.equal(failed.status, 'missing');
  const successful = await readLegacyOriginalExceptionEvidence({ ...f.reader,
    supervisorResult: { ...f.reader.supervisorResult, status: 'completed' } }, startup);
  assert.equal(successful.status, 'notObserved');
});

test('mixed partial evidence preserves the independently verified first exception and forbids removal', async t => {
  const f = await fixture(t);
  const record = projectStartupException(new Error('first preserved'), binding, 'compositionStartup');
  await writeFile(join(f.root, 'result', `${binding.runtimeInstanceId}${STARTUP_EXCEPTION_SUFFIX}`), JSON.stringify(record));
  await writeFile(join(f.root, 'result', `${'22345678-1234-4abc-8abc-1234567890ab'}${STARTUP_EXCEPTION_SUFFIX}`), '{partial');
  const evidence = await readLegacyOriginalExceptionEvidence(f.reader, startup);
  assert.equal(evidence.status, 'unverified');
  assert.equal(evidence.exceptions.length, 1);
  assert.equal(evidence.exceptions[0].chain[0].message === 'first preserved', true);
  assert.equal(originalExceptionEvidenceAllowsRemoval(evidence), false);
});

test('immediate exit is reported as missing or partial, never as a delivered original exception', async t => {
  const f = await fixture(t);
  const source = new URL('../../src/main/startupExceptionEvidence.ts', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    `import {createStartupExceptionCapture} from ${JSON.stringify(source)};
     const capture=createStartupExceptionCapture(${JSON.stringify(f.input)});
     if(!capture) process.exit(2);
     capture(new Error('synthetic immediate exit'), 'earlyStartup'); process.exit(1);`], { stdio: 'ignore' });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  assert.equal(code, 1);
  const evidence = await readLegacyOriginalExceptionEvidence(f.reader, { ...startup, status: 'missing' });
  assert.equal(['missing', 'unverified'].includes(evidence.status), true);
  assert.equal(originalExceptionEvidenceAllowsRemoval(evidence), false);
});

test('short and long known secrets cannot survive in unlabelled exception text', () => {
  for (const secret of ['xy', 's'.repeat(5000)]) {
    const record = projectStartupException(new Error(`unlabelled ${secret}`), binding, 'compositionStartup', [secret]);
    assert.equal(JSON.stringify(record).includes(secret.slice(0, Math.min(secret.length, 16))), false);
  }
  const unrelated = projectStartupException(new Error('synthetic useful failure'), binding, 'compositionStartup', ['s'.repeat(5000)]);
  assert.equal(unrelated.chain[0].message === 'synthetic useful failure', true);
});

test('overlapping known secrets are redacted longest-first regardless of input order', () => {
  const short = 'short';
  for (const longer of [`${short}-sensitive-tail`, `${short}-${'sensitive-tail'.repeat(400)}`]) {
    for (const secrets of [[short, longer], [longer, short]]) {
      const record = projectStartupException(new Error(`unlabelled ${longer}`),
        binding, 'compositionStartup', secrets);
      const text = JSON.stringify(record);
      assert.equal(text.includes('sensitive-tail'), false);
      assert.equal(text.includes(short), false);
    }
  }
});
