import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createRunnerFailureSink, validateRunnerFailureEvidence } from '../../../test-reporters/runnerFailureEvidence.mjs';
import { projectExceptionChain, STARTUP_EXCEPTION_LIMITS } from '../../desktop/src/main/startupExceptionEvidence.ts';
import { captureWorkspaceDeletionFailure, shouldCaptureWorkspaceDeletionFailure } from '../src/fixtures/captureWorkspaceDeletionFailure.ts';

function input(evaluate) {
  return { application: { evaluate }, runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
    testInfo: { title: 'DESK-DELETE-PREPARE-001 synthetic boundary', testId: 'synthetic-case',
      file: 'electron/workspaceDeletionPreparation.spec.ts', line: 1, column: 1,
      retry: 1, repeatEachIndex: 0, annotations: [] } };
}

test('only a matching expected failure suppresses capture, never an unexpected timeout or interruption', () => {
  for (const [actual, expected, observed, capture] of [
    ['failed', 'failed', true, false],
    ['timedOut', 'failed', true, true],
    ['interrupted', 'failed', true, true],
    ['failed', 'passed', true, true],
    [undefined, 'passed', true, true],
    ['passed', 'passed', false, false],
    ['passed', 'failed', false, false],
  ]) assert.equal(shouldCaptureWorkspaceDeletionFailure(actual, expected, observed), capture);
});

test('the actual main reader reaches the existing bounded sink with attempt and runtime binding', async t => {
  const root = await mkdtemp(join(tmpdir(), 'eky-w73-evidence-'));
  let complete = false;
  t.after(() => complete ? rm(root, { recursive: true, force: true }) : undefined);
  const old = globalThis.__EKY_ELECTRON_E2E__;
  const projection = { chain: [
    { name: 'Error', message: 'SAFE_IPC_CODE', stack: 'Error: SAFE_IPC_CODE', truncated: false },
    { name: 'Error', message: 'SYNTHETIC_ORIGINAL', stack: 'Error: SYNTHETIC_ORIGINAL\n at syntheticOwner', truncated: false },
    { name: 'Error', message: 'SYNTHETIC_CAUSE', stack: 'Error: SYNTHETIC_CAUSE', truncated: false },
  ], incomplete: false };
  globalThis.__EKY_ELECTRON_E2E__ = { workspaceDeletionProof: { readFailures: () => ({ request: projection }) } };
  t.after(() => { if (old === undefined) delete globalThis.__EKY_ELECTRON_E2E__; else globalThis.__EKY_ELECTRON_E2E__ = old; });
  const context = input(async read => read());
  await captureWorkspaceDeletionFailure(context, createRunnerFailureSink({ env: {}, tempRoot: root }));
  assert.equal(context.testInfo.annotations[0].description, 'recorded');
  const [directory] = await readdir(root);
  const records = await readdir(join(root, directory));
  const file = records.find(name => !name.includes('summary'));
  const record = validateRunnerFailureEvidence(JSON.parse(await readFile(join(root, directory, file), 'utf8')));
  assert.equal(record.runner, 'playwright');
  assert.equal(record.phase, 'workspaceDeletionIpc');
  assert.equal(record.test.attempt, 1);
  assert.equal(record.test.id, `${context.testInfo.testId}:${context.runtimeInstanceId}`);
  assert.equal(record.exception.chain[1].message === 'SYNTHETIC_ORIGINAL', true);
  assert.equal(record.exception.chain[1].stack.includes('syntheticOwner'), true);
  assert.equal(record.exception.chain[2].message === 'SYNTHETIC_CAUSE', true);
  complete = true;
});

for (const [name, evaluate, expected] of [
  ['missing original', async () => undefined, 'missing'],
  ['unavailable main', async () => { throw new Error('SYNTHETIC_TRANSPORT_LOST'); }, 'captureFailed'],
  ['pending main read', () => new Promise(() => {}), 'captureFailed'],
]) {
  test(`${name} stays missing or failed without blocking cleanup indefinitely`, async () => {
    const context = input(evaluate);
    await captureWorkspaceDeletionFailure(context, { record() { assert.fail('No original was observed'); },
      async flush() { assert.fail('No original was observed'); } });
    assert.equal(context.testInfo.annotations[0].description, expected);
  });
}

test('a missing application is not evidence of a captured source cause', async () => {
  const context = { ...input(async () => undefined), application: undefined };
  await captureWorkspaceDeletionFailure(context, { record() { assert.fail(); }, async flush() { assert.fail(); } });
  assert.equal(context.testInfo.annotations[0].description, 'unavailable');
});

test('a truncated or incomplete main projection never claims complete source capture', async () => {
  for (const incomplete of [false, true]) {
    const projection = { chain: [{ name: 'Error', message: 'SYNTHETIC_BOUNDED',
      stack: 'synthetic', truncated: !incomplete }], incomplete };
    const context = input(async () => ({ request: projection }));
    let recorded;
    await captureWorkspaceDeletionFailure(context, { record(value) { recorded = value; }, async flush() { return { status: 'recorded' }; } });
    assert.equal(context.testInfo.annotations[0].description, 'partial');
    assert.equal(recorded.phase, 'workspaceDeletionIpc');
    assert.equal(recorded.projectedException, projection);
  }
});

test('sink and annotation failures cannot replace the application failure', async () => {
  const projection = { chain: [{ name: 'Error', message: 'SYNTHETIC_ORIGINAL', stack: 'synthetic', truncated: false }], incomplete: false };
  for (const throws of ['record', 'flush', 'annotation']) {
    const context = input(async () => ({ request: projection }));
    if (throws === 'annotation') context.testInfo.annotations = { push() { throw new Error('SYNTHETIC_ANNOTATION'); } };
    await assert.doesNotReject(captureWorkspaceDeletionFailure(context, {
      record() { if (throws === 'record') throw new Error('SYNTHETIC_SINK'); },
      async flush() { if (throws === 'flush') throw new Error('SYNTHETIC_DELIVERY'); return { status: 'partial' }; },
    }));
    if (throws !== 'annotation') assert.equal(context.testInfo.annotations[0].description, 'captureFailed');
  }
});

test('the delivered record preserves source truncation, depth limits and sink redaction', async t => {
  const root = await mkdtemp(join(tmpdir(), 'eky-w73-projection-'));
  let complete = false;
  t.after(() => complete ? rm(root, { recursive: true, force: true }) : undefined);
  const secret = 'synthetic-delivery-redaction';
  let original = new Error('SYNTHETIC_BOTTOM');
  for (let index = 0; index < STARTUP_EXCEPTION_LIMITS.depth + 2; index++) {
    original = new Error('x'.repeat(STARTUP_EXCEPTION_LIMITS.message + 128), { cause: original });
  }
  const projection = projectExceptionChain(original);
  projection.chain[0].message = secret;
  const context = input(async () => ({ request: projection }));
  await captureWorkspaceDeletionFailure(context, createRunnerFailureSink({ env: {}, tempRoot: root, secrets: [secret] }));
  const [directory] = await readdir(root);
  const records = await readdir(join(root, directory));
  const file = records.find(name => !name.includes('summary'));
  const bytes = await readFile(join(root, directory, file), 'utf8');
  const record = validateRunnerFailureEvidence(JSON.parse(bytes));
  assert.equal(record.exception.incomplete, true);
  assert.equal(record.exception.chain.length, STARTUP_EXCEPTION_LIMITS.depth);
  assert.equal(record.exception.chain.every(part => part.truncated), true);
  assert.equal(bytes.includes(secret), false);
  assert.equal(record.exception.chain[0].message, '[redacted]');
  assert.equal(context.testInfo.annotations[0].description, 'partial');
  complete = true;
});

test('request revocation and a later shutdown failure reach two distinct delivered records', async t => {
  const root = await mkdtemp(join(tmpdir(), 'eky-w73-two-causes-'));
  let complete = false;
  t.after(() => complete ? rm(root, { recursive: true, force: true }) : undefined);
  const context = input(async () => ({
    request: projectExceptionChain(new Error('SYNTHETIC_EXPECTED_REVOCATION')),
    shutdown: projectExceptionChain(new Error('SYNTHETIC_SHUTDOWN_FIRST', { cause: new Error('SYNTHETIC_SHUTDOWN_CAUSE') })),
  }));
  await captureWorkspaceDeletionFailure(context, createRunnerFailureSink({ env: {}, tempRoot: root }));
  const [directory] = await readdir(root);
  const names = (await readdir(join(root, directory))).filter(name => !name.includes('summary'));
  const records = await Promise.all(names.map(async name =>
    validateRunnerFailureEvidence(JSON.parse(await readFile(join(root, directory, name), 'utf8')))));
  assert.equal(records.length, 2);
  assert.equal(records.find(record => record.phase === 'workspaceDeletionIpc').exception.chain[0].message === 'SYNTHETIC_EXPECTED_REVOCATION', true);
  const shutdown = records.find(record => record.phase === 'workspaceDeletionShutdown');
  assert.equal(shutdown.exception.chain[0].message === 'SYNTHETIC_SHUTDOWN_FIRST', true);
  assert.equal(shutdown.exception.chain[1].message === 'SYNTHETIC_SHUTDOWN_CAUSE', true);
  assert.equal(context.testInfo.annotations[0].description, 'recorded');
  complete = true;
});
