import * as filesystem from 'node:fs';
import { pathToFileURL } from 'node:url';
import { posix } from 'node:path';
import { readLinuxChromiumConfig } from '../../experiments/processOwnership/linuxServiceConfiguration.mjs';
import { guardLinuxService, linuxChromiumPaths, requireService }
  from '../../experiments/processOwnership/linuxServiceContract.mjs';
import { chromiumWorkerProtocol, requireChromiumReady } from './chromiumWorkerContract.mjs';

// Only the owned namespace launches this fixed public-API entrypoint. Its
// private configuration carries no manager/control capability or argument list.
export async function runLinuxOwnedChromiumServer(configPath, {
  fs = filesystem, runtime = process, now = () => process.hrtime.bigint(),
  loadChromium = async () => (await import('@playwright/test')).chromium,
} = {}) {
  try {
    const identity = guardLinuxService(runtime);
    requireService(runtime.env.NODE_ENV === 'test');
    const config = readLinuxChromiumConfig(configPath, { fs, identity });
    const paths = linuxChromiumPaths({ runRoot: config.runRoot, browserGeneration: config.generation });
    const cache = posix.dirname(posix.dirname(posix.dirname(config.browserExecutable)));
    requireService(runtime.env.PLAYWRIGHT_BROWSERS_PATH === cache &&
      runtime.env.HOME === paths.temp && runtime.env.TMPDIR === paths.temp);
    const absent = path => {
      try { fs.lstatSync(path); } catch (error) { if (error?.code === 'ENOENT') return; throw error; }
      throw new Error('E2E_CHROMIUM_SERVER_CONFIG');
    };
    absent(paths.ready); absent(paths.ready + '.pending');
    let previous = now();
    const check = () => {
      const current = now();
      requireService(typeof current === 'bigint' && current >= previous && current > 0n &&
        current < BigInt(config.startUntil), 'startupDeadlineExceeded');
      previous = current;
    };
    check();
    const chromium = await loadChromium();
    check();
    requireService(fs.realpathSync(chromium.executablePath()) === config.browserExecutable);
    const server = await chromium.launchServer({ host: '127.0.0.1', port: 0, headless: true,
      handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false });
    server.on('close', () => { runtime.exitCode = 1; });
    check();
    const ready = { protocol: chromiumWorkerProtocol, schemaVersion: 1,
      generation: config.generation, endpoint: server.wsEndpoint() };
    requireChromiumReady(ready, config.generation);
    requireService(JSON.stringify(readLinuxChromiumConfig(configPath, { fs, identity })) === JSON.stringify(config));
    absent(paths.ready); absent(paths.ready + '.pending');
    check();
    fs.writeFileSync(paths.ready + '.pending', JSON.stringify(ready), { flag: 'wx', mode: 0o600 });
    check();
    fs.renameSync(paths.ready + '.pending', paths.ready);
  } catch {
    // Public launch errors may contain host paths or the secret endpoint.
    throw new Error('E2E_CHROMIUM_SERVER_FAILED');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error('E2E_CHROMIUM_SERVER_CONFIG');
    await runLinuxOwnedChromiumServer(process.argv[2]);
  } catch {
    process.stderr.write('E2E_CHROMIUM_SERVER_FAILED\n');
    process.exitCode = 1;
  }
}
