import { createConnection } from 'node:net';
import { pathToFileURL } from 'node:url';
import { actorArguments, createDeadline, failureExit } from './pidNamespaceContract.mjs';
import { runNamespaceInit } from './pidNamespaceInit.mjs';
import { validateManagedInitStatus } from './managedNamespaceIdentity.mjs';
import { inspectManagedRoot, inspectManagedSocket, managedControlPath, parseManagedInitArguments } from './managedNamespaceRoot.mjs';

export function runManagedNamespaceInit({
  runtime = process, connect = createConnection, fs, tempDirectory, readStatus,
  now, time, spawnChild, nonce,
} = {}) {
  try {
    const config = parseManagedInitArguments(runtime.argv.slice(2));
    runNamespaceInit({
      runtime, argv: actorArguments(config), validateStatus: validateManagedInitStatus,
      readStatus, now, time, spawnChild, nonce,
      openChannels() {
        // runNamespaceInit has checked CI, PID 1 and every credential before
        // this first filesystem/connection edge. A FIN must not auto-close output.
        const root = inspectManagedRoot(config.root, config, { fs, tempDirectory });
        inspectManagedSocket(config.root, config, { fs });
        inspectManagedRoot(config.root, config, { fs, tempDirectory, previous: root });
        createDeadline(config.started, now).check('ready');
        const channel = connect({ path: managedControlPath(config.root), allowHalfOpen: true });
        return { input: channel, output: channel, waitForConnect: true };
      },
    });
  } catch { runtime.exit(failureExit); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runManagedNamespaceInit();
