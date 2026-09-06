import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { appendFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { readLegacyUpgradeWorkerRequest } from '../legacyUpgradeContracts.mjs';
import { runLegacyUpgradeWorker } from '../runLegacyUpgradeWorker.mjs';

const requestPath = resolve(process.argv[2]);
const request = await readLegacyUpgradeWorkerRequest(requestPath);
const progressPath = resolve(dirname(request.fixtureRoot), 'legacy-worker-progress.jsonl');
const progressLine = (phase) => JSON.stringify({ schemaVersion: 1, runNonce: request.runNonce, phase }) + '\n';
await writeFile(progressPath, progressLine('requestRead'), { flag: 'wx' });
const child = spawn(
  process.execPath,
  ['-e', "require('node:net').createServer().listen(0, '127.0.0.1', () => process.send('ready'));"],
  // Avoid libuv's kill-on-parent-exit Job; the inherited supervisor Job still owns this child.
  { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true, detached: true },
);
const ready = once(child, 'message');
await appendFile(progressPath, progressLine('childSpawned'));
const [message] = await ready;
if (message !== 'ready' || !Number.isInteger(child.pid)) {
  throw new Error('fixtureChildNotReady');
}
await appendFile(progressPath, progressLine('childReady'));
await writeFile(
  resolve(dirname(request.fixtureRoot), 'grandchild.ready.json'),
  JSON.stringify({
    schemaVersion: 1,
    runNonce: request.runNonce,
    role: 'grandchild',
    processId: child.pid,
  }),
  { flag: 'wx' },
);

// The empty artifact fails the real worker while its inherited Job still owns a live child.
const workerExitCode = await runLegacyUpgradeWorker(['--request', requestPath]);
await appendFile(progressPath, progressLine('workerReturned'));
process.kill(child.pid, 0);
if (child.exitCode !== null || child.signalCode !== null) throw new Error('fixtureChildExitedEarly');
await appendFile(progressPath, progressLine('childAliveBeforeExit'));
process.exit(workerExitCode);
