import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runInstallerProductOperation } from './installerProductOperationProcess.mjs';

test('exhausted cleanup still delivers the original deadline and unverified cleanup before command exit', {
  skip: process.platform !== 'win32', timeout: 10_000,
}, async () => {
  const events = [];
  const root = dirname(fileURLToPath(import.meta.url));
  const result = await runInstallerProductOperation({ operation: 'inspect',
    productCode: '{00000000-0000-0000-0000-000000000001}', scenarioRoot: root,
    timeoutMilliseconds: 400, terminationTimeoutMilliseconds: 400, deliveryReserveMilliseconds: 200,
  }, {
    observe: (phase, status) => events.push([phase, status]),
    spawnProcess(command, args, options) {
      const fixture = resolve(root, '../bin/windows-process-supervisor-contract-fixture/Release/net10.0/Eky.WindowsProcessSupervisor.ContractFixture.dll');
      return spawn(command, [fixture, '--mode', 'productOperationExhaustedCleanup', '--request', args[2]], options);
    },
  });
  // The injected outcome is not a claim of native cleanup failure. This contract
  // isolates delivery after the owner exhausts its deadline, using the real CLI.
  assert.deepEqual(events, [
    ['productChannelSetup', 'started'], ['productChannelSetup', 'completed'],
    ['productSupervisorWait', 'started'], ['productSupervisorExit', 'completed'],
    ['productSupervisorClose', 'completed'], ['productSupervisorWait', 'completed'],
    ['productChannelCleanup', 'started'], ['productChannelCleanup', 'completed'],
  ]);
  assert.equal(result.status, 'failed');
  assert.equal(result.directProcessAbsent, false);
  assert.equal(result.supervisor?.processResultCode, 'deadlineExceeded');
  assert.equal(result.supervisor?.cleanupResultCode, 'cleanupUnverified');
});
