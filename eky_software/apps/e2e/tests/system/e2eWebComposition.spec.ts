import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { createE2eRunRoot } from '../../src/environment/createE2eRunRoot.js';
import { createE2eWorkerPaths } from '../../src/environment/createE2eWorkerPaths.js';
import { createE2eFixtureLifetime } from '../../src/environment/e2eFixtureLifetime.js';
import { removeE2eRunRoot } from '../../src/environment/removeE2eRunRoot.js';
import { reserveLoopbackPort } from '../../src/environment/reserveLoopbackPort.js';
import { E2eBackendStartupFailure, startE2eBackendProcess } from '../../src/environment/startE2eBackendProcess.js';
import { E2eWebStartupFailure, startE2eWebProcess } from '../../src/environment/startE2eWebProcess.js';
import { waitForLoopbackPortRelease } from '../../src/environment/waitForLoopbackPortRelease.js';
import { windowsServiceProfiles } from '../../src/environment/windowsServiceProfile.js';
import { finishServiceFixture } from '../../src/fixtures/finishServiceFixture.js';

test('WEB-SERVICE-001 @critical boots the actual Vite proxy and closes its owned workload', async ({}, testInfo) => {
  const lifetime = createE2eFixtureLifetime(testInfo.timeout);
  const runRoot = createE2eRunRoot();
  let backendPort: number | undefined;
  let webPort: number | undefined;
  let backend: Awaited<ReturnType<typeof startE2eBackendProcess>> | undefined;
  let web: Awaited<ReturnType<typeof startE2eWebProcess>> | undefined;
  let failure: { error: unknown } | undefined;
  let startupCleanupUnverified = false;

  try {
    const paths = createE2eWorkerPaths(runRoot, 'WEB-SERVICE-001');
    backendPort = await reserveLoopbackPort();
    startupCleanupUnverified = true;
    backend = await startE2eBackendProcess({ backendPort, lifetime, paths, runRoot, scenarioId: 'WEB-SERVICE-001' });
    startupCleanupUnverified = false;
    webPort = await reserveLoopbackPort();
    startupCleanupUnverified = true;
    web = await startE2eWebProcess({ backend, lifetime, paths, runRoot, webPort });
    startupCleanupUnverified = false;
    expect(await web.workload.readState()).toBe('running');
    const page = await fetch(web.webOrigin);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html.includes('/src/main.tsx')).toBe(true);
    expect(html.includes(backend.sessionSecret)).toBe(false);
    const module = await fetch(`${web.webOrigin}/src/main.tsx`);
    expect(module.status).toBe(200);
    expect((await module.text()).includes(backend.sessionSecret)).toBe(false);

    // The browser sends no session header: only the isolated Node proxy adds it.
    const direct = await fetch(`${backend.backendOrigin}/customers`);
    expect(direct.status).toBe(401);
    const proxied = await fetch(`${web.webOrigin}/customers`);
    expect(proxied.status).toBe(200);
    const data: unknown = await proxied.json().catch(() => { throw new Error('E2E_WEB_PROXY_RESPONSE_INVALID'); });
    const emptyCustomers = data !== null && typeof data === 'object' && !Array.isArray(data) &&
      Object.keys(data).length === 1 && 'customers' in data && Array.isArray(data.customers) && data.customers.length === 0;
    expect(emptyCustomers).toBe(true);
    expect(existsSync(join(paths.tempRoot, 'vite-cache'))).toBe(true);
    expect(web.managedProcess.readStdout().includes(backend.sessionSecret)).toBe(false);
    expect(web.managedProcess.readStderr().includes(backend.sessionSecret)).toBe(false);

    if (process.platform === 'win32') {
      const owners = readdirSync(runRoot).filter(name => /^vite-owner-[a-f0-9]{64}$/.test(name));
      expect(owners.length).toBe(1);
      const controlRoot = join(runRoot, owners[0]!);
      const configText = readFileSync(join(controlRoot, windowsServiceProfiles.vite.configName), 'utf8');
      expect(configText.includes(backend.sessionSecret)).toBe(false);
      const config = JSON.parse(configText) as { environment: Record<string, string> };
      expect(config.environment.TEMP === join(controlRoot, 'temp')).toBe(true);
      expect(config.environment.TMP === join(controlRoot, 'temp')).toBe(true);
      expect(config.environment.EKY_E2E_ENV_ROOT === paths.tempRoot).toBe(true);
      for (const key of ['PATH', 'HOME', 'NODE_OPTIONS', 'EKY_E2E_RUNTIME_SESSION']) {
        expect(Object.hasOwn(config.environment, key)).toBe(false);
      }
      const stop = web.stop();
      expect(web.stop()).toBe(stop);
      await stop;
      const terminalText = readFileSync(join(controlRoot, windowsServiceProfiles.vite.terminalName), 'utf8');
      expect(terminalText.includes(backend.sessionSecret)).toBe(false);
      // Do not publish raw config, process identity or private paths on assertion failure.
      const terminal = JSON.parse(terminalText) as { protocol: string; generation: string; state: Record<string, unknown> };
      expect(terminal.protocol === windowsServiceProfiles.vite.protocol).toBe(true);
      expect(owners[0] === `vite-owner-${terminal.generation}`).toBe(true);
      expect(terminal.state.cleanup).toBe('processTreeAbsent');
      expect(terminal.state.activeProcesses).toBe(0);
      expect(terminal.state.assignedBeforeResume).toBe(true);
      expect(terminal.state.stdioSettled).toBe(true);
      expect(terminal.state.firstFailure).toBeNull();
    }
  } catch (error) {
    failure = { error };
    if (error instanceof E2eBackendStartupFailure || error instanceof E2eWebStartupFailure) {
      startupCleanupUnverified = error.evidence.cleanup.processTree !== 'stopped' ||
        error.evidence.cleanup.port !== 'released';
      try {
        await testInfo.attach('service-startup-failure', {
          body: JSON.stringify({ schemaVersion: 1, ...error.evidence }), contentType: 'application/json',
        });
      } catch { /* Keep the original startup failure. */ }
    }
  } finally {
    await finishServiceFixture({
      failure, priorCleanupUnverified: startupCleanupUnverified,
      testAlreadyFailed: testInfo.status !== testInfo.expectedStatus,
      disposeApi: async () => {},
      ...(web === undefined ? {} : { stopWeb: async () => {
        await web!.stop();
        expect(await web!.workload.readState()).toBe('exited');
      } }),
      ...(backend === undefined ? {} : { stopBackend: () => backend!.stop() }),
      ...(webPort === undefined ? {} : { releaseWebPort: () => waitForLoopbackPortRelease(webPort!) }),
      ...(backendPort === undefined ? {} : { releaseBackendPort: () => waitForLoopbackPortRelease(backendPort!) }),
      collectArtifacts: async () => {},
      removeRoot: () => removeE2eRunRoot(runRoot),
      report: async cleanup => {
        await testInfo.attach('web-composition-cleanup', {
          body: JSON.stringify({ schemaVersion: 1, cleanup }), contentType: 'application/json',
        });
      },
    });
  }
  expect(existsSync(runRoot)).toBe(false);
});

test('WEB-SERVICE-002 @critical @fault rejects an occupied port and preserves the unrelated listener', async ({}, testInfo) => {
  const lifetime = createE2eFixtureLifetime(testInfo.timeout);
  const runRoot = createE2eRunRoot();
  let backendPort: number | undefined;
  let webPort: number | undefined;
  let backend: Awaited<ReturnType<typeof startE2eBackendProcess>> | undefined;
  let unexpectedWeb: Awaited<ReturnType<typeof startE2eWebProcess>> | undefined;
  let blocker: Server | undefined;
  let failure: { error: unknown } | undefined;
  let startupCleanupUnverified = false;
  try {
    const paths = createE2eWorkerPaths(runRoot, 'WEB-SERVICE-002');
    backendPort = await reserveLoopbackPort();
    startupCleanupUnverified = true;
    backend = await startE2eBackendProcess({ backendPort, lifetime, paths, runRoot, scenarioId: 'WEB-SERVICE-002' });
    startupCleanupUnverified = false;
    webPort = await reserveLoopbackPort();
    blocker = createServer((_request, response) => { response.writeHead(404); response.end(); });
    await new Promise<void>((resolve, reject) => {
      blocker!.once('error', reject);
      blocker!.listen(webPort, '127.0.0.1', resolve);
    });
    let rejected: unknown;
    startupCleanupUnverified = true;
    try {
      unexpectedWeb = await startE2eWebProcess({ backend, lifetime, paths, runRoot, webPort });
      startupCleanupUnverified = false;
    } catch (error) {
      rejected = error;
      // This test owns the blocking server; its separate stop and port check
      // remain mandatory below. Only Vite's tree can be proven absent here.
      startupCleanupUnverified = !(error instanceof E2eWebStartupFailure &&
        error.evidence.cleanup.processTree === 'stopped');
    }
    expect(rejected instanceof E2eWebStartupFailure).toBe(true);
    if (!(rejected instanceof E2eWebStartupFailure)) throw new Error('E2E_WEB_EXPECTED_STARTUP_REJECTION');
    expect(rejected.evidence).toEqual({
      errorCode: 'E2E_WEB_CHILD_EXITED_BEFORE_HEALTH', spawnObserved: true, exitedBeforeCleanup: true,
      cleanup: { processTree: 'stopped', port: 'unverified' },
    });
    expect(blocker.listening).toBe(true);
    expect((await fetch(`http://127.0.0.1:${String(webPort)}`)).status).toBe(404);
    expect(await backend.workload.readState()).toBe('running');
    await testInfo.attach('expected-web-startup-failure', {
      body: JSON.stringify({ schemaVersion: 1, ...rejected.evidence }), contentType: 'application/json',
    });
  } catch (error) {
    failure = { error };
    if (error instanceof E2eBackendStartupFailure) {
      startupCleanupUnverified = error.evidence.cleanup.processTree !== 'stopped' || error.evidence.cleanup.port !== 'released';
    }
  } finally {
    await finishServiceFixture({
      failure, priorCleanupUnverified: startupCleanupUnverified,
      testAlreadyFailed: testInfo.status !== testInfo.expectedStatus,
      disposeApi: async () => {
        if (blocker?.listening) {
          await new Promise<void>((resolve, reject) => {
            blocker!.close(error => error === undefined ? resolve() : reject(error));
          });
        }
      },
      ...(unexpectedWeb === undefined ? {} : { stopWeb: () => unexpectedWeb!.stop() }),
      ...(backend === undefined ? {} : { stopBackend: () => backend!.stop() }),
      ...(webPort === undefined ? {} : { releaseWebPort: () => waitForLoopbackPortRelease(webPort!) }),
      ...(backendPort === undefined ? {} : { releaseBackendPort: () => waitForLoopbackPortRelease(backendPort!) }),
      collectArtifacts: async () => {}, removeRoot: () => removeE2eRunRoot(runRoot),
      report: async cleanup => {
        await testInfo.attach('web-fault-composition-cleanup', {
          body: JSON.stringify({ schemaVersion: 1, cleanup }), contentType: 'application/json',
        });
      },
    });
  }
  expect(existsSync(runRoot)).toBe(false);
});
