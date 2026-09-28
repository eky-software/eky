import { pathToFileURL } from 'node:url';
import { failureExit } from './pidNamespaceContract.mjs';
import { readLinuxServiceConfig } from './linuxServiceConfiguration.mjs';
import { serviceDeadlines } from './linuxServiceContract.mjs';
import { runLinuxServiceInit } from './linuxServiceInit.mjs';
import { spawnLinuxServiceWorkload } from './linuxServiceWorkload.mjs';
import { openLinuxConsumerExchange } from './linuxConsumerExchange.mjs';
import { ownerLossRecords, waitConsumerLossRecord } from './linuxConsumerLossRecords.mjs';
import { ownerLossExit } from './linuxConsumerLossContract.mjs';

// Only this fixed experiment entrypoint accepts the bound owner-loss arm. All
// admission, credentials, workload and control behavior uses the real init.
export function runLinuxConsumerLossInit(root, {
  runtime = process, readConfig = readLinuxServiceConfig, runInit = runLinuxServiceInit,
  spawnWorkload = spawnLinuxServiceWorkload, openExchange = openLinuxConsumerExchange,
  waitRecord = waitConsumerLossRecord, now = () => process.hrtime.bigint(),
} = {}) {
  try {
    const config = readConfig(root);
    const exchange = openExchange({ root, identity: { uid: config.uid, gid: config.gid },
      nonce: config.generation, caseId: `${config.profile}-owner`, role: 'init', serviceRoot: true,
      records: ownerLossRecords(config.profile, config.generation) });
    const deadline = serviceDeadlines(config, now);
    runInit(root, { runtime, spawnWorkload(...args) {
      const workload = spawnWorkload(...args);
      void workload.started.then(async () => {
        await waitRecord(exchange, 'armed.json', deadline, 'work');
        deadline.check('work');
        runtime.exit(ownerLossExit);
      }).catch(() => runtime.exit(failureExit));
      return workload;
    } });
  } catch { runtime.exit(failureExit); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !args[0].startsWith('--root=')) process.exit(failureExit);
  runLinuxConsumerLossInit(args[0].slice(7));
}
