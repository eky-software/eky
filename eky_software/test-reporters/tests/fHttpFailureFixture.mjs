import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { runnerFailureBinding, validateRunnerFailureEvidence } from '../runnerFailureEvidence.mjs';

export const F_ORIGINAL_MARKER = 'F_HTTP_ORIGINAL_MARKER';
export const F_CAUSE_MARKER = 'F_HTTP_CAUSE_MARKER';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TEST_NAME = 'F HTTP original exception at the production conversion boundary';
const moduleUrl = path => new URL(path, import.meta.url).href;

export async function runFWorker(parent, name, {
  mode = 'unexpected', observe = true, missingStorage = false, binding = {},
} = {}) {
  const directory = join(parent, name);
  await mkdir(join(directory, 'temporary'), { recursive: true });
  const temp = await realpath(join(directory, 'temporary'));
  const file = join(directory, 'http-error.test.mjs');
  const config = join(directory, 'vitest.config.mjs');
  await writeFile(config, `export default { test: {
    include: ['http-error.test.mjs'], maxWorkers: 1, fileParallelism: false,
    retry: 0, testTimeout: 5000, hookTimeout: 2000, includeTaskLocation: true,
  } };`, { flag: 'wx', mode: 0o600 });
  await writeFile(file, `import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { test, expect, vi } from ${JSON.stringify(moduleUrl('../../node_modules/vitest/dist/index.js'))};
import { Hono } from ${JSON.stringify(moduleUrl('../../apps/backend/node_modules/hono/dist/index.js'))};
import { handleUnexpectedHttpError } from ${JSON.stringify(moduleUrl('../../apps/backend/src/http/handleUnexpectedHttpError.ts'))};
import { createOperationalLoggingMiddleware } from ${JSON.stringify(moduleUrl('../../apps/backend/src/http/operationalLogging.ts'))};
import { listDiagnosticEvents } from ${JSON.stringify(moduleUrl('../../apps/backend/src/modules/diagnostics/application/listDiagnosticEvents.ts'))};
import { JsonLineDesktopOperationalLogger } from ${JSON.stringify(moduleUrl('../../apps/desktop/src/observability/infrastructure/jsonLineDesktopOperationalLogger.ts'))};
import { IncidentIndexDesktopLogFailureSink } from ${JSON.stringify(moduleUrl('../../apps/desktop/src/observability/infrastructure/incidentIndexDesktopLogFailureSink.ts'))};
import { createDesktopOperationalEvent } from ${JSON.stringify(moduleUrl('../../apps/desktop/src/observability/createDesktopOperationalEvent.ts'))};
import { createRunnerFailureSink } from ${JSON.stringify(moduleUrl('../runnerFailureEvidence.mjs'))};
import { createHttpRequestFailureCapture } from ${JSON.stringify(moduleUrl('../httpRequestFailureCapture.mjs'))};

function createOriginalFailure() {
  return new Error(${JSON.stringify(F_ORIGINAL_MARKER)}, {
    cause: new Error(${JSON.stringify(F_CAUSE_MARKER)}),
  });
}
test(${JSON.stringify(TEST_NAME)}, { fails: ${mode === 'expected-failure'} }, async context => {
  const original = ${mode === 'non-error' ? JSON.stringify(F_ORIGINAL_MARKER) : 'createOriginalFailure()'};
  const sink = createRunnerFailureSink(${missingStorage ? "{ tempRoot: join(process.env.TMPDIR, 'missing') }" : ''});
  const capture = createHttpRequestFailureCapture(context, sink);
  const order = [];
  const observer = { captureOriginalException(error) {
    order.push('original');
    if (${mode === 'capture-throws'}) throw new Error('F_PRIVATE_OBSERVER_FAILURE');
    capture.captureOriginalException(error);
  } };
  const selected = ${observe ? 'observer' : 'undefined'};
  const app = new Hono();
  app.onError((error, context) => handleUnexpectedHttpError(error, context, selected));
  const write = vi.fn(() => order.push('public'));
  app.use('*', createOperationalLoggingMiddleware({
    operationalIdentity: { appVersion: '0.0.0', buildRevision: 'a'.repeat(40),
      runtimeInstanceId: '11111111-1111-4111-8111-111111111111' },
    operationalLogger: { write }, httpRequestFailureObserver: selected,
  }));
  app.get('/synthetic', async context => {
    if (${mode === 'desktop-log-write'}) {
      const operationalIdentity = { appVersion: '0.0.0', buildRevision: 'development',
        runtimeInstanceId: '11111111-1111-4111-8111-111111111111' };
      const logsRoot = join(process.env.TMPDIR, ${JSON.stringify(F_ORIGINAL_MARKER)});
      writeFileSync(logsRoot, 'synthetic log root obstruction');
      const failureSink = new IncidentIndexDesktopLogFailureSink({ logsRoot, operationalIdentity });
      const logger = new JsonLineDesktopOperationalLogger({ logsRoot, failureSink,
        ...(selected === undefined ? {} : { failureObserver: selected }) });
      logger.write(createDesktopOperationalEvent({ eventName: 'desktop.started' }, operationalIdentity));
      return context.json({ failureObserved: failureSink.failureObserved });
    }
    if (${mode === 'diagnostic-read'}) {
      const result = await listDiagnosticEvents({ actorContext: {
        actorId: 'synthetic-actor', authenticationMode: 'local', companyId: 'synthetic-company',
        permissions: ['viewDiagnostics'],
      } }, { async listRecentDiagnosticEvents() { throw original; } }, selected);
      return context.json(result);
    }
    if (${mode === 'success'}) return context.json({ ok: true });
    throw original;
  });
  const response = await app.request('/synthetic');
  if (${mode === 'desktop-log-write'}) {
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ failureObserved: true });
    expect(order).toEqual(${JSON.stringify(observe ? ['original'] : [])});
    expect(write).not.toHaveBeenCalled();
    expect(body.failureObserved, 'H5_EXPECTED_NO_LOG_FAILURE').toBe(false);
    return;
  }
  if (${mode === 'diagnostic-read'}) {
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ diagnosticEvents: [], readState: { status: 'unavailable', reasons: ['sourceUnavailable'] } });
    expect(order).toEqual(${JSON.stringify(observe ? ['original'] : [])});
    expect(write).not.toHaveBeenCalled();
    expect(body.readState.status, 'H4_EXPECTED_COMPLETE_READ').toBe('complete');
    return;
  }
  if (${mode === 'success'}) {
    expect(response.status).toBe(200);
    expect(write).not.toHaveBeenCalled();
    return;
  }
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: 'Internal server error.' });
  expect(order).toEqual(${JSON.stringify(observe ? ['original', 'public'] : ['public'])});
  expect(write).toHaveBeenCalledTimes(1);
  expect(write.mock.calls[0][0].errorCode).toBe('HTTP_HANDLER_FAILED');
  if (${mode === 'expected-rejection'}) return;
  // The failing assertion contains no original value; only the production catch observed it.
  expect(response.ok, 'F_HTTP_EXPECTED_SUCCESS').toBe(true);
});
`, { flag: 'wx', mode: 0o600 });
  const env = { ...process.env, GITHUB_ACTIONS: 'false', ...binding,
    TEMP: temp, TMP: temp, TMPDIR: temp, CI: '1', NO_COLOR: '1' };
  delete env.NODE_TEST_CONTEXT;
  delete env.FORCE_COLOR;
  const child = spawnSync(process.execPath, [join(ROOT, 'node_modules/vitest/vitest.mjs'),
    'run', '--config', config, '--reporter=default',
    '--reporter=' + fileURLToPath(new URL('../vitestFailureReporter.mjs', import.meta.url))], {
    cwd: directory, env, encoding: 'utf8', timeout: 30_000,
    maxBuffer: 512 * 1024, windowsHide: true,
  });
  await writeFile(join(directory, 'worker-output.private.json'), JSON.stringify({
    status: child.status, signal: child.signal, stdout: child.stdout, stderr: child.stderr,
    processError: child.error?.code ?? null,
  }), { flag: 'wx', mode: 0o600 });
  assert.equal(child.error === undefined && child.signal === null, true, 'F_WORKER_DID_NOT_COMPLETE');
  const publicOutput = (child.stdout ?? '') + (child.stderr ?? '');
  for (const marker of [F_ORIGINAL_MARKER, F_CAUSE_MARKER]) {
    assert.equal(publicOutput.includes(marker), false, 'F_ORIGINAL_LEAKED_TO_PUBLIC_OUTPUT');
  }
  const records = [];
  for (const directory of await readdir(temp)) {
    if (!directory.startsWith('eky-test-errors-')) continue;
    for (const filename of await readdir(join(temp, directory))) {
      const bytes = await readFile(join(temp, directory, filename));
      const record = validateRunnerFailureEvidence(JSON.parse(bytes));
      assert.equal(directory === 'eky-test-errors-' + record.invocationId, true, 'F_INVOCATION_MISMATCH');
      records.push({ bytes, record, source: `temporary/${directory}/${filename}` });
    }
  }
  return { child, publicOutput, env, temp, file, records, mode };
}

export function assertFOriginalProof(worker, records = worker.records, { nonError = false } = {}) {
  assert.equal(worker.child.status, 1, 'F_UNEXPECTED_FAILURE_MUST_STAY_RED');
  const originals = records.filter(({ record }) => record.kind === 'runnerFailure' && record.phase === 'httpHandlerCatch');
  assert.equal(originals.length, 1, 'F_ORIGINAL_CAPTURE_MISSING');
  const original = originals[0].record;
  assert.equal(original.exception.chain[0].message?.includes(F_ORIGINAL_MARKER), true, 'F_ORIGINAL_MESSAGE_MISSING');
  if (!nonError) {
    if (worker.mode === 'desktop-log-write') {
      assert.equal(original.exception.chain[0].stack?.includes('JsonLineDesktopOperationalLogger.write'), true, 'H5_ORIGINAL_STACK_MISSING');
      assert.equal(original.exception.chain.length, 1, 'H5_ORIGINAL_CAUSE_WAS_INVENTED');
    } else {
      assert.equal(original.exception.chain[0].stack?.includes('createOriginalFailure'), true, 'F_ORIGINAL_STACK_MISSING');
      assert.equal(original.exception.chain[1].message?.includes(F_CAUSE_MARKER), true, 'F_ORIGINAL_CAUSE_MISSING');
    }
  }
  assert.equal(isDeepStrictEqual(original.binding, runnerFailureBinding(worker.env)), true, 'F_BINDING_MISMATCH');
  assert.equal(original.test.name === TEST_NAME && resolve(original.test.file) === resolve(worker.file), true, 'F_TEST_BINDING_MISMATCH');
  assert.equal(Number.isInteger(original.test.line) && original.test.line > 0, true, 'F_TEST_LOCATION_MISSING');
  assert.equal(original.test.attempt, 0);
  assert.equal(original.test.retryCount, 0);
  assert.equal(original.test.repeatCount, 0);
  const assertion = records.find(({ record }) => record.kind === 'runnerFailure' && record.phase === 'testFailure');
  assert.equal(assertion?.record.test.id === original.test.id, true, 'F_ASSERTION_BINDING_MISMATCH');
  assert.equal(JSON.stringify(assertion.record.exception).includes(F_ORIGINAL_MARKER), false, 'F_ORIGINAL_WAS_RETHROWN');
  const summary = records.find(({ record }) => record.kind === 'runnerFailureSummary' && record.invocationId === original.invocationId);
  assert.equal(summary?.record.status, 'recorded', 'F_DELIVERY_INCOMPLETE');
  assert.equal(summary.record.recorded, 1);
}
