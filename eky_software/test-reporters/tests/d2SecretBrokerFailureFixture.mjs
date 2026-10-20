import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { createRunnerFailureSink, runnerFailureBinding, validateRunnerFailureEvidence } from '../runnerFailureEvidence.mjs';

export const D2_ORIGINAL_MARKER = 'D2_READ_ORIGINAL_MARKER';
export const D2_CAUSE_MARKER = 'D2_READ_CAUSE_MARKER';
export const D2_FAILURE_PHASE = 'd2BrokerCatch';
const syntheticFailures = new WeakSet();

export function createD2ReadCandidateFailure() {
  const error = new Error(D2_ORIGINAL_MARKER, { cause: new Error(D2_CAUSE_MARKER) });
  syntheticFailures.add(error);
  return error;
}

// Bind to SecretBrokerObserver.captureOriginalException, never wrap the dependency.
// Only this fixture's marker errors are eligible; this is not a real-secret collector.
export function createD2OriginalExceptionCapture(context, sink = createRunnerFailureSink()) {
  let firstFailure;
  context.onTestFailed(async () => {
    const observed = firstFailure;
    firstFailure = undefined;
    if (observed === undefined || context.task.fails) return;
    try {
      const task = context.task;
      const retryCount = task.result?.retryCount ?? 0;
      const repeatCount = task.result?.repeatCount ?? 0;
      sink.record({
        runner: 'vitest', phase: D2_FAILURE_PHASE, error: observed.error,
        testName: task.fullTestName, testId: task.id, file: task.file.filepath,
        line: task.location?.line, column: task.location?.column,
        retryCount, repeatCount,
        attempt: retryCount === 0 && repeatCount === 0 ? 0 : undefined,
      });
      await sink.flush();
    } catch { /* Optional evidence cannot replace the test's assertion or cleanup. */ }
  });
  return error => {
    if (syntheticFailures.has(error)) firstFailure ??= { error };
  };
}

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WORKER_TIMEOUT_MS = 30_000;
const TEST_NAME = 'D2 broker has operation at the original-exception catch';
const moduleUrl = path => new URL(path, import.meta.url).href;

export async function runD2Worker(parent, name, { mode = 'unexpected', observe = true, missingStorage = false, binding = {} } = {}) {
  const directory = join(parent, name);
  const temporary = join(directory, 'temporary');
  await mkdir(temporary, { recursive: true });
  const temp = await realpath(temporary);
  const file = join(directory, 'd2-broker.test.mjs');
  const config = join(directory, 'vitest.config.mjs');
  await writeFile(config, `export default { test: {
    include: ['d2-broker.test.mjs'], maxWorkers: 1, fileParallelism: false,
    retry: 0, testTimeout: 5000, hookTimeout: 2000, includeTaskLocation: true,
  } };`, { flag: 'wx', mode: 0o600 });
  await writeFile(file, `import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { test, expect, vi } from ${JSON.stringify(moduleUrl('../../node_modules/vitest/dist/index.js'))};
import { handleSecretBrokerMessage } from ${JSON.stringify(moduleUrl('../../apps/desktop/src/secrets/secretBrokerMain.ts'))};
import { createSecretBrokerRequest, readSecretBrokerBinding } from ${JSON.stringify(moduleUrl('../../apps/desktop/src/secrets/secretBrokerProtocol.ts'))};
import { createRunnerFailureSink } from ${JSON.stringify(moduleUrl('../runnerFailureEvidence.mjs'))};
import { createD2OriginalExceptionCapture, createD2ReadCandidateFailure,
  D2_ORIGINAL_MARKER, D2_CAUSE_MARKER } from ${JSON.stringify(moduleUrl('./d2SecretBrokerFailureFixture.mjs'))};

test(${JSON.stringify(TEST_NAME)}, { fails: ${mode === 'expected-failure'} }, async context => {
  const original = ${mode === 'unregistered-source'
    ? 'new Error(D2_ORIGINAL_MARKER, { cause: new Error(D2_CAUSE_MARKER) })'
    : 'createD2ReadCandidateFailure()'};
  // Inject only a benign marker rejection. No wrapper observes this dependency.
  const readCandidate = vi.fn(async () => {
    if (${mode === 'success'}) return null;
    throw original;
  });
  const unused = vi.fn(async () => { throw new Error('D2_UNEXPECTED_ADAPTER_CALL'); });
  const order = [];
  const operationFailed = vi.fn(() => {
    order.push('public');
    if (${mode === 'public-observer-throws'}) throw new Error('D2_PUBLIC_OBSERVER_FAILURE');
  });
  const sink = createRunnerFailureSink(${missingStorage ? "{ tempRoot: join(process.env.TMPDIR, 'missing') }" : ''});
  const capture = createD2OriginalExceptionCapture(context, sink);
  const captureOriginalException = vi.fn(error => {
    order.push('original');
    if (${mode === 'capture-throws'}) throw new Error('D2_PRIVATE_OBSERVER_FAILURE');
    capture(error);
  });
  const request = createSecretBrokerRequest({
    companyId: 'example-company', generationId: randomUUID(), requestId: randomUUID(),
    operation: 'hasCompanyEmailSecret',
  });
  const response = await handleSecretBrokerMessage(request, {
    generationId: request.generationId,
    encryptedSecretFile: { readCandidate, confirm: unused, write: unused, remove: unused },
    protector: { encrypt: unused, decrypt: unused },
    observer: { operationFailed, ${observe ? 'captureOriginalException' : ''} },
  });
  expect(readCandidate).toHaveBeenCalledTimes(1);
  expect(unused).not.toHaveBeenCalled();
  expect(response?.requestId).toBe(request.requestId);
  if (${mode === 'success'}) {
    expect(operationFailed).not.toHaveBeenCalled();
    expect(captureOriginalException).not.toHaveBeenCalled();
    expect(response?.ok).toBe(true);
    expect(response?.result?.configured).toBe(false);
    return;
  }
  // Boolean checks cannot print the original exception if the contract regresses.
  expect(captureOriginalException.mock.calls.length).toBe(${observe ? 1 : 0});
  if (${observe}) {
    const args = captureOriginalException.mock.calls[0];
    expect(args.length === 1 && args[0] === original).toBe(true);
  }
  expect(order).toEqual(${JSON.stringify(observe ? ['original', 'public'] : ['public'])});
  expect(operationFailed).toHaveBeenCalledTimes(1);
  const publicArgs = operationFailed.mock.calls[0];
  expect(publicArgs.length === 2 && publicArgs[0] === request.operation &&
    publicArgs[1] === 'SECRET_STORAGE_UNAVAILABLE').toBe(true);
  expect(isDeepStrictEqual(response, { ...readSecretBrokerBinding(request),
    ok: false, errorCode: 'SECRET_STORAGE_UNAVAILABLE', effect: 'noEffect' })).toBe(true);
  if (${mode === 'expected-rejection'}) return;

  // Deliberately wrong outcome expectation, not a rethrow of the adapter exception.
  expect(response.ok, 'D2_BROKER_EXPECTED_SUCCESS').toBe(true);
});
`, { flag: 'wx', mode: 0o600 });
  const env = { ...process.env, GITHUB_ACTIONS: 'false', ...binding,
    TEMP: temp, TMP: temp, TMPDIR: temp, CI: '1', NO_COLOR: '1' };
  delete env.NODE_TEST_CONTEXT;
  delete env.FORCE_COLOR;
  const child = spawnSync(process.execPath, [join(ROOT, 'node_modules/vitest/vitest.mjs'),
    'run', '--config', config, '--reporter=default',
    '--reporter=' + fileURLToPath(new URL('../vitestFailureReporter.mjs', import.meta.url))], {
    cwd: directory, env, encoding: 'utf8', timeout: WORKER_TIMEOUT_MS,
    maxBuffer: 512 * 1024, windowsHide: true,
  });
  await writeFile(join(directory, 'worker-output.private.json'), JSON.stringify({
    status: child.status, signal: child.signal, stdout: child.stdout, stderr: child.stderr,
    processError: child.error?.code ?? null,
  }), { flag: 'wx', mode: 0o600 });
  assert.equal(child.error === undefined, true, 'D2_WORKER_DID_NOT_COMPLETE');
  assert.equal(child.signal, null, 'D2_WORKER_WAS_INTERRUPTED');
  const publicOutput = (child.stdout ?? '') + (child.stderr ?? '');
  for (const marker of [D2_ORIGINAL_MARKER, D2_CAUSE_MARKER]) {
    assert.equal(publicOutput.includes(marker), false, 'D2_ORIGINAL_LEAKED_TO_PUBLIC_OUTPUT');
  }
  return { child, publicOutput, env, temp, file, records: await readEvidence(temp) };
}

async function readEvidence(temp) {
  const records = [];
  for (const directory of await readdir(temp)) {
    if (!directory.startsWith('eky-test-errors-')) continue;
    for (const filename of await readdir(join(temp, directory))) {
      const bytes = await readFile(join(temp, directory, filename));
      const record = validateRunnerFailureEvidence(JSON.parse(bytes));
      assert.equal(directory === 'eky-test-errors-' + record.invocationId, true, 'D2_INVOCATION_MISMATCH');
      records.push({ bytes, record, source: `temporary/${directory}/${filename}` });
    }
  }
  return records;
}

export function assertOriginalProof(worker, records = worker.records) {
  assert.equal(worker.child.status, 1, 'D2_UNEXPECTED_FAILURE_MUST_STAY_RED');
  const originals = records.filter(({ record }) => record.kind === 'runnerFailure' && record.phase === D2_FAILURE_PHASE);
  assert.equal(originals.length, 1, 'D2_ORIGINAL_BOUNDARY_EVIDENCE_MISSING');
  const original = originals[0].record;
  assert.equal(original.runner, 'vitest');
  assert.equal(original.exception.chain.length, 2);
  assert.equal(original.exception.chain[0].message === D2_ORIGINAL_MARKER, true, 'D2_ORIGINAL_MESSAGE_MISSING');
  assert.equal(original.exception.chain[1].message === D2_CAUSE_MARKER, true, 'D2_ORIGINAL_CAUSE_MISSING');
  assert.equal(original.exception.chain[0].stack?.includes('createD2ReadCandidateFailure'), true, 'D2_ORIGINAL_STACK_MISSING');
  assert.equal(original.exception.chain[1].stack?.includes(D2_CAUSE_MARKER), true, 'D2_CAUSE_STACK_MISSING');
  assert.equal(original.exception.incomplete, false);
  assert.equal(original.exception.chain.some(part => part.truncated), false);
  assert.equal(isDeepStrictEqual(original.binding, runnerFailureBinding(worker.env)), true, 'D2_BINDING_MISMATCH');
  assert.equal(original.test.name === TEST_NAME, true, 'D2_TEST_NAME_MISMATCH');
  assert.equal(resolve(original.test.file) === resolve(worker.file), true, 'D2_TEST_FILE_MISMATCH');
  assert.equal(Number.isInteger(original.test.line) && original.test.line > 0, true, 'D2_TEST_LOCATION_MISSING');
  assert.equal(original.test.attempt, 0);
  assert.equal(original.test.retryCount, 0);
  assert.equal(original.test.repeatCount, 0);
  const assertion = records.find(({ record }) => record.kind === 'runnerFailure' && record.phase === 'testFailure');
  assert.equal(assertion !== undefined, true, 'D2_REPORTER_ASSERTION_MISSING');
  assert.equal(assertion.record.test.id === original.test.id, true, 'D2_TEST_ID_MISMATCH');
  assert.equal(assertion.record.exception.chain.some(part => part.message?.includes('D2_BROKER_EXPECTED_SUCCESS')), true, 'D2_ASSERTION_CHANGED');
  assert.equal(JSON.stringify(assertion.record.exception).includes(D2_ORIGINAL_MARKER), false, 'D2_MARKER_WAS_RETHROWN');
  const summary = records.find(({ record }) => record.kind === 'runnerFailureSummary' && record.invocationId === original.invocationId);
  assert.equal(summary?.record.status, 'recorded');
  assert.equal(summary.record.recorded, 1);
}
