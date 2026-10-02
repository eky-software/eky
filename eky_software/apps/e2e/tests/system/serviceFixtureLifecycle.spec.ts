import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type APIRequestContext, type TestInfo } from '@playwright/test';

import { createBoundedProcessOutput } from '../../src/environment/boundedProcessOutput.js';
import { createE2eRunRoot } from '../../src/environment/createE2eRunRoot.js';
import { createE2eWorkerPaths } from '../../src/environment/createE2eWorkerPaths.js';
import {
  createE2eFixtureLifetime,
  type E2eFixtureLifetime,
} from '../../src/environment/e2eFixtureLifetime.js';
import { removeE2eRunRoot } from '../../src/environment/removeE2eRunRoot.js';
import { reserveLoopbackPort } from '../../src/environment/reserveLoopbackPort.js';
import type { ServiceFixtureCleanup } from '../../src/fixtures/finishServiceFixture.js';
import { E2eBackendStartupFailure } from '../../src/environment/startE2eBackendProcess.js';
import { E2eWebStartupFailure, startE2eWebProcess } from '../../src/environment/startE2eWebProcess.js';
import { OwnedWindowsViteStartupFailure } from '../../src/environment/startOwnedWindowsVite.js';
import { runIsolatedBackendTest } from '../../src/fixtures/isolatedBackendTest.js';
import { runIsolatedWebTest } from '../../src/fixtures/isolatedWebTest.js';

test.describe('SYS-SERVICE-FIXTURE-LIFECYCLE-001 @critical @security', () => {
  for (const [family, hasOutput] of [['backend', true], ['web', true], ['backend', false], ['web', false]] as const) {
    test(`${family} preserves first-start failure and root with output ${hasOutput ? 'available' : 'unavailable'}`, async ({}, reportInfo) => {
      const runRoot = createE2eRunRoot();
      const marker = join(runRoot, 'evidence.txt');
      writeFileSync(marker, 'synthetic evidence');
      const failure = hasOutput ? new E2eBackendStartupFailure({
        errorCode: 'E2E_BACKEND_HEALTH_TIMEOUT',
        spawnObserved: true,
        exitedBeforeCleanup: false,
        listeningNotice: 'notObserved',
        lastHealthProbe: 'notObserved',
        cleanup: { processTree: 'unverified', port: 'released' },
      }, { stdout: 'synthetic startup [REDACTED]', stderr: 'synthetic first-start error' }) : new Error('synthetic preparation failure');
      let portReleased = false;
      const attachments: string[] = [];
      const testInfo = {
        title: 'SYS-SERVICE-FIXTURE-LIFECYCLE-001',
        timeout: 60_000,
        status: 'passed', expectedStatus: 'passed',
        outputPath: (name: string) => reportInfo.outputPath(name),
        annotations: reportInfo.annotations,
        attach: async (name: string) => {
          expect(portReleased).toBe(true);
          attachments.push(name);
        },
      } as unknown as TestInfo;
      const dependencies = {
        createE2eFixtureLifetime,
        createE2eRunRoot: () => runRoot,
        createE2eWorkerPaths,
        removeE2eRunRoot,
        reserveLoopbackPort: async () => 12345,
        startE2eBackendProcess: async () => { throw failure; },
        waitForLoopbackPortRelease: async () => { portReleased = true; },
        collectBackendFailureArtifacts: async () => { throw new Error('UNREACHABLE'); },
        collectWebFailureArtifacts: async () => { throw new Error('UNREACHABLE'); },
        requestFactory: { newContext: async () => { throw new Error('UNREACHABLE'); } },
        startE2eWebProcess: async () => { throw new Error('UNREACHABLE'); },
        installE2eBrowserNetworkBoundary: async () => { throw new Error('UNREACHABLE'); },
      };
      try {
        const use = async () => { throw new Error('BODY_MUST_NOT_RUN'); };
        const run = family === 'backend'
          ? runIsolatedBackendTest({ e2eContainmentTimeoutMilliseconds: undefined, e2eFaultPlan: { kind: 'none' } }, use, testInfo,
            dependencies)
          : runIsolatedWebTest({ e2eContainmentTimeoutMilliseconds: undefined, e2eFaultPlan: { kind: 'none' },
            context: { close: async () => undefined } as never, page: {} as never }, use, testInfo,
            dependencies);
        await expect(run).rejects.toBe(failure);
        expect(existsSync(marker)).toBe(true);
        expect(attachments).toEqual(['backend-startup-output', 'fixture-process-output', 'service-fixture-cleanup']);
        const evidence = JSON.parse(readFileSync(reportInfo.outputPath('backend-startup.private.json'), 'utf8'));
        expect(evidence.source).toBe(hasOutput ? 'available' : 'unavailable');
        expect(evidence.stdout).toBe(hasOutput ? 'synthetic startup [REDACTED]' : undefined);
        expect(evidence.stderr).toBe(hasOutput ? 'synthetic first-start error' : undefined);
      } finally {
        // These fixtures never spawn a process; the contract test owns this root.
        rmSync(runRoot, { recursive: true, force: true });
      }
    });
  }
});

test.describe('SYS-SERVICE-FIXTURE-LIFECYCLE-001 @critical @security completion', () => {
  for (const reportFault of ['none', 'write', 'attach', 'cleanupReport'] as const) {
    test(`rejected web owner output reaches post-cleanup reporting with ${reportFault} failure`, async ({}, info) => {
      let original: unknown;
      const output = createBoundedProcessOutput(128, ['PRIVATE_SYNTHETIC_SESSION']);
      output.append(Buffer.from(`${'x'.repeat(256)}PRIVATE_SYNTHETIC_SESSION first Vite rejection`));
      const fixture = completionFixture(undefined, {
        startWeb: async input => {
          try {
            // Exercise the real adapter -> error -> fixture -> private writer chain.
            // The injected owner never starts a process; the real port check uses a free loopback port.
            return await startE2eWebProcess({ ...input, webPort: await reserveLoopbackPort() }, {
              startOwned: async () => {
                throw new OwnedWindowsViteStartupFailure({ startupFailure: 'workloadExited',
                  spawnObserved: true, exitedBeforeCleanup: true, processTree: 'stopped',
                }, { readStdout: () => 'synthetic Vite stdout', readStderr: output.read });
              },
            });
          } catch (error) {
            original = error;
            output.append(Buffer.from('later cleanup output'.repeat(128)));
            throw error;
          }
        },
      });
      fixture.testInfo.annotations = [];
      fixture.testInfo.outputPath = (...segments) => {
        expect(fixture.calls).toContain('backendStop');
        expect(fixture.calls).toContain('webPort');
        expect(fixture.calls).toContain('backendPort');
        expect(existsSync(fixture.runRoot)).toBe(false);
        if (reportFault === 'write') throw new Error('PRIVATE_OUTPUT_PATH_FAILURE');
        return info.outputPath(...segments);
      };
      const attach = fixture.testInfo.attach;
      fixture.testInfo.attach = async (name, options) => {
        if ((reportFault === 'attach' && name === 'fixture-process-output') ||
          (reportFault === 'cleanupReport' && name === 'service-fixture-cleanup')) {
          throw new Error('PRIVATE_ATTACHMENT_FAILURE');
        }
        await attach(name, options);
      };
      try {
        let rejected: unknown;
        try { await fixture.run('web'); } catch (error) { rejected = error; }
        expect(rejected).toBeInstanceOf(E2eWebStartupFailure);
        expect(rejected === original).toBe(true);
        const error = rejected as E2eWebStartupFailure;
        expect(error.message).toBe('E2E_WEB_CHILD_EXITED_BEFORE_HEALTH');
        expect(error.evidence.cleanup).toEqual({ processTree: 'stopped', port: 'released' });
        expect(fixture.calls).not.toContain('body');
        expect(fixture.calls).not.toContain('webStop');
        expect(fixture.calls.filter(call => call === 'backendStop')).toHaveLength(1);
        if (reportFault === 'write') {
          expect(existsSync(info.outputPath('process-output.private.json'))).toBe(false);
        } else {
          const report = JSON.parse(readFileSync(info.outputPath('process-output.private.json'), 'utf8'));
          const stream = report.streams.find((value: { name: string }) => value.name === 'web');
          expect(stream).toMatchObject({ source: 'available', stdout: 'synthetic Vite stdout' });
          expect(stream.stderr).toBe(error.readPrivateOutput()!.stderr);
          expect(stream.stderr).toContain('[REDACTED] first Vite rejection');
          expect(Buffer.byteLength(stream.stderr)).toBeLessThanOrEqual(128);
          expect(stream.stderr).not.toMatch(/PRIVATE|later cleanup/);
        }
        const annotation = fixture.testInfo.annotations.find(value => value.type === 'fixture-output-evidence');
        expect(annotation).toBeDefined();
        expect(JSON.parse(annotation!.description!)).toMatchObject({
          file: reportFault === 'write' ? 'writeFailed' : 'written',
          attachment: reportFault === 'write' ? 'notAttempted' : reportFault === 'attach' ? 'attachmentFailed' : 'attached',
        });
        expect(JSON.stringify([error, fixture.startupReports, fixture.reports, fixture.testInfo.annotations]))
          .not.toMatch(/PRIVATE|first Vite rejection|synthetic Vite stdout|later cleanup/);
      } finally { fixture.remove(); }
    });
  }

  for (const family of ['backend', 'web'] as const) {
    for (const failure of ['body', 'assertion', 'backendStop', 'port', 'artifacts', 'remove'] as const) {
      test(`${family} exports bounded process output after ${failure} without database or config capture`, async ({}, info) => {
        const fixture = completionFixture(failure === 'body' || failure === 'assertion' ? undefined : failure);
        fixture.testInfo.outputPath = (...segments) => info.outputPath(...segments);
        fixture.testInfo.annotations = info.annotations;
        if (failure === 'assertion' || failure === 'artifacts') fixture.testInfo.status = 'failed';
        try {
          const run = fixture.run(family, failure === 'body');
          if (failure === 'body') await expect(run).rejects.toBe(fixture.bodyError);
          else if (failure === 'assertion' || failure === 'artifacts') await expect(run).resolves.toBeUndefined();
          else await expect(run).rejects.toThrow('E2E_SERVICE_FIXTURE_CLEANUP_FAILED');
          const text = readFileSync(info.outputPath('process-output.private.json'), 'utf8');
          const report = JSON.parse(text);
          expect(report.family).toBe(family);
          expect(report.streams.map((stream: { name: string }) => stream.name))
            .toEqual(family === 'backend' ? ['backend'] : ['backend', 'web']);
          expect(report.streams[0]).toMatchObject({ source: 'available', stdout: 'synthetic backend [REDACTED]', stderr: 'synthetic backend error' });
          if (family === 'web') expect(report.streams[1]).toMatchObject({ source: 'available', stderr: 'synthetic web error' });
          expect(report.operationalLogs).toBe('notIncluded');
          expect(text).not.toMatch(/PRIVATE|sqlite|runtime-config/);
          expect(fixture.calls.indexOf('backendStdout')).toBeGreaterThan(fixture.calls.indexOf('backendPort'));
          expect(fixture.calls.indexOf('backendStdout')).toBeGreaterThan(fixture.calls.indexOf('artifacts'));
          if (failure === 'body' || failure === 'assertion' || failure === 'remove') {
            expect(fixture.calls.indexOf('backendStdout')).toBeGreaterThan(fixture.calls.indexOf('remove'));
          }
        } finally { fixture.remove(); }
      });
    }
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
  test('web closes its context before services and data removal', async () => {
    const fixture = completionFixture();
    try {
      await fixture.run('web');
      expect(fixture.calls.indexOf('contextClose')).toBeLessThan(fixture.calls.indexOf('webStop'));
      expect(fixture.calls.indexOf('contextClose')).toBeLessThan(fixture.calls.indexOf('remove'));
    } finally { fixture.remove(); }
  });
  test('web context-close failure retains data without replacing a body failure', async () => {
    const fixture = completionFixture('contextClose');
    try {
      await expect(fixture.run('web', true)).rejects.toBe(fixture.bodyError);
      expect(fixture.cleanup()).toMatchObject({ context: 'failed', backend: 'completed', runRoot: 'retained' });
      expect(existsSync(fixture.marker)).toBe(true);
    } finally { fixture.remove(); }
  });
  for (const fault of ['webStartupVerified', 'webStartupTreeUnverified', 'webStartupPortUnverified'] as const) {
    test(`web startup preserves its error and respects ${fault} evidence`, async () => {
      const fixture = completionFixture(fault);
      try {
        await expect(fixture.run('web')).rejects.toBe(fixture.webError);
        const verified = fault === 'webStartupVerified';
        expect(fixture.cleanup()).toMatchObject({
          web: 'notStarted', backend: 'completed',
          priorCleanup: verified ? 'verified' : 'unverified', runRoot: verified ? 'removed' : 'retained',
        });
        expect(existsSync(fixture.marker)).toBe(!verified);
        expect(fixture.startupReports).toEqual([{ schemaVersion: 1,
          errorCode: 'E2E_WEB_HEALTH_TIMEOUT', spawnObserved: true, exitedBeforeCleanup: false,
          cleanup: {
            processTree: fault === 'webStartupTreeUnverified' ? 'unverified' : 'stopped',
            port: fault === 'webStartupPortUnverified' ? 'unverified' : 'released',
          },
        }]);
        expect(JSON.stringify(fixture.startupReports)).not.toContain(fixture.runRoot);
      } finally { fixture.remove(); }
    });
  }
  test('web startup attachment failure cannot mask the original error or stop cleanup', async () => {
    const fixture = completionFixture('webStartupVerified');
    const attach = fixture.testInfo.attach;
    fixture.testInfo.attach = async (name, options) => {
      if (name === 'web-startup-failure') throw new Error('PRIVATE_ATTACHMENT_FAILURE');
      await attach(name, options);
    };
    try {
      await expect(fixture.run('web')).rejects.toBe(fixture.webError);
      expect(fixture.cleanup().runRoot).toBe('removed');
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
  test('later teardown success preserves the earlier stop error identity and root', async () => {
    const fixture = completionFixture('restartStop');
    try {
      await expect(fixture.runBackend(async (harness) => {
        await harness.restartBackend();
      })).rejects.toBe(fixture.cleanupError);
      expect(fixture.calls.filter((call) => call === 'backendStop')).toHaveLength(2);
      expect(fixture.calls).toContain('backendPort');
      expect(fixture.cleanup()).toMatchObject({
        backend: 'completed', backendPort: 'completed', priorCleanup: 'unverified', runRoot: 'retained',
      });
      expect(existsSync(fixture.marker)).toBe(true);
    } finally { fixture.remove(); }
  });
  test('later teardown success preserves the first body error after an unverified stop', async () => {
    const fixture = completionFixture('restartStop');
    try {
      await expect(fixture.runBackend(async (harness) => {
        try {
          throw fixture.bodyError;
        } finally {
          await expect(harness.restartBackend()).rejects.toBe(fixture.cleanupError);
        }
      })).rejects.toBe(fixture.bodyError);
      expect(fixture.calls.filter((call) => call === 'backendStop')).toHaveLength(2);
      expect(fixture.cleanup()).toMatchObject({
        api: 'completed', backend: 'completed', backendPort: 'completed',
        priorCleanup: 'unverified', runRoot: 'retained',
      });
      expect(existsSync(fixture.marker)).toBe(true);
      expect(JSON.stringify(fixture.reports)).not.toContain('PRIVATE');
    } finally { fixture.remove(); }
  });
});

test.describe('E2E fixture lifetime propagation', () => {
  for (const family of ['backend', 'web'] as const) {
    for (const timeout of [60_000, 150_000]) {
      test(`${family} captures the ${timeout}ms entry ceiling before setup without following later timeout changes`, async () => {
        let now = 0;
        const fixture = completionFixture(undefined, { now: () => now });
        fixture.testInfo.timeout = timeout;
        try {
          await fixture.runWith(family, async () => {
            expect(fixture.calls.slice(0, 2)).toEqual(['lifetime', 'root']);
            expect(fixture.testInfo.timeout).toBe(timeout);
            const lifetime = fixture.lifetimes[0]!;
            if (family === 'web') expect(fixture.webLifetimes).toEqual([lifetime]);
            expect(lifetime.readRemainingWorkMilliseconds()).toBe(timeout);
            fixture.testInfo.timeout = 20 * 60_000;
            now = 25_000;
            expect(lifetime.readRemainingWorkMilliseconds()).toBe(timeout - 25_000);
          });
          expect(fixture.calls.filter((call) => call === 'lifetime')).toHaveLength(1);
        } finally { fixture.remove(); }
      });
    }

    test(`${family} uses an explicit long containment ceiling without increasing the setup timeout`, async () => {
      let now = 0;
      const fixture = completionFixture(undefined, {
        containmentTimeoutMilliseconds: 20 * 60_000, now: () => now,
      });
      try {
        await fixture.runWith(family, async () => {
          expect(fixture.testInfo.timeout).toBe(60_000);
          now = 61_000;
          expect(fixture.lifetimes[0]!.readRemainingWorkMilliseconds()).toBe(20 * 60_000 - 61_000);
        });
        expect(fixture.testInfo.timeout).toBe(60_000);
      } finally { fixture.remove(); }
    });

    for (const invalid of [0, NaN, Infinity, null as unknown as number]) {
      test(`${family} rejects an invalid ${String(invalid)} override before setup instead of falling back`, async () => {
        const fixture = completionFixture(undefined, { containmentTimeoutMilliseconds: invalid });
        try {
          await expect(fixture.run(family)).rejects.toThrow('E2E_FIXTURE_LIFETIME_INPUT_INVALID');
          expect(fixture.calls).toEqual(['lifetime']);
          expect(fixture.testInfo.timeout).toBe(60_000);
        } finally { fixture.remove(); }
      });
    }
  }

  test('backend restarts and sibling callers retain the fixture-entry lifetime', async () => {
    let now = 0;
    const fixture = completionFixture(undefined, { now: () => now });
    try {
      await fixture.runBackend(async (harness) => {
        const siblingLifetime = harness.lifetime;
        expect(siblingLifetime).toBe(fixture.lifetimes[0]);
        now = 25_000;
        await harness.restartBackend();
        expect(fixture.lifetimes).toHaveLength(2);
        expect(fixture.lifetimes[1]).toBe(siblingLifetime);
        expect(siblingLifetime.readRemainingWorkMilliseconds()).toBe(35_000);
        now = 60_000;
        expect(siblingLifetime.readRemainingWorkMilliseconds()).toBe(0);
      });
      expect(fixture.calls.filter((call) => call === 'lifetime')).toHaveLength(1);
      expect(fixture.calls.filter((call) => call === 'backendStop')).toHaveLength(2);
    } finally { fixture.remove(); }
  });
});

function completionFixture(fault?:
  'api' | 'apiSync' | 'backendStop' | 'port' | 'artifacts' | 'remove' | 'report' | 'webStop' |
  'webStartup' | 'webStartupVerified' | 'webStartupTreeUnverified' | 'webStartupPortUnverified' |
  'startupVerified' | 'restart' | 'restartStop' | 'contextClose',
  timing: { containmentTimeoutMilliseconds?: number; now?: () => number; startWeb?: typeof startE2eWebProcess } = {},
) {
  const runRoot = createE2eRunRoot();
  const marker = join(runRoot, 'evidence.txt');
  writeFileSync(marker, 'synthetic evidence');
  const calls: string[] = [];
  const lifetimes: E2eFixtureLifetime[] = [];
  const webLifetimes: E2eFixtureLifetime[] = [];
  const reports: { schemaVersion: number; cleanup: ServiceFixtureCleanup }[] = [];
  const startupReports: unknown[] = [];
  const bodyError = new Error('PRIVATE_BODY_FAILURE');
  const cleanupError = new Error('PRIVATE_CLEANUP_FAILURE');
  const webError = fault?.startsWith('webStartup') && fault !== 'webStartup'
    ? new E2eWebStartupFailure({ errorCode: 'E2E_WEB_HEALTH_TIMEOUT', spawnObserved: true,
      exitedBeforeCleanup: false, cleanup: {
        processTree: fault === 'webStartupTreeUnverified' ? 'unverified' : 'stopped',
        port: fault === 'webStartupPortUnverified' ? 'unverified' : 'released',
      } }) : new Error('PRIVATE_WEB_STARTUP_FAILURE');
  const startupError = new E2eBackendStartupFailure({
    errorCode: 'E2E_BACKEND_HEALTH_TIMEOUT', spawnObserved: true,
    exitedBeforeCleanup: false, listeningNotice: 'notObserved',
    lastHealthProbe: 'notObserved',
    cleanup: { processTree: fault === 'startupVerified' ? 'stopped' : 'unverified', port: 'released' },
  });
  const testInfo = {
    title: 'SYS-SERVICE-FIXTURE-LIFECYCLE-001', status: 'passed', expectedStatus: 'passed',
    timeout: 60_000,
    attach: async (name: string, options: { body: string }) => {
      calls.push('report');
      if (fault === 'report') throw cleanupError;
      if (name === 'fixture-process-output' || name === 'backend-startup-output') return;
      if (name === 'web-startup-failure') startupReports.push(JSON.parse(options.body));
      else reports.push(JSON.parse(options.body));
    },
  } as unknown as TestInfo;
  let starts = 0;
  let stops = 0;
  let ports = 0;
  let apis = 0;
  const dependencies = {
    createE2eFixtureLifetime: (timeout: number) => {
      calls.push('lifetime');
      return createE2eFixtureLifetime(timeout, timing.now);
    },
    createE2eRunRoot: () => { calls.push('root'); return runRoot; }, createE2eWorkerPaths,
    reserveLoopbackPort: async () => 12345 + ports++,
    startE2eBackendProcess: async ({ lifetime }: { lifetime: E2eFixtureLifetime }) => {
      calls.push('backendStart');
      lifetimes.push(lifetime);
      if (fault === 'startupVerified' || (++starts === 2 && fault === 'restart')) throw startupError;
      return {
        backendOrigin: 'http://127.0.0.1:12345', sessionSecret: 'PRIVATE_SYNTHETIC_SESSION',
        managedProcess: {
          readStdout: () => { calls.push('backendStdout'); return 'synthetic backend [REDACTED]'; },
          readStderr: () => 'synthetic backend error',
        } as never,
        workload: {
          instanceId: `synthetic-backend-${String(starts)}`,
          readState: async () => { throw new Error('UNEXPECTED_WORKLOAD_STATE_READ'); },
          readRssBytes: async () => { throw new Error('UNEXPECTED_WORKLOAD_RSS_READ'); },
        },
        stop: async () => {
          calls.push('backendStop');
          if (fault === 'backendStop' || (++stops === 1 && fault === 'restartStop')) throw cleanupError;
        },
      };
    },
    startE2eWebProcess: async (input: Parameters<typeof startE2eWebProcess>[0]) => {
      const { lifetime } = input;
      webLifetimes.push(lifetime);
      if (timing.startWeb !== undefined) return timing.startWeb(input);
      if (fault?.startsWith('webStartup')) throw webError;
      return { webOrigin: 'http://127.0.0.1:12346', managedProcess: {
        readStdout: () => 'synthetic web output', readStderr: () => 'synthetic web error',
      } as never,
        workload: { readState: async () => { throw new Error('UNEXPECTED_WORKLOAD_STATE_READ'); } },
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
    runIsolatedBackendTest({ e2eContainmentTimeoutMilliseconds: timing.containmentTimeoutMilliseconds,
      e2eFaultPlan: { kind: 'none' } }, use, testInfo, dependencies);
  const runWith = (family: 'backend' | 'web', use: () => Promise<void>) =>
    family === 'backend' ? runBackend(use) : runIsolatedWebTest({
      e2eContainmentTimeoutMilliseconds: timing.containmentTimeoutMilliseconds,
      e2eFaultPlan: { kind: 'none' }, context: { close: async () => {
        calls.push('contextClose');
        if (fault === 'contextClose') throw cleanupError;
      } } as never,
      page: { goto: async () => undefined } as never,
    }, use, testInfo, dependencies);
  return {
    runRoot, marker, calls, reports, startupReports, testInfo, bodyError, cleanupError, webError, startupError, runBackend, runWith, lifetimes, webLifetimes,
    cleanup: () => reports[0]!.cleanup,
    run: (family: 'backend' | 'web', bodyFails = false) => {
      const use = async () => {
        calls.push('body');
        if (bodyFails) throw bodyError;
      };
      return runWith(family, use);
    },
    // Fake services never spawn processes; this test owns its entire temporary root.
    remove: () => rmSync(runRoot, { recursive: true, force: true }),
  };
}
