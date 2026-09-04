import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { readLegacyUpgradeWorkerRequest } from '../legacyUpgradeContracts.mjs';
import { runLegacyUpgradeWorker } from '../runLegacyUpgradeWorker.mjs';

const requestPath = resolve(process.argv[2]);
const request = await readLegacyUpgradeWorkerRequest(requestPath);
const child = spawn(
  process.execPath,
  ['-e', "require('node:net').createServer().listen(0, '127.0.0.1', () => process.send('ready'));"],
  { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true },
);
const [message] = await once(child, 'message');
if (message !== 'ready' || !Number.isInteger(child.pid)) {
  throw new Error('fixtureChildNotReady');
}
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
process.exit(await runLegacyUpgradeWorker(['--request', requestPath]));
