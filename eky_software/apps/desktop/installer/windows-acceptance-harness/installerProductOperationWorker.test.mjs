import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { executeProductOperation, runOwnedProductOperation, validateProductOperationRequest } from './installerProductOperationWorker.mjs';
import { writeJsonAtomicExclusive } from './cleanInstallUninstallContracts.mjs';

const request = { schemaVersion: 1, nonce: 'a'.repeat(64), operation: 'inspect',
  productCode: '{00000000-0000-0000-0000-000000000001}', scenarioRoot: resolve('synthetic'),
  nodeExecutable: process.execPath, workerPath: resolve('installerProductOperationWorker.mjs'),
  timeoutMilliseconds: 35_000, cleanupReserveMilliseconds: 5_000, deliveryReserveMilliseconds: 1_000 };

for (const failure of [null, 'prepare', 'create', 'execute', 'read', 'remove', 'removeDirectory', 'primaryAndCleanup']) {
  test(`product worker orders preparation/query/read/removal and preserves failures: ${failure}`, async () => {
    const events = [];
    const step = (name, value) => async () => {
      events.push(name);
      if (failure === name || failure === 'primaryAndCleanup' && ['execute', 'remove'].includes(name)) throw new Error('private');
      return value;
    };
    const result = await executeProductOperation(request, {
      systemRoot: resolve('synthetic'), prepareRoot: step('prepare'), createDirectory: step('create'),
      execute: step('execute'), readResult: step('read', 'e30='), removeResult: step('remove'), removeDirectory: step('removeDirectory'),
    });
    if (failure === null) {
      assert.equal(result.status, 'completed');
      assert.equal(result.state, 'e30=');
      assert.deepEqual(events, ['prepare', 'create', 'execute', 'read', 'remove', 'removeDirectory']);
    } else {
      assert.equal(result.status, 'failed');
      assert.equal(result.errorCode, ['prepare', 'create'].includes(failure) ? 'preparationFailed'
        : ['execute', 'primaryAndCleanup'].includes(failure) ? 'commandFailed'
          : failure === 'read' ? 'resultReadFailed' : 'resultCleanupFailed');
      assert.equal(result.resultCleanup, ['remove', 'removeDirectory', 'primaryAndCleanup'].includes(failure) ? 'failed' : 'completed');
      if (['prepare', 'create'].includes(failure)) assert.ok(!events.includes('remove'));
    }
    assert.ok(!JSON.stringify(result).includes('private'));
  });
}

test('product request rejects extra keys, malformed identity, path and budgets before side effects', async () => {
  for (const change of [{ extra: true }, { productCode: '/x other' }, { nonce: 'bad' }, { operation: 'repair' },
    { scenarioRoot: 'relative' }, { timeoutMilliseconds: 125_001 }, { cleanupReserveMilliseconds: 0 },
    { deliveryReserveMilliseconds: 0 }, { deliveryReserveMilliseconds: 5_000 }]) {
    assert.throws(() => validateProductOperationRequest({ ...request, ...change }), /productRequestInvalid/);
  }
});

test('uninstall uses only the exact product and its own temporary namespace', async () => {
  const events = [];
  const systemRoot = resolve('synthetic');
  const result = await executeProductOperation({ ...request, operation: 'uninstall' }, {
    systemRoot,
    prepareRoot: async (root) => { assert.equal(root, request.scenarioRoot); events.push('prepare'); },
    createDirectory: async (root) => {
      assert.equal(root, resolve(request.scenarioRoot, `product-operation-${request.nonce}`));
      events.push('create');
    },
    execute: async (command, args, cwd) => {
      assert.equal(command, resolve(systemRoot, 'System32/msiexec.exe'));
      assert.deepEqual(args, ['/x', request.productCode, '/qn', '/norestart']);
      assert.equal(cwd, request.scenarioRoot);
      events.push('uninstall');
    },
    readResult: async () => assert.fail('Uninstall has no query result'),
    removeResult: async () => assert.fail('Uninstall must not remove a query file'),
    removeDirectory: async (root) => {
      assert.equal(root, resolve(request.scenarioRoot, `product-operation-${request.nonce}`));
      events.push('removeDirectory');
    },
  });
  assert.deepEqual(events, ['prepare', 'create', 'uninstall', 'removeDirectory']);
  assert.deepEqual(result, { schemaVersion: 1, nonce: request.nonce, operation: 'uninstall',
    status: 'completed', state: null, errorCode: null, resultCleanup: 'completed' });
});

test('owned product worker rejects invalid binding and occupied output before executing', async (t) => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'eky-product-worker-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = { request: { ...request, scenarioRoot: root }, binding: { schemaVersion: 1,
    runNonce: request.nonce, scenario: 'installerProductOperation', artifactDescriptorSha256: 'b'.repeat(64) } };
  let operations = 0;
  const dependencies = { operationDependencies: { prepareRoot: async () => { operations++; } } };
  for (const changed of [{ ...input, extra: true }, { ...input, binding: { ...input.binding, extra: true } },
    { ...input, binding: { ...input.binding, runNonce: 'c'.repeat(64) } },
    { ...input, binding: { ...input.binding, scenario: 'foreign' } },
    { ...input, binding: { ...input.binding, artifactDescriptorSha256: 'invalid' } }]) {
    await assert.rejects(runOwnedProductOperation(changed, dependencies), /productRequestInvalid/);
  }
  const occupied = join(root, 'worker-result.json');
  await writeFile(occupied, 'original');
  await assert.rejects(runOwnedProductOperation(input, dependencies), /productResultPathOccupied/);
  assert.equal(operations, 0);
  assert.equal(await readFile(occupied, 'utf8'), 'original');
});

test('owned product worker preserves operation and cleanup failures when terminal publication fails', async (t) => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'eky-product-worker-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const binding = { schemaVersion: 1, runNonce: request.nonce, scenario: 'installerProductOperation',
    artifactDescriptorSha256: 'b'.repeat(64) };
  const writes = [];
  await assert.rejects(runOwnedProductOperation({ request: { ...request, scenarioRoot: root }, binding }, {
    operationDependencies: { systemRoot: root, prepareRoot: async () => {}, createDirectory: async () => {},
      execute: async () => { throw new Error('private original'); },
      removeResult: async () => { throw new Error('private cleanup'); } },
    publishResult: async (path, value) => {
      writes.push(path);
      if (path.endsWith('worker-result.json')) throw new Error('syntheticPublicationFailed');
      await writeJsonAtomicExclusive(path, value);
    },
  }), /syntheticPublicationFailed/);
  assert.deepEqual(writes, [join(root, 'product-result.json'), join(root, 'worker-result.json')]);
  const bytes = await readFile(writes[0], 'utf8');
  const result = JSON.parse(bytes);
  assert.deepEqual(result.binding, binding);
  assert.equal(result.result.errorCode, 'commandFailed');
  assert.equal(result.result.resultCleanup, 'failed');
  assert.ok(!bytes.includes('private'));
  await assert.rejects(readFile(writes[1]), { code: 'ENOENT' });
});
