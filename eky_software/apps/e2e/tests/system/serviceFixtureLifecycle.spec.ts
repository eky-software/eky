import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type APIRequestContext, type TestInfo } from '@playwright/test';

import { createE2eRunRoot } from '../../src/environment/createE2eRunRoot.js';
import { createE2eWorkerPaths } from '../../src/environment/createE2eWorkerPaths.js';
import { removeE2eRunRoot } from '../../src/environment/removeE2eRunRoot.js';
import type { ServiceFixtureCleanup } from '../../src/fixtures/finishServiceFixture.js';
import { E2eBackendStartupFailure } from '../../src/environment/startE2eBackendProcess.js';
import { runIsolatedBackendTest } from '../../src/fixtures/isolatedBackendTest.js';
import { runIsolatedWebTest } from '../../src/fixtures/isolatedWebTest.js';

test.describe('SYS-SERVICE-FIXTURE-LIFECYCLE-001 @critical @security', () => {
  for (const family of ['backend', 'web'] as const) {
    test(`${family} preserves the root after unverified first-start cleanup`, async () => {
      const runRoot = createE2eRunRoot();
      const marker = join(runRoot, 'evidence.txt');
      writeFileSync(marker, 'synthetic evidence');
      const failure = new E2eBackendStartupFailure({
        errorCode: 'E2E_BACKEND_HEALTH_TIMEOUT',
        spawnObserved: true,
        exitedBeforeCleanup: false,
        listeningNotice: 'notObserved',
        cleanup: { processTree: 'unverified', port: 'released' },
      });
      const testInfo = {
        title: 'SYS-SERVICE-FIXTURE-LIFECYCLE-001',
        status: 'passed', expectedStatus: 'passed',
        attach: async () => undefined,
      } as unknown as TestInfo;
      const dependencies = {
        createE2eRunRoot: () => runRoot,
        createE2eWorkerPaths,
        removeE2eRunRoot,
        reserveLoopbackPort: async () => 12345,
        startE2eBackendProcess: async () => { throw failure; },
        waitForLoopbackPortRelease: async () => undefined,
        collectBackendFailureArtifacts: async () => { throw new Error('UNREACHABLE'); },
        collectWebFailureArtifacts: async () => { throw new Error('UNREACHABLE'); },
        requestFactory: { newContext: async () => { throw new Error('UNREACHABLE'); } },
        startE2eWebProcess: async () => { throw new Error('UNREACHABLE'); },
        installE2eBrowserNetworkBoundary: async () => { throw new Error('UNREACHABLE'); },
      };
      try {
        const use = async () => { throw new Error('BODY_MUST_NOT_RUN'); };
        const run = family === 'backend'
          ? runIsolatedBackendTest({ e2eFaultPlan: { kind: 'none' } }, use, testInfo,
            dependencies)
          : runIsolatedWebTest({ e2eFaultPlan: { kind: 'none' },
            context: {} as never, page: {} as never }, use, testInfo,
            dependencies);
        await expect(run).rejects.toBe(failure);
        expect(existsSync(marker)).toBe(true);
      } finally {
        // These fixtures never spawn a process; the contract test owns this root.
        rmSync(runRoot, { recursive: true, force: true });
      }
    });
  }
});

test.describe('SYS-SERVICE-FIXTURE-LIFECYCLE-001 @critical @security completion', () => {
  for (const family of ['backend', 'web'] as const) {
    for (const fault of ['api', 'apiSync', 'backendStop', 'port', 'artifacts', 'remove'] as const) {
      test(`${family} preserves the original failure and root when ${fault} fails`, async () => {
        const fixture = completionFixture(fault);
        try {
          await expect(fixture.run(family, true)).rejects.toBe(fixture.bodyError);
          expect(existsSync(fixture.marker)).toBe(true);
          for (const call of ['backendStop', 'backendPort', 'artifacts']) {
            expect(fixture.calls).toContain(call);
          }
          if (family === 'web') {
            expect(fixture.calls).toContain('webStop');
            expect(fixture.calls).toContain('webPort');
          } else {
            expect(fixture.calls).toContain('api1');
            expect(fixture.calls).toContain('api2');
          }
          expect(fixture.cleanup().runRoot).toBe(fault === 'remove' ? 'removalFailed' : 'retained');
          expect(JSON.stringify(fixture.reports)).not.toContain('PRIVATE');
          expect(JSON.stringify(fixture.reports)).not.toContain(fixture.runRoot);
        } finally { fixture.remove(); }
      });
    }
    test(`${family} cannot pass after a cleanup failure`, async () => {
      const fixture = completionFixture('port');
      try {
        await expect(fixture.run(family)).rejects.toThrow('E2E_SERVICE_FIXTURE_CLEANUP_FAILED');
        expect(fixture.cleanup().backendPort).toBe('failed');
        expect(existsSync(fixture.marker)).toBe(true);
      } finally { fixture.remove(); }
    });
    test(`${family} preserves a Playwright-recorded test failure`, async () => {
      const fixture = completionFixture('backendStop');
      fixture.testInfo.status = 'failed';
      try {
        await expect(fixture.run(family)).resolves.toBeUndefined();
        expect(fixture.cleanup()).toMatchObject({ backend: 'failed', runRoot: 'retained' });
      } finally { fixture.remove(); }
    });
    test(`${family} reporting cannot mask the original failure`, async () => {
      const fixture = completionFixture('report');
      try {
        await expect(fixture.run(family, true)).rejects.toBe(fixture.bodyError);
        expect(fixture.calls).toContain('report');
      } finally { fixture.remove(); }
    });
    test(`${family} returns successfully only after clean root removal`, async () => {
      const fixture = completionFixture();
      try {
        await expect(fixture.run(family)).resolves.toBeUndefined();
        expect(existsSync(fixture.marker)).toBe(false);
        expect(fixture.calls.at(-1)).toBe('remove');
      } finally { fixture.remove(); }
    });
    test(`${family} verified startup cleanup permits removal without erasing the error`, async () => {
      const fixture = completionFixture('startupVerified');
      try {
        await expect(fixture.run(family)).rejects.toBe(fixture.startupError);
        expect(existsSync(fixture.marker)).toBe(false);
        expect(fixture.cleanup()).toMatchObject({ priorCleanup: 'verified', runRoot: 'removed' });
      } finally { fixture.remove(); }
    });
  }
  test('web startup without a process handle is not verified by a free port', async () => {
    const fixture = completionFixture('webStartup');
    try {
      await expect(fixture.run('web')).rejects.toBe(fixture.webError);
      expect(fixture.cleanup()).toMatchObject({
        web: 'notStarted', backend: 'completed', webPort: 'completed',
        priorCleanup: 'unverified', runRoot: 'retained',
      });
    } finally { fixture.remove(); }
  });
  test('web stop failure still stops the backend and keeps the root', async () => {
    const fixture = completionFixture('webStop');
    try {
      await expect(fixture.run('web', true)).rejects.toBe(fixture.bodyError);
      expect(fixture.cleanup()).toMatchObject({ web: 'failed', backend: 'completed', runRoot: 'retained' });
      expect(fixture.calls).toContain('backendPort');
      expect(existsSync(fixture.marker)).toBe(true);
    } finally { fixture.remove(); }
  });
  test('failed restart invalidates the old handles and refuses another start', async () => {
    const fixture = completionFixture('restart');
    try {
      await expect(fixture.runBackend(async (harness) => {
        await expect(harness.restartBackend()).rejects.toBe(fixture.startupError);
        expect(() => harness.backend).toThrow('E2E backend is unavailable.');
        expect(() => harness.api).toThrow('E2E backend API is unavailable.');
        await expect(harness.restartBackend()).rejects.toThrow('E2E backend cannot be restarted.');
      })).rejects.toThrow('E2E_SERVICE_FIXTURE_CLEANUP_FAILED');
      expect(fixture.calls.filter((call) => call === 'backendStop')).toHaveLength(1);
      expect(fixture.calls.filter((call) => call === 'backendStart')).toHaveLength(2);
      expect(fixture.cleanup()).toMatchObject({ priorCleanup: 'unverified', runRoot: 'retained' });
    } finally { fixture.remove(); }
  });
  test('later teardown success cannot erase unverified restart shutdown', async () => {
    const fixture = completionFixture('restartStop');
    try {
      await expect(fixture.runBackend(async (harness) => {
        await expect(harness.restartBackend()).rejects.toBe(fixture.cleanupError);
        await expect(harness.restartBackend()).rejects.toThrow('E2E backend cannot be restarted.');
      })).rejects.toThrow('E2E_SERVICE_FIXTURE_CLEANUP_FAILED');
      expect(fixture.cleanup()).toMatchObject({ backend: 'completed', priorCleanup: 'unverified', runRoot: 'retained' });
    } finally { fixture.remove(); }
  });
});

function completionFixture(fault?:
  'api' | 'apiSync' | 'backendStop' | 'port' | 'artifacts' | 'remove' | 'report' | 'webStop' |
  'webStartup' | 'startupVerified' | 'restart' | 'restartStop'
) {
  const runRoot = createE2eRunRoot();
  const marker = join(runRoot, 'evidence.txt');
  writeFileSync(marker, 'synthetic evidence');
  const calls: string[] = [];
  const reports: { schemaVersion: number; cleanup: ServiceFixtureCleanup }[] = [];
  const bodyError = new Error('PRIVATE_BODY_FAILURE');
  const cleanupError = new Error('PRIVATE_CLEANUP_FAILURE');
  const webError = new Error('PRIVATE_WEB_STARTUP_FAILURE');
  const startupError = new E2eBackendStartupFailure({
    errorCode: 'E2E_BACKEND_HEALTH_TIMEOUT', spawnObserved: true,
    exitedBeforeCleanup: false, listeningNotice: 'notObserved',
    cleanup: { processTree: fault === 'startupVerified' ? 'stopped' : 'unverified', port: 'released' },
  });
  const testInfo = {
    title: 'SYS-SERVICE-FIXTURE-LIFECYCLE-001', status: 'passed', expectedStatus: 'passed',
    attach: async (_name: string, options: { body: string }) => {
      calls.push('report');
      if (fault === 'report') throw cleanupError;
      reports.push(JSON.parse(options.body));
    },
  } as unknown as TestInfo;
  let starts = 0;
  let stops = 0;
  let ports = 0;
  let apis = 0;
  const dependencies = {
    createE2eRunRoot: () => runRoot, createE2eWorkerPaths,
    reserveLoopbackPort: async () => 12345 + ports++,
    startE2eBackendProcess: async () => {
      calls.push('backendStart');
      if (fault === 'startupVerified' || (++starts === 2 && fault === 'restart')) throw startupError;
      return {
        backendOrigin: 'http://127.0.0.1:12345', sessionSecret: 'PRIVATE_SYNTHETIC_SESSION',
        managedProcess: {} as never,
        stop: async () => {
          calls.push('backendStop');
          if (fault === 'backendStop' || (++stops === 1 && fault === 'restartStop')) throw cleanupError;
        },
      };
    },
    startE2eWebProcess: async () => {
      if (fault === 'webStartup') throw webError;
      return { webOrigin: 'http://127.0.0.1:12346', managedProcess: {} as never,
        stop: async () => {
          calls.push('webStop');
          if (fault === 'webStop') throw cleanupError;
        } };
    },
    requestFactory: { newContext: async () => {
      const id = ++apis;
      return { dispose: () => {
        calls.push(`api${id}`);
        if (fault === 'apiSync' && id === 1) throw cleanupError;
        if (fault === 'api' && id === 1) return Promise.reject(cleanupError);
        return Promise.resolve();
      } } as APIRequestContext;
    } },
    installE2eBrowserNetworkBoundary: async () => ({ assertNoBlockedRequests: () => undefined }),
    waitForLoopbackPortRelease: async (port: number) => {
      calls.push(port === 12345 ? 'backendPort' : 'webPort');
      if (fault === 'port') throw cleanupError;
    },
    collectBackendFailureArtifacts: async () => {
      calls.push('artifacts');
      if (fault === 'artifacts') throw cleanupError;
    },
    collectWebFailureArtifacts: async () => {
      calls.push('artifacts');
      if (fault === 'artifacts') throw cleanupError;
    },
    removeE2eRunRoot: async (root: string) => {
      calls.push('remove');
      if (fault === 'remove') throw cleanupError;
      await removeE2eRunRoot(root);
    },
  };
  const runBackend = (use: Parameters<typeof runIsolatedBackendTest>[1]) =>
    runIsolatedBackendTest({ e2eFaultPlan: { kind: 'none' } }, use, testInfo, dependencies);
  return {
    runRoot, marker, calls, reports, testInfo, bodyError, cleanupError, webError, startupError, runBackend,
    cleanup: () => reports[0]!.cleanup,
    run: (family: 'backend' | 'web', bodyFails = false) => {
      const use = async () => {
        calls.push('body');
        if (bodyFails) throw bodyError;
      };
      return family === 'backend' ? runBackend(use) : runIsolatedWebTest({
        e2eFaultPlan: { kind: 'none' }, context: {} as never,
        page: { goto: async () => undefined } as never,
      }, use, testInfo, dependencies);
    },
    // Fake services never spawn processes; this test owns its entire temporary root.
    remove: () => rmSync(runRoot, { recursive: true, force: true }),
  };
}
