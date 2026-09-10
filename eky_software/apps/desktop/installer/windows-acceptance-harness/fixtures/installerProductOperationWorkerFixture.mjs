import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { resolve } from 'node:path';
import { executeProductOperation, sendProductOperationResult, validateProductOperationRequest }
  from '../installerProductOperationWorker.mjs';

const request = validateProductOperationRequest(JSON.parse(Buffer.from(process.argv[2], 'base64').toString('utf8')));
const stage = process.argv[3];
const marker = resolve(request.scenarioRoot, `product-boundary-${request.nonce}.json`);
function block(phase) {
  writeFileSync(marker, JSON.stringify({ phase }));
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
}
const ports = {
  execute: async () => {},
  readResult: async () => Buffer.from('{}').toString('base64'),
};
if (stage === 'Preparation') ports.prepareRoot = () => block('preparation');
if (stage === 'Command') ports.execute = () => new Promise((done, reject) => {
  const child = spawn(process.execPath, ['-e', 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0)'], { stdio: 'ignore' });
  child.once('spawn', () => writeFileSync(marker, JSON.stringify({ phase: 'command', descendantStarted: true })));
  child.once('error', reject);
  child.once('close', done);
});
if (stage === 'Read') ports.readResult = () => block('resultRead');
if (stage === 'Remove') ports.removeResult = () => block('resultCleanup');
if (stage === 'CleanupFailure') {
  ports.execute = () => { throw new Error('synthetic command failure'); };
  ports.removeResult = () => { throw new Error('synthetic cleanup failure'); };
}
const result = await executeProductOperation(request, ports);
if (stage === 'MissingResult') {
  writeFileSync(marker, JSON.stringify({ phase: 'missingResult' }));
  process.exit(0);
}
if (stage === 'OpenResultChannel') {
  // The server is read-only; keep the write half open after its read half ends.
  const socket = connect({ path: `\\\\.\\pipe\\eky-product-worker-${request.nonce}`, allowHalfOpen: true });
  socket.once('connect', () => socket.write(JSON.stringify(result), () => block('openResultChannel')));
  socket.once('error', () => process.exit(1));
} else {
  await sendProductOperationResult(request, result);
  if (stage === 'ResultBeforeExit') block('resultBeforeExit');
  process.exitCode = result.status === 'completed' ? 0 : 1;
}
