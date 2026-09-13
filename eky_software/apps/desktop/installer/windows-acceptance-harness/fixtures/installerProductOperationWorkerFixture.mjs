import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { executeProductOperation, runOwnedProductOperation, validateProductOperationRequest }
  from '../installerProductOperationWorker.mjs';
import { writeJsonAtomicExclusive } from '../cleanInstallUninstallContracts.mjs';

// Exercise the existing .NET command's owned worker-result contract.
if (process.argv.length !== 4 || process.argv[2] !== '--owned-command') process.exit(64);
const ownedCommand = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const request = validateProductOperationRequest(ownedCommand.request);
const stage = ownedCommand.stage;
const marker = resolve(request.scenarioRoot, `product-boundary-${request.nonce}.json`);
function block(phase) {
  writeFileSync(marker, JSON.stringify({ phase }));
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
}
const ports = {
  execute: async () => {},
  readResult: async () => Buffer.from(JSON.stringify({ schemaVersion: 1, productState: -1,
    productName: null, productVersion: null, localPackagePresent: false,
    ownedRegistryExists: false, ekyProcessCount: 0 })).toString('base64'),
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
if (stage === 'NativeWait') ports.execute = () => {
  writeFileSync(marker, JSON.stringify({ phase: 'nativeWaitEntered' }));
  // Model a native call that cannot process a JS cancellation or unref request.
  spawnSync(process.execPath, ['-e', 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0)'],
    { stdio: 'ignore', windowsHide: true });
  throw new Error('nativeWaitReturned');
};
if (stage === 'CleanupFailure') {
  ports.execute = () => { throw new Error('synthetic command failure'); };
  ports.removeResult = () => { throw new Error('synthetic cleanup failure'); };
}
if (stage !== 'MissingResult') {
  try {
    process.exitCode = await runOwnedProductOperation({ request, binding: ownedCommand.binding }, {
      operationDependencies: ports,
      publishResult: (path, value) => {
        if (path.endsWith('worker-result.json')) {
          if (stage === 'DeliveryHold') block('resultDelivery');
          if (stage === 'DeliveryFailure') throw new Error('synthetic delivery failure');
        }
        return writeJsonAtomicExclusive(path, value);
      },
    });
    if (stage === 'ResultBeforeExit') block('resultBeforeExit');
  } catch { process.exitCode = 1; }
} else {
  await executeProductOperation(request, ports);
  writeFileSync(marker, JSON.stringify({ phase: 'missingResult' }));
}
