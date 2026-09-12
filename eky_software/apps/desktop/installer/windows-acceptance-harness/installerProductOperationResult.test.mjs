import assert from 'node:assert/strict';
import { link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readOwnedProductOperationResult, validateProductOperationReply } from './installerProductOperationResult.mjs';
import { runOwnedProductOperation } from './installerProductOperationWorker.mjs';
import { acceptanceProductPair, acceptanceProductCleanup, validateAcceptanceProductFacts } from './acceptanceProductFacts.mjs';

const nonce = 'a'.repeat(64);
const binding = { schemaVersion: 1, runNonce: nonce, scenario: 'installerProductOperation', artifactDescriptorSha256: nonce };
const state = { schemaVersion: 1, productState: -1, productName: null, productVersion: null,
  localPackagePresent: false, ownedRegistryExists: false, ekyProcessCount: 0 };
const encoded = (value) => Buffer.from(JSON.stringify(value)).toString('base64');
function supervisor(overrides = {}) {
  return { ...binding, status: 'completed', processResultCode: 'processCompleted', workerResultCode: 'workerResultValidated',
    childExitCode: 0, processWin32ErrorCode: null, cleanupWin32ErrorCode: null,
    cleanupResultCode: 'notRequired', processTreeAbsent: true, durationMs: 1, ...overrides };
}
const deadline = (processTreeAbsent = true) => supervisor({ status: 'failed', processResultCode: 'deadlineExceeded',
  workerResultCode: 'notChecked', childExitCode: null, processTreeAbsent,
  cleanupResultCode: processTreeAbsent ? 'processTreeAbsent' : 'cleanupUnverified' });

test('fixed command product facts retain bound inspection and uninstall semantics', () => {
  const history = ['inspectSourceCleanup', 'inspectTargetCleanup', 'uninstallTarget'].map((phase) => ({ phase, runNonce: nonce }));
  const inspect = { schemaVersion: 1, nonce, operation: 'inspect', status: 'completed', state: encoded(state),
    errorCode: null, resultCleanup: 'completed' };
  const facts = { inspectSourceCleanup: inspect, inspectTargetCleanup: { ...inspect,
    state: encoded({ ...state, productState: 5 }) }, uninstallTarget: { ...inspect, operation: 'uninstall', state: null } };
  assert.doesNotThrow(() => validateAcceptanceProductFacts(facts, history));
  assert.equal(acceptanceProductPair(facts, 'Cleanup').resultCode, 'targetProductPresent');
  assert.equal(acceptanceProductCleanup(facts).resultCode, 'semanticCleanupCompleted');
  for (const [key, changes] of [['inspectTargetCleanup', { nonce: 'b'.repeat(64) }],
    ['inspectTargetCleanup', { state: encoded({ ...state, unexpected: true }) }],
    ['inspectTargetCleanup', { state: 42 }], ['uninstallTarget', { state: encoded(state) }]]) {
    assert.throws(() => validateAcceptanceProductFacts({ ...facts, [key]: { ...facts[key], ...changes } }, history));
  }
  assert.throws(() => validateAcceptanceProductFacts(facts, history.slice(0, 2)));
  const failed = { ...facts, uninstallTarget: { ...facts.uninstallTarget, status: 'failed', errorCode: 'commandFailed' } };
  assert.doesNotThrow(() => validateAcceptanceProductFacts(failed, history));
  assert.equal(acceptanceProductCleanup(failed).errorCode, 'semanticCleanupFailed');
});

async function context(t) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'eky-product-result-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const request = { schemaVersion: 1, nonce, operation: 'inspect',
    productCode: '{00000000-0000-0000-0000-000000000001}', scenarioRoot: root,
    nodeExecutable: process.execPath, workerPath: join(root, 'installerProductOperationWorker.mjs'),
    timeoutMilliseconds: 35_000, cleanupReserveMilliseconds: 5_000, deliveryReserveMilliseconds: 1_000 };
  return { root, request, binding, supervisorResult: supervisor(), supervisorExitCode: 0 };
}

test('owned product producer and both result transports use the same operation and cleanup contract', async (t) => {
  for (const operation of ['inspect', 'uninstall']) {
    for (const fault of [false, true]) {
      const input = await context(t);
      input.request.operation = operation;
      const exitCode = await runOwnedProductOperation({ request: input.request, binding }, {
        operationDependencies: { systemRoot: input.root, execute: async () => {
          if (fault) throw new Error('private operation failure');
        }, readResult: async () => encoded(state), removeDirectory: async (root) => {
          if (fault) throw new Error('private cleanup failure');
          await rm(root, { recursive: true });
        } },
      });
      input.supervisorExitCode = exitCode;
      if (fault) input.supervisorResult = supervisor({ status: 'failed', processResultCode: 'processExitFailed',
        workerResultCode: 'notChecked', childExitCode: 1, cleanupResultCode: 'processTreeAbsent' });
      const detailed = JSON.parse(await readFile(join(input.root, 'product-result.json'), 'utf8'));
      const pipe = validateProductOperationReply(Buffer.from(JSON.stringify({ schemaVersion: 1, nonce, operation,
        supervisor: input.supervisorResult, worker: encoded(detailed.result) })), input.request, exitCode);
      const file = await readOwnedProductOperationResult(input);
      assert.deepEqual(file, pipe);
      assert.equal(file.status, fault ? 'failed' : 'completed');
      if (fault) {
        assert.equal(file.worker.errorCode, 'commandFailed');
        assert.equal(file.worker.resultCleanup, 'failed');
      } else if (operation === 'inspect') assert.deepEqual(file.state, state);
      assert.ok(!JSON.stringify(file).includes('private'));
    }
  }
});

test('owned result cannot replace observed exit or unverified process cleanup', async (t) => {
  const input = await context(t);
  const result = { schemaVersion: 1, nonce, operation: 'inspect', status: 'completed',
    state: encoded(state), errorCode: null, resultCleanup: 'completed' };
  await writeFile(join(input.root, 'product-result.json'), JSON.stringify({ binding, result }));
  await assert.rejects(readOwnedProductOperationResult({ ...input, supervisorExitCode: null }),
    { message: 'WINDOWS_ACCEPTANCE_SUPERVISOR_RESULT_OUTCOME_INVALID' });
  await assert.rejects(readOwnedProductOperationResult({ ...input, supervisorResult: null }),
    { message: 'WINDOWS_ACCEPTANCE_SUPERVISOR_RESULT_SCHEMA_INVALID' });
  const uncertain = await readOwnedProductOperationResult({ ...input,
    supervisorResult: deadline(false), supervisorExitCode: 1 });
  assert.equal(uncertain.resultCode, 'timedOut');
  assert.equal(uncertain.directProcessAbsent, false);
  assert.equal(uncertain.worker, null);
  const completedLate = await readOwnedProductOperationResult({ ...input,
    supervisorResult: deadline(), supervisorExitCode: 1 });
  assert.equal(completedLate.status, 'failed');
  assert.equal(completedLate.resultCode, 'timedOut');
  assert.equal(completedLate.directProcessAbsent, true);
  assert.equal(completedLate.worker.status, 'completed');
});

test('owned result rejects stale, partial and conflicting evidence without masking a deadline', async (t) => {
  const input = await context(t);
  const result = { schemaVersion: 1, nonce, operation: 'inspect', status: 'completed',
    state: encoded(state), errorCode: null, resultCleanup: 'completed' };
  const path = join(input.root, 'product-result.json');
  const cases = [null, '{', JSON.stringify({ binding, result, extra: true }),
    JSON.stringify({ binding: { ...binding, runNonce: 'b'.repeat(64) }, result }),
    JSON.stringify({ binding: { ...binding, artifactDescriptorSha256: 'b'.repeat(64) }, result }),
    JSON.stringify({ binding, result: { ...result, operation: 'uninstall' } }),
    JSON.stringify({ binding, result: { ...result, extra: true } }),
    JSON.stringify({ binding, result: { ...result, status: 'failed', errorCode: null } }),
    JSON.stringify({ binding, result: { ...result, state: encoded({ ...state, extra: true }) } })];
  for (const bytes of cases) {
    if (bytes !== null) await writeFile(path, bytes);
    const output = await readOwnedProductOperationResult(input);
    assert.equal(output.status, 'failed');
    assert.equal(output.resultCode, 'workerResultInvalid');
    assert.equal(output.directProcessAbsent, true);
    const failed = await readOwnedProductOperationResult({ ...input, supervisorResult: deadline(), supervisorExitCode: 1 });
    assert.equal(failed.status, 'failed');
    assert.equal(failed.resultCode, 'timedOut');
  }
});

test('owned result rejects hardlinks and a linked root without modifying their targets', async (t) => {
  const input = await context(t);
  const targetRoot = join(input.root, 'target');
  await mkdir(targetRoot);
  const bytes = JSON.stringify({ binding, result: { schemaVersion: 1, nonce, operation: 'inspect',
    status: 'completed', state: encoded(state), errorCode: null, resultCleanup: 'completed' } });
  const target = join(targetRoot, 'product-result.json');
  await writeFile(target, bytes);
  await link(target, join(input.root, 'product-result.json'));
  assert.equal((await readOwnedProductOperationResult(input)).resultCode, 'workerResultInvalid');
  await rm(join(input.root, 'product-result.json'));
  const linkedRoot = join(input.root, 'linked');
  await symlink(targetRoot, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
  const linked = await readOwnedProductOperationResult({ ...input, request: { ...input.request, scenarioRoot: linkedRoot } });
  assert.equal(linked.resultCode, 'workerResultInvalid');
  assert.equal(await readFile(target, 'utf8'), bytes);
});
