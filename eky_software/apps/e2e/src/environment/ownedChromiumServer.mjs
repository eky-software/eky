import { lstatSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromiumControlMaximumBytes, chromiumReadyName, chromiumWorkerProtocol,
  requireChromiumEndpoint } from './chromiumWorkerContract.mjs';

// This closed entrypoint is launched suspended/owned, never by a module test.
export async function runOwnedChromiumServer(configPath) {
  if (process.env.EKY_E2E !== '1' || process.env.NODE_ENV !== 'test' ||
      process.platform !== 'win32') throw new Error('E2E_CHROMIUM_SERVER_GUARD');
  const stat = lstatSync(configPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > chromiumControlMaximumBytes) {
    throw new Error('E2E_CHROMIUM_SERVER_CONFIG');
  }
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  if (config.protocol !== chromiumWorkerProtocol || config.schemaVersion !== 1 ||
      !/^[0-9a-f]{64}$/.test(config.generation) ||
      configPath !== join(config.controlRoot, 'chromium-service-config.json') ||
      realpathSync.native(configPath) !== configPath ||
      !Number.isSafeInteger(config.workBudgetMilliseconds) || config.workBudgetMilliseconds < 1) {
    throw new Error('E2E_CHROMIUM_SERVER_CONFIG');
  }
  const { chromium } = await import('@playwright/test');
  if (realpathSync.native(chromium.executablePath()) !== config.browserExecutable) {
    throw new Error('E2E_CHROMIUM_BROWSER_MISMATCH');
  }
  const server = await chromium.launchServer({
    host: '127.0.0.1', port: 0, headless: true,
    handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
  });
  server.on('close', () => { process.exitCode = 1; });
  const endpoint = requireChromiumEndpoint(server.wsEndpoint());
  const readyPath = join(config.controlRoot, chromiumReadyName);
  if (realpathSync.native(dirname(readyPath)) !== config.controlRoot) throw new Error('E2E_CHROMIUM_SERVER_CONFIG');
  writeFileSync(readyPath + '.pending', JSON.stringify({
    protocol: chromiumWorkerProtocol, schemaVersion: 1, generation: config.generation, endpoint,
  }), { mode: 0o600, flag: 'wx' });
  renameSync(readyPath + '.pending', readyPath);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('E2E_CHROMIUM_SERVER_CONFIG');
    await runOwnedChromiumServer(process.argv[2]);
  } catch {
    // Playwright launch errors may include the capability endpoint or host paths.
    process.stderr.write('E2E_CHROMIUM_SERVER_FAILED\n');
    process.exitCode = 1;
  }
}
