import { createServer } from 'node:http';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import { linuxPreflightPrivateCheck, readLinuxServicePreflightCheck }
  from '../../experiments/processOwnership/linuxServiceDiagnostic.mjs';
import {
  OwnedLinuxServiceStartupFailure,
  type LinuxServiceDependencies,
  type LinuxServiceInputs,
  type LinuxServiceProfile,
  type OwnedLinuxService,
} from '../../experiments/processOwnership/linuxServiceSession.mjs';
import { OwnedChromiumStartupFailure } from '../../src/environment/connectOwnedChromium.js';
import { createE2eRunRoot } from '../../src/environment/createE2eRunRoot.js';
import { createE2eWorkerPaths } from '../../src/environment/createE2eWorkerPaths.js';
import { createE2eFixtureLifetime } from '../../src/environment/e2eFixtureLifetime.js';
import { removeE2eRunRoot } from '../../src/environment/removeE2eRunRoot.js';
import { reserveLoopbackPort } from '../../src/environment/reserveLoopbackPort.js';
import { E2eBackendStartupFailure, startE2eBackendProcess } from '../../src/environment/startE2eBackendProcess.js';
import { E2eWebStartupFailure, startE2eWebProcess } from '../../src/environment/startE2eWebProcess.js';
import { startOwnedLinuxBackend, OwnedLinuxServiceStartupFailure as BackendOwnerFailure }
  from '../../src/environment/startOwnedLinuxBackend.js';
import { startOwnedLinuxChromium } from '../../src/environment/startOwnedLinuxChromium.js';
import { startOwnedLinuxVite, OwnedLinuxServiceStartupFailure as ViteOwnerFailure }
  from '../../src/environment/startOwnedLinuxVite.js';

const repositoryRoot = resolve(import.meta.dirname, '../../../..');
const output = { readStdout: () => '', readStderr: () => '' };
const privateCheck = 'MANAGED_NAMESPACE_PREFLIGHT_CHECK:sudo:tool:rootOwner';

test.describe('Linux service injection ports', () => {
  for (const profile of ['backend', 'vite', 'chromium'] as const) {
    test(`${profile} forwards the existing factories and unchanged input before preflight`, async () => {
      const runRoot = createE2eRunRoot();
      const input = {
        repositoryRoot, runRoot, lifetime: createE2eFixtureLifetime(30_000),
        startupDeadline: performance.now() + 10_000, redactedValues: ['synthetic-session'],
        runtimeConfigPath: resolve(runRoot, 'runtime-config.json'),
        webPort: 12345, environmentRoot: runRoot, backendOrigin: 'http://127.0.0.1:12346',
        sessionSecret: 'synthetic-session', browserExecutable: resolve(runRoot, 'chrome'),
      };
      const calls: string[] = [];
      let seenInput: unknown;
      let seenProfile: unknown;
      let browserAccessed = false;
      function dependencies<P extends LinuxServiceProfile>(): LinuxServiceDependencies<P> {
        return {
          prepare(actualProfile, actualInput) {
            calls.push('prepare'); seenProfile = actualProfile; seenInput = actualInput;
            throw Object.assign(new Error('SYNTHETIC_PREPARATION_FAILURE'), { reason: 'preparationFailed' });
          },
          get createManager() {
            calls.push('createManager selected');
            return () => { calls.push('createManager called'); throw new Error('UNEXPECTED_MANAGER'); };
          },
          get listen() {
            calls.push('listen selected');
            return () => { calls.push('listen called'); throw new Error('UNEXPECTED_LISTENER'); };
          },
        };
      }
      try {
        const operation = profile === 'backend' ? startOwnedLinuxBackend(input, dependencies<'backend'>())
          : profile === 'vite' ? startOwnedLinuxVite(input, dependencies<'vite'>())
          : startOwnedLinuxChromium(input, { get chromium(): never {
            browserAccessed = true; throw new Error('UNEXPECTED_BROWSER');
          } }, dependencies<'chromium'>());
        const error = await rejection(operation);
        expect(seenProfile).toBe(profile);
        expect(seenInput).toBe(input);
        expect(calls).toEqual(['createManager selected', 'listen selected', 'prepare']);
        expect(browserAccessed).toBe(false);
        expect(BackendOwnerFailure).toBe(OwnedLinuxServiceStartupFailure);
        expect(ViteOwnerFailure).toBe(OwnedLinuxServiceStartupFailure);
        if (profile === 'chromium') {
          expect(error).toBeInstanceOf(OwnedChromiumStartupFailure);
          expect(error).toMatchObject({ processTree: 'stopped', phase: 'ownerPreparation', ownerFailure: 'preparationFailed' });
        } else {
          expect(error).toBeInstanceOf(OwnedLinuxServiceStartupFailure);
          expect(error).toMatchObject({ evidence: {
            startupFailure: 'preparationFailed', processTree: 'stopped', spawnObserved: false, exitedBeforeCleanup: false,
          } });
        }
      } finally { await removeE2eRunRoot(runRoot); }
    });
  }

  for (const profile of ['backend', 'vite'] as const) {
    for (const processTree of ['stopped', 'unverified'] as const) {
      test(`${profile} owning override preserves class-based ${processTree} startup evidence`, async () => {
        const runRoot = createE2eRunRoot();
        const paths = createE2eWorkerPaths(runRoot, 'LINUX-PORTS-001');
        const lifetime = createE2eFixtureLifetime(30_000);
        const port = await reserveLoopbackPort();
        const calls: (LinuxServiceInputs['backend'] | LinuxServiceInputs['vite'])[] = [];
        const failure = new OwnedLinuxServiceStartupFailure(profile, {
          startupFailure: 'observationLost', processTree, spawnObserved: true, exitedBeforeCleanup: false,
        }, output, { cause: new Error('Managed namespace host metadata unverified', {
          cause: { message: privateCheck },
        }) });
        const before = performance.now();
        try {
          const error = await rejection(profile === 'backend'
            ? startE2eBackendProcess({ runRoot, paths, lifetime, backendPort: port, scenarioId: 'LINUX-PORTS-001' }, {
              async startOwned(input) { calls.push(input); throw failure; },
            })
            : startE2eWebProcess({ runRoot, paths, lifetime, webPort: port, backend: backendStub() }, {
              async startOwned(input) { calls.push(input); throw failure; },
            }));
          expect(calls).toHaveLength(1);
          const seen = calls[0]!;
          expect(seen.repositoryRoot).toBe(repositoryRoot);
          expect(seen.runRoot).toBe(runRoot);
          expect(seen.lifetime).toBe(lifetime);
          expect(seen.startupDeadline).toBeGreaterThan(before);
          expect(seen.redactedValues).toHaveLength(1);
          if (profile === 'backend') {
            expect(seen).toHaveProperty('runtimeConfigPath', paths.runtimeConfigPath);
            expect(seen.redactedValues[0]).toMatch(/^[A-Za-z0-9_-]{43}$/u);
          } else {
            expect(seen).toMatchObject({ webPort: port, environmentRoot: paths.tempRoot,
              backendOrigin: 'http://127.0.0.1:12346', sessionSecret: 'synthetic-session' });
            expect(seen.redactedValues).toEqual(['synthetic-session']);
          }
          expect(error).toBeInstanceOf(profile === 'backend' ? E2eBackendStartupFailure : E2eWebStartupFailure);
          if (!(error instanceof E2eBackendStartupFailure || error instanceof E2eWebStartupFailure)) {
            throw new Error('EXPECTED_SAFE_STARTUP_WRAPPER');
          }
          expect(error.readPrivatePreflightCheck()).toBe(privateCheck);
          expectPublicFailureSafe(error);
          expect(error).toMatchObject({ evidence: {
            errorCode: profile === 'backend' ? 'E2E_BACKEND_WORKLOAD_OBSERVATION_LOST' : 'E2E_WEB_WORKLOAD_OBSERVATION_LOST',
            spawnObserved: true, exitedBeforeCleanup: false, cleanup: { processTree, port: 'released' },
          } });
        } finally { await removeE2eRunRoot(runRoot); }
      });
    }

    test(`${profile} owning override keeps real health checks and cached owner stop`, async () => {
      const runRoot = createE2eRunRoot();
      const paths = createE2eWorkerPaths(runRoot, 'LINUX-PORTS-002');
      const lifetime = createE2eFixtureLifetime(30_000);
      const requests: string[] = [];
      const server = createServer((request, response) => {
        requests.push(request.url ?? ''); response.end('ok');
      });
      let stopped = 0;
      let stateRead = 0;
      const close = () => new Promise<void>((yes, no) => server.close(error => error ? no(error) : yes()));
      const owner: OwnedLinuxService = {
        ...output,
        startup: { readState: () => ({ spawnObserved: true, terminal: undefined }), subscribe: () => () => {} },
        workload: { instanceId: 'synthetic-instance', async readState() { stateRead++; return 'running'; },
          async readRssBytes() { return 1; } },
        async stop() { stopped++; await close(); },
      };
      try {
        await new Promise<void>((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
        const address = server.address();
        if (address === null || typeof address === 'string') throw new Error('EXPECTED_LOOPBACK_ADDRESS');
        const startOwned = async () => owner;
        const started = profile === 'backend'
          ? await startE2eBackendProcess({ runRoot, paths, lifetime, backendPort: address.port, scenarioId: 'LINUX-PORTS-002' }, { startOwned })
          : await startE2eWebProcess({ runRoot, paths, lifetime, webPort: address.port, backend: backendStub() }, { startOwned });
        expect(started.workload).toBe(owner.workload);
        expect(started.managedProcess).toBe(owner);
        expect(stateRead).toBe(1);
        expect(requests).toEqual([profile === 'backend' ? '/health' : '/']);
        const firstStop = started.stop();
        expect(started.stop()).toBe(firstStop);
        await firstStop;
        expect(stopped).toBe(1);
      } finally {
        if (server.listening) await close();
        await removeE2eRunRoot(runRoot);
      }
    });
  }

  test('Chromium private preflight relay survives the real Linux owner error conversion', async () => {
    const runRoot = createE2eRunRoot();
    try {
      const error = await rejection(startOwnedLinuxChromium({
        repositoryRoot, runRoot, lifetime: createE2eFixtureLifetime(30_000),
        startupDeadline: performance.now() + 10_000, redactedValues: [],
        browserExecutable: resolve(runRoot, 'synthetic-browser'),
      }, { get chromium(): never { throw new Error('UNEXPECTED_BROWSER'); } }, {
        prepare() {
          throw new Error('Managed namespace host metadata unverified', { cause: { message: privateCheck } });
        },
      }));
      expect(error).toBeInstanceOf(OwnedChromiumStartupFailure);
      if (!(error instanceof OwnedChromiumStartupFailure)) throw new Error('EXPECTED_CHROMIUM_WRAPPER');
      expect(error.readPrivatePreflightCheck()).toBe(privateCheck);
      expect(error).toMatchObject({ processTree: 'stopped', phase: 'ownerPreparation', ownerFailure: 'preparationFailed' });
      expectPublicFailureSafe(error);
    } finally { await removeE2eRunRoot(runRoot); }
  });

  test('private preflight validator accepts only fixed roles, scopes and checks without coercion', () => {
    for (const role of ['sudo', 'manager', 'control', 'environment', 'namespace', 'credentials']) {
      for (const scope of ['tool', 'ancestor']) {
        for (const check of ['symbolicLink', 'entryKind', 'rootOwner', 'modeRange', 'writePermissions',
          'specialBits', 'deviceIdentity', 'inodeIdentity', 'canonicalPath', 'executable']) {
          const value = `MANAGED_NAMESPACE_PREFLIGHT_CHECK:${role}:${scope}:${check}`;
          expect(linuxPreflightPrivateCheck(value)).toBe(value);
        }
      }
    }
    for (const value of [undefined, null, 1, true, {}, [privateCheck],
      { toString() { throw new Error('UNEXPECTED_COERCION'); } },
      privateCheck.replace('sudo', 'backend'), privateCheck.replace(':tool:', ':host:'),
      privateCheck.replace('rootOwner', 'uid'), privateCheck.toLowerCase(),
      `prefix ${privateCheck}`, `${privateCheck}\n`, `${privateCheck}\r\n`, `${privateCheck}\0`,
      `${privateCheck}:uid=1001`, `${privateCheck} /PRIVATE/host`, 'x'.repeat(64 * 1024)]) {
      expect(linuxPreflightPrivateCheck(value)).toBeUndefined();
      expect(readLinuxServicePreflightCheck({ message: value })).toBeUndefined();
    }
  });

  test('private preflight reader bounds own value descriptors and excludes getters, cycles and metadata', () => {
    let getterCalls = 0;
    const getter = () => { getterCalls++; throw new Error('UNEXPECTED_GETTER'); };
    expect(readLinuxServicePreflightCheck({ message: privateCheck })).toBe(privateCheck);
    expect(readLinuxServicePreflightCheck({ cause: { cause: { message: privateCheck } } })).toBe(privateCheck);
    expect(readLinuxServicePreflightCheck({ cause: { cause: { cause: { message: privateCheck } } } })).toBeUndefined();
    const cycle: { message: string; cause?: unknown } = { message: 'safe' };
    cycle.cause = cycle;
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    for (const value of [null, undefined, privateCheck, cycle, revoked.proxy,
      Object.create({ message: privateCheck }), Object.create({ cause: { message: privateCheck } }),
      Object.defineProperty({}, 'message', { get: getter }),
      Object.defineProperty({}, 'cause', { get: getter }),
      { stack: privateCheck, metadata: { message: privateCheck }, uid: 1001, path: '/PRIVATE/host' }]) {
      expect(readLinuxServicePreflightCheck(value)).toBeUndefined();
    }
    expect(readLinuxServicePreflightCheck(Object.defineProperty({ cause: { message: privateCheck } },
      'message', { get: getter }))).toBe(privateCheck);
    expect(getterCalls).toBe(0);
  });
});

function expectPublicFailureSafe(error: Error) {
  expect(Object.getOwnPropertyDescriptor(error, 'cause')).toBeUndefined();
  expect(Object.getOwnPropertyNames(error)).not.toContain('preflightCheck');
  for (const text of [error.message, error.stack ?? '', JSON.stringify(error),
    JSON.stringify(Object.getOwnPropertyDescriptors(error))]) {
    expect(text).not.toContain('MANAGED_NAMESPACE_PREFLIGHT_CHECK');
    expect(text).not.toContain('Managed namespace host metadata unverified');
    expect(text).not.toContain('/PRIVATE/host');
  }
}

function backendStub() {
  return { backendOrigin: 'http://127.0.0.1:12346', sessionSecret: 'synthetic-session', managedProcess: output,
    workload: { instanceId: 'synthetic-backend', async readState() { return 'running' as const; },
      async readRssBytes() { return 1; } }, async stop() {} };
}

async function rejection(operation: Promise<unknown>): Promise<unknown> {
  try { await operation; }
  catch (error) { return error; }
  throw new Error('EXPECTED_STARTUP_FAILURE');
}

// Compile-only checks prevent the MJS declaration boundary from silently widening.
function dependencyTypeContract(dependencies: Required<LinuxServiceDependencies<'backend'>>,
  input: LinuxServiceInputs['backend']) {
  const prepared = dependencies.prepare('backend', input);
  // @ts-expect-error Preparation is synchronous, not a promised configuration.
  prepared.then(() => {});
  // @ts-expect-error Backend configuration cannot be mistaken for a Vite profile.
  prepared.config.webPort;
  // @ts-expect-error The selected factory only prepares its own profile.
  dependencies.prepare('vite', input);
  // @ts-expect-error The deadline is the existing closed contract, not an arbitrary object.
  dependencies.createManager(prepared.config, {});
  const listen: NonNullable<LinuxServiceDependencies<'backend'>['listen']> = (service, deadline, onReply, onLost) => {
    // @ts-expect-error Replies cannot carry arbitrary diagnostic fields.
    onReply({ privateMessage: 'synthetic' });
    // @ts-expect-error Deadline phases are closed.
    deadline.check('reset');
    // @ts-expect-error Lost observation carries no raw error argument.
    onLost(new Error('synthetic'));
    throw new Error(service.config.runtimeConfigPath);
  };
  // @ts-expect-error The owner boundary does not accept additional runtime controls.
  const invalid: Parameters<typeof startE2eBackendProcess>[1] = { startOwned: startOwnedLinuxBackend, now: () => 0 };
  return { invalid, listen };
}
