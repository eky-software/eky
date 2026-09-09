import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { connect } from 'node:net';
import { resolve } from 'node:path';
import test from 'node:test';
import { runInstallerProductOperation, validateProductOperationReply } from './installerProductOperationProcess.mjs';

const state = { schemaVersion: 1, productState: -1, productName: null, productVersion: null,
  localPackagePresent: false, ownedRegistryExists: false, ekyProcessCount: 0 };
const request = { nonce: 'a'.repeat(64), operation: 'inspect' };
const encode = (value) => Buffer.from(JSON.stringify(value));
function reply(input = request) {
  return { schemaVersion: 1, nonce: input.nonce, operation: input.operation,
    supervisor: { schemaVersion: 1, runNonce: input.nonce, scenario: 'installerProductOperation',
      artifactDescriptorSha256: input.nonce, status: 'completed', processResultCode: 'processCompleted',
      workerResultCode: 'workerResultValidated', cleanupResultCode: 'notRequired', processTreeAbsent: true,
      durationMs: 1, childExitCode: 0, processWin32ErrorCode: null, cleanupWin32ErrorCode: null },
    worker: encode({ schemaVersion: 1, nonce: input.nonce, operation: input.operation, status: 'completed',
      state: encode(state).toString('base64'), errorCode: null, resultCleanup: 'completed' }).toString('base64') };
}

test('product reply validates binding, closed schema and independent process/worker/cleanup results', () => {
  assert.deepEqual(validateProductOperationReply(encode(reply()), request, 0).state, state);
  for (const patch of [{ nonce: 'b'.repeat(64) }, { unknown: true }, { operation: 'uninstall' }])
    assert.throws(() => validateProductOperationReply(encode({ ...reply(), ...patch }), request, 0));
  assert.throws(() => validateProductOperationReply(encode(reply()), request, 1));
  const malformed = validateProductOperationReply(encode({ ...reply(), worker: 'e30=' }), request, 0);
  assert.equal(malformed.status, 'failed');
  assert.equal(malformed.directProcessAbsent, true);
  for (const cleanup of ['processTreeAbsent', 'cleanupUnverified']) {
    const value = reply();
    Object.assign(value.supervisor, { status: 'failed', processResultCode: 'deadlineExceeded',
      childExitCode: null, workerResultCode: 'notChecked', cleanupResultCode: cleanup,
      processTreeAbsent: cleanup === 'processTreeAbsent' });
    value.worker = 'e30=';
    const result = validateProductOperationReply(encode(value), request, 1);
    assert.equal(result.resultCode, 'timedOut');
    assert.equal(result.directProcessAbsent, cleanup === 'processTreeAbsent');
    assert.equal(result.supervisor.cleanupResultCode, cleanup);
  }
  const failedProcess = reply();
  Object.assign(failedProcess.supervisor, { status: 'failed', processResultCode: 'processExitFailed',
    childExitCode: 1, workerResultCode: 'notChecked' });
  failedProcess.worker = 'e30=';
  assert.equal(validateProductOperationReply(encode(failedProcess), request, 1).resultCode, 'processExitFailed');
});

for (const mode of ['normal', 'socketStillOpen', 'missing', 'errorBeforeClose', 'malformed', 'duplicate']) {
  test(`product caller waits for process close, not pipe EOF or a log: ${mode}`, {
    skip: process.platform !== 'win32', timeout: 5_000,
  }, async () => {
    const events = [];
    const sockets = [];
    let acknowledged = false;
    const result = await runInstallerProductOperation({ operation: 'inspect', productCode: '{00000000-0000-0000-0000-000000000001}',
      scenarioRoot: resolve('synthetic'), timeoutMilliseconds: 2_000, terminationTimeoutMilliseconds: 1_000,
      deliveryReserveMilliseconds: 200 }, {
      observe: (phase) => { events.push(phase); throw new Error('ignored diagnostic failure'); },
      spawnProcess(_, args) {
        const child = new EventEmitter();
        const input = JSON.parse(Buffer.from(args[2], 'base64').toString('utf8'));
        const finish = () => {
          child.emit('exit', 0, null);
          if (mode === 'errorBeforeClose') child.emit('error', new Error('synthetic kill error'));
          child.emit('close', 0, null);
        };
        if (mode === 'missing') { queueMicrotask(finish); return child; }
        const socket = connect(`\\\\.\\pipe\\eky-product-caller-${input.nonce}`);
        sockets.push(socket);
        socket.on('error', () => {});
        socket.once('connect', () => {
          const value = mode === 'malformed' ? {} : reply(input);
          socket.write(Buffer.concat([encode(value), Buffer.from('\n')]));
        });
        socket.once('data', (ack) => {
          acknowledged = ack.equals(Buffer.from([1]));
          if (mode === 'duplicate') {
            const duplicate = connect(`\\\\.\\pipe\\eky-product-caller-${input.nonce}`);
            sockets.push(duplicate);
            duplicate.on('error', () => {});
            duplicate.once('close', finish);
          } else {
            if (mode !== 'socketStillOpen') socket.end();
            finish();
          }
        });
        return child;
      },
    });
    assert.deepEqual(events, ['supervisorExit', 'supervisorClose']);
    if (['normal', 'socketStillOpen'].includes(mode)) {
      assert.equal(acknowledged, true);
      assert.equal(result.status, 'completed');
      assert.equal(result.directProcessAbsent, true);
    } else {
      assert.equal(result.status, 'failed');
      assert.equal(result.directProcessAbsent, false);
    }
    for (const socket of sockets) socket.destroy();
  });
}
