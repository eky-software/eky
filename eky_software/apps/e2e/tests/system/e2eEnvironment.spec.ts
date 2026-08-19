import { createServer } from 'node:http';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import {
  assertE2eSafetyBoundary,
  assertPathUnderRoot,
} from '../../src/environment/assertE2eSafetyBoundary.js';
import { collectFailureArtifacts } from '../../src/environment/collectFailureArtifacts.js';
import { createE2eRunRoot } from '../../src/environment/createE2eRunRoot.js';
import { createE2eWorkerPaths } from '../../src/environment/createE2eWorkerPaths.js';
import { reserveLoopbackPort } from '../../src/environment/reserveLoopbackPort.js';
import {
  e2eRunRootRemovalOptions,
  removeE2eRunRoot,
} from '../../src/environment/removeE2eRunRoot.js';
import { startManagedProcess } from '../../src/environment/startManagedProcess.js';
import { stopManagedProcessTree } from '../../src/environment/stopManagedProcessTree.js';
import { waitForHttpHealth } from '../../src/environment/waitForHttpHealth.js';
import { isAllowedE2eBrowserUrl } from '../../src/environment/e2eBrowserNetworkBoundary.js';
import {
  createE2eViteBackendProxy,
  readE2eViteRuntimeConfig,
} from '../../../web/viteE2eRuntime.js';

test.describe('SYS-ISOLATION-001 @critical @security', () => {
  test('creates every runtime path under an isolated OS temp root', async () => {
    const runRoot = createE2eRunRoot();
    try {
      const paths = createE2eWorkerPaths(runRoot, 'SYS-ISOLATION-001');

      assertE2eSafetyBoundary({
        backendHost: '127.0.0.1',
        environment: { EKY_E2E: '1' },
        paths,
        productionUserDataPath: resolve(runRoot, '..', 'production-user-data'),
        runRoot,
        smtpAdapter: 'fake',
        urls: ['http://127.0.0.1:3000', 'http://127.0.0.1:5173'],
        webHost: '127.0.0.1',
      });

      for (const path of [
        runRoot,
        paths.workerRoot,
        paths.documentsRoot,
        paths.logsRoot,
        paths.supportBundlesRoot,
      ]) {
        expect(path).toBe(realpathSync.native(path));
        expect(path.startsWith(runRoot)).toBe(true);
        expect(existsSync(path)).toBe(true);
      }
    } finally {
      rmSync(runRoot, { force: true, recursive: true });
    }
  });

  test('refuses unsafe marker, host, URL, SMTP and path boundaries', async () => {
    const runRoot = createE2eRunRoot();
    const outsideRoot = createE2eRunRoot();
    try {
      const paths = createE2eWorkerPaths(runRoot, 'SYS-ISOLATION-002');
      const validInput = {
        backendHost: '127.0.0.1',
        environment: { EKY_E2E: '1' },
        paths,
        runRoot,
        smtpAdapter: 'fake',
        urls: ['http://127.0.0.1:3000'],
        webHost: '127.0.0.1',
      } as const;

      expect(() =>
        assertE2eSafetyBoundary({
          ...validInput,
          environment: {},
        }),
      ).toThrow('marker');
      expect(() =>
        assertE2eSafetyBoundary({
          ...validInput,
          backendHost: '0.0.0.0',
        }),
      ).toThrow('loopback');
      expect(() =>
        assertE2eSafetyBoundary({
          ...validInput,
          smtpAdapter: 'smtp',
        }),
      ).toThrow('fake SMTP');
      expect(() =>
        assertE2eSafetyBoundary({
          ...validInput,
          urls: ['https://example.invalid'],
        }),
      ).toThrow('loopback origin');
      expect(() =>
        assertE2eSafetyBoundary({
          ...validInput,
          paths: {
            ...paths,
            logsRoot: outsideRoot,
          },
        }),
      ).toThrow('escapes');
      expect(() =>
        assertE2eSafetyBoundary({
          ...validInput,
          productionUserDataPath: paths.workerRoot,
        }),
      ).toThrow('production user data');
    } finally {
      rmSync(runRoot, { force: true, recursive: true });
      rmSync(outsideRoot, { force: true, recursive: true });
    }
  });

  test('rejects symbolic links inside the runtime path', async () => {
    const runRoot = createE2eRunRoot();
    const outsideRoot = createE2eRunRoot();
    try {
      const linkPath = join(runRoot, 'linked');
      symlinkSync(outsideRoot, linkPath, 'junction');

      expect(() => assertPathUnderRoot(linkPath, runRoot)).toThrow(
        /escapes|symbolic/,
      );
    } finally {
      rmSync(runRoot, { force: true, recursive: true });
      rmSync(outsideRoot, { force: true, recursive: true });
    }
  });
});

test.describe('managed E2E runtime primitives', () => {
  test('uses bounded Windows-safe retries when removing an isolated run root', async () => {
    const runRoot = createE2eRunRoot();
    let observedOptions: typeof e2eRunRootRemovalOptions | undefined;

    await removeE2eRunRoot(runRoot, async (path, options) => {
      observedOptions = options;
      rmSync(path, options);
    });

    expect(observedOptions).toEqual({
      force: true,
      maxRetries: 20,
      recursive: true,
      retryDelay: 100,
    });
    expect(existsSync(runRoot)).toBe(false);
  });

  test('keeps a persistent run-root cleanup failure visible', async () => {
    const runRoot = createE2eRunRoot();
    try {
      await expect(
        removeE2eRunRoot(runRoot, async () => {
          throw Object.assign(new Error('synthetic cleanup failure'), {
            code: 'EPERM',
          });
        }),
      ).rejects.toThrow('synthetic cleanup failure');
    } finally {
      rmSync(runRoot, { force: true, recursive: true });
    }
  });

  test('refuses to remove a directory outside the E2E run-root contract', async () => {
    const runRoot = createE2eRunRoot();
    try {
      const outsideRoot = resolve(runRoot, '..');
      await expect(removeE2eRunRoot(outsideRoot)).rejects.toThrow(
        'E2E_RUN_ROOT_REMOVAL_REFUSED',
      );
    } finally {
      rmSync(runRoot, { force: true, recursive: true });
    }
  });

  test('reserves a loopback port and waits for explicit HTTP health', async () => {
    const port = await reserveLoopbackPort();
    const server = createServer((request, response) => {
      response.statusCode = request.url === '/health' ? 200 : 404;
      response.end();
    });

    try {
      await new Promise<void>((resolveListen, rejectListen) => {
        server.once('error', rejectListen);
        server.listen(port, '127.0.0.1', resolveListen);
      });
      await waitForHttpHealth(`http://127.0.0.1:${port}/health`);
    } finally {
      await new Promise<void>((resolveClose) => {
        server.close(() => resolveClose());
      });
    }
  });

  test('bounds and redacts managed process output and stops the process', async () => {
    const secret = 'synthetic-e2e-secret';
    const managed = startManagedProcess({
      args: [
        '-e',
        `console.log('${secret}'); setInterval(() => {}, 1000);`,
      ],
      command: process.execPath,
      cwd: process.cwd(),
      environment: { EKY_E2E: '1' },
      outputLimitBytes: 1_024,
      redactedValues: [secret],
    });

    try {
      await waitForOutput(managed.readStdout);
      expect(managed.readStdout()).toContain('[REDACTED]');
      expect(managed.readStdout()).not.toContain(secret);
    } finally {
      await stopManagedProcessTree(managed.child);
    }
    expect(
      managed.child.exitCode !== null || managed.child.signalCode !== null,
    ).toBe(true);
  });

  test('collects only allowlisted files below the run root', async () => {
    const runRoot = createE2eRunRoot();
    try {
      const paths = createE2eWorkerPaths(runRoot, 'SYS-ARTIFACT-001');
      const logPath = join(paths.logsRoot, 'synthetic.jsonl');
      writeFileSync(logPath, '{"eventName":"synthetic"}\n', 'utf8');

      const manifestPath = collectFailureArtifacts({
        appVersion: '0.0.0-e2e',
        buildRevision: 'development',
        files: [logPath],
        runRoot,
        scenarioId: 'SYS-ARTIFACT-001',
        targetRoot: paths.artifactsRoot,
      });

      expect(readFileSync(manifestPath, 'utf8')).toContain(
        'SYS-ARTIFACT-001',
      );
      expect(existsSync(join(paths.artifactsRoot, 'synthetic.jsonl'))).toBe(
        true,
      );

      const outsideDirectory = resolve(runRoot, '..', 'outside-artifact');
      mkdirSync(outsideDirectory, { recursive: true });
      const outsideFile = join(outsideDirectory, 'outside.txt');
      writeFileSync(outsideFile, 'outside', 'utf8');
      expect(() =>
        collectFailureArtifacts({
          appVersion: '0.0.0-e2e',
          buildRevision: 'development',
          files: [outsideFile],
          runRoot,
          scenarioId: 'SYS-ARTIFACT-001',
          targetRoot: paths.artifactsRoot,
        }),
      ).toThrow('escapes');

      writeFileSync(
        paths.runtimeConfigPath,
        '{"sessionSecret":"synthetic-secret"}\n',
        'utf8',
      );
      expect(() =>
        collectFailureArtifacts({
          appVersion: '0.0.0-e2e',
          buildRevision: 'development',
          files: [paths.runtimeConfigPath],
          runRoot,
          scenarioId: 'SYS-ARTIFACT-001',
          targetRoot: paths.artifactsRoot,
        }),
      ).toThrow('runtime config');
      rmSync(outsideDirectory, { force: true, recursive: true });
    } finally {
      rmSync(runRoot, { force: true, recursive: true });
    }
  });
});

test.describe('isolated web runtime boundaries', () => {
  test('WEB-CONFIG-001 validates Vite proxy configuration without exposing the session to the renderer', () => {
    const runRoot = createE2eRunRoot();
    try {
      const paths = createE2eWorkerPaths(runRoot, 'WEB-CONFIG-001');
      const sessionSecret = 'a'.repeat(43);
      const config = readE2eViteRuntimeConfig({
        EKY_E2E: '1',
        EKY_E2E_BACKEND_ORIGIN: 'http://127.0.0.1:34567',
        EKY_E2E_ENV_ROOT: paths.tempRoot,
        EKY_E2E_RUNTIME_SESSION: sessionSecret,
      });

      expect(config).not.toBeNull();
      if (config === null) {
        throw new Error('Expected an E2E Vite runtime configuration.');
      }
      const proxy = createE2eViteBackendProxy(config);
      expect(proxy['/customers']).toMatchObject({
        headers: {
          'x-eky-local-session': sessionSecret,
        },
        target: 'http://127.0.0.1:34567',
      });
      expect(() =>
        readE2eViteRuntimeConfig({
          EKY_E2E_BACKEND_ORIGIN: 'http://127.0.0.1:34567',
          EKY_E2E_ENV_ROOT: paths.tempRoot,
          EKY_E2E_RUNTIME_SESSION: sessionSecret,
        }),
      ).toThrow('marker');
      expect(() =>
        readE2eViteRuntimeConfig({
          EKY_E2E: '1',
          EKY_E2E_BACKEND_ORIGIN: 'https://example.invalid',
          EKY_E2E_ENV_ROOT: paths.tempRoot,
          EKY_E2E_RUNTIME_SESSION: sessionSecret,
        }),
      ).toThrow('loopback');
      expect(() =>
        readE2eViteRuntimeConfig({
          EKY_E2E: '1',
          EKY_E2E_BACKEND_ORIGIN: 'http://127.0.0.1:34567',
          EKY_E2E_ENV_ROOT: paths.tempRoot,
          EKY_E2E_RUNTIME_SESSION: 'invalid',
        }),
      ).toThrow('session');
    } finally {
      rmSync(runRoot, { force: true, recursive: true });
    }
  });

  test('WEB-NETWORK-001 allows only the isolated origins and non-network document protocols', () => {
    const allowedOrigins = new Set([
      'http://127.0.0.1:34567',
      'http://127.0.0.1:45678',
    ]);

    for (const allowedUrl of [
      'http://127.0.0.1:34567/customers',
      'http://127.0.0.1:45678/@vite/client',
      'ws://127.0.0.1:45678/?token=synthetic',
      'about:blank',
      'data:text/plain,synthetic',
      'blob:http://127.0.0.1:45678/synthetic-id',
    ]) {
      expect(isAllowedE2eBrowserUrl(allowedUrl, allowedOrigins)).toBe(true);
    }

    for (const blockedUrl of [
      'https://example.invalid/',
      'http://127.0.0.1:56789/',
      'wss://example.invalid/',
      'blob:https://example.invalid/synthetic-id',
      'file:///tmp/synthetic',
      'javascript:alert(1)',
      'about:config',
    ]) {
      expect(isAllowedE2eBrowserUrl(blockedUrl, allowedOrigins)).toBe(false);
    }
  });
});

async function waitForOutput(readOutput: () => string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (readOutput() !== '') {
      return;
    }
    await new Promise((resolveDelay) => {
      setTimeout(resolveDelay, 20);
    });
  }
  throw new Error('Managed process did not produce output.');
}
