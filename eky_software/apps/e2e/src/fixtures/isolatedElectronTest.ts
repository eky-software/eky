import {
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  _electron as electron,
  request as requestFactory,
  test as base,
  type APIRequestContext,
  type ElectronApplication,
  type Page,
  type TestInfo,
} from '@playwright/test';

import {
  createElectronE2eRuntime,
  resolveElectronE2eApplicationPath,
  type ElectronE2eRuntime,
} from '../environment/createElectronE2eRuntime.js';
import { assertElectronLaunchPrerequisites } from '../environment/assertElectronLaunchPrerequisites.js';
import { createElectronEnvironment } from '../environment/createElectronEnvironment.js';
import { listElectronE2eProfileDirectories } from '../environment/createElectronE2eProfile.js';
import { createE2eRunRoot } from '../environment/createE2eRunRoot.js';
import { createE2eWorkerPaths } from '../environment/createE2eWorkerPaths.js';
import type { E2eWorkerPaths } from '../environment/e2eEnvironmentTypes.js';
import { reserveLoopbackPort } from '../environment/reserveLoopbackPort.js';
import { removeE2eRunRoot } from '../environment/removeE2eRunRoot.js';
import { resolveElectronE2eExecutable } from '../environment/resolveElectronE2eExecutable.js';
import { waitForLoopbackPortRelease } from '../environment/waitForLoopbackPortRelease.js';
import {
  createElectronActiveWorkspaceReplacementFixture,
  createElectronWorkspaceBackupFixture,
  type ElectronWorkspaceBackupFixture,
} from '../workspaces/createElectronWorkspaceBackupFixture.js';
import { readE2eScenarioId } from './readE2eScenarioId.js';
import {
  closeOwnedElectronRuntime,
  stopOwnedElectronRuntime,
} from './stopOwnedElectronRuntime.js';
import {
  launchElectronRuntime,
  type ElectronLaunchObservation,
} from './launchElectronRuntime.js';
import { ELECTRON_E2E_PROCESS_CONNECT_TIMEOUT_MILLISECONDS } from './electronLaunchBudgets.js';

export interface IsolatedElectronHarness {
  api: APIRequestContext;
  electronApp: ElectronApplication;
  launchSecondInstance(): Promise<void>;
  page: Page;
  paths: E2eWorkerPaths;
  performRelaunchingOperation(
    operation: () => Promise<void>,
  ): Promise<{
    previousRuntimeInstanceId: string;
    previousSessionSecret: string;
  }>;
  restart(): Promise<{
    previousRuntimeInstanceId: string;
    previousSessionSecret: string;
  }>;
  runRoot: string;
  runtime: ElectronE2eRuntime;
  workspaceBackupFixture?: Readonly<ElectronWorkspaceBackupFixture>;
}

interface IsolatedElectronFixtures {
  e2eElectron: IsolatedElectronHarness;
}

interface IsolatedElectronOptions {
  e2eDialogMode: 'accept' | 'cancel';
  e2eNativeOpenDialogMode: 'accept' | 'cancel';
  e2eNativeOpenDialogPurpose:
    | 'invoicePdfArchive'
    | 'workspaceBackupImport'
    | 'workspaceBackupReplacement';
  e2eWorkspaceBackupFixture: 'activeReplacement' | 'none' | 'synthetic';
}

type ElectronChildProcess = ReturnType<typeof spawn> & {
  on(event: 'error', listener: (error: Error) => void): ElectronChildProcess;
  on(
    event: 'exit',
    listener: (code: number | null) => void,
  ): ElectronChildProcess;
};

const MAX_ELECTRON_LAUNCH_OBSERVATIONS = 64;

export const test = base.extend<
  IsolatedElectronFixtures & IsolatedElectronOptions
>({
  e2eDialogMode: ['accept', { option: true }],
  e2eNativeOpenDialogMode: ['accept', { option: true }],
  e2eNativeOpenDialogPurpose: ['invoicePdfArchive', { option: true }],
  e2eWorkspaceBackupFixture: ['none', { option: true }],
  e2eElectron: async (
    {
      e2eDialogMode,
      e2eNativeOpenDialogMode,
      e2eNativeOpenDialogPurpose,
      e2eWorkspaceBackupFixture,
    },
    use,
    testInfo,
  ) => {
    const scenarioId = readE2eScenarioId(testInfo.title);
    const runRoot = createE2eRunRoot();
    const paths = createE2eWorkerPaths(runRoot, scenarioId);
    if (
      e2eWorkspaceBackupFixture === 'synthetic' &&
      e2eNativeOpenDialogPurpose !== 'workspaceBackupImport' &&
      e2eNativeOpenDialogPurpose !== 'workspaceBackupReplacement'
    ) {
      throw new Error(
        'Synthetic workspace backup requires a workspace backup dialog purpose.',
      );
    }
    if (
      e2eWorkspaceBackupFixture === 'activeReplacement' &&
      e2eNativeOpenDialogPurpose !== 'workspaceBackupReplacement'
    ) {
      throw new Error(
        'Active workspace backup requires the replacement dialog purpose.',
      );
    }
    const workspaceBackupFixture =
      e2eWorkspaceBackupFixture === 'synthetic'
        ? await createElectronWorkspaceBackupFixture({
            backupPath: join(
              paths.artifactsRoot,
              'workspace-import-source.ekybackup',
            ),
            runRoot,
          })
        : e2eWorkspaceBackupFixture === 'activeReplacement'
          ? await createElectronActiveWorkspaceReplacementFixture({
              backupPath: join(
                paths.artifactsRoot,
                'active-workspace-replacement.ekybackup',
              ),
              paths,
              runRoot,
              scenarioId,
            })
          : undefined;
    let backendPort = await reserveLoopbackPort();
    let runtime = createElectronE2eRuntime({
      backendPort,
      dialogMode: e2eDialogMode,
      nativeOpenDialogMode: e2eNativeOpenDialogMode,
      nativeOpenDialogPurpose: e2eNativeOpenDialogPurpose,
      paths,
      scenarioId,
      ...(workspaceBackupFixture === undefined
        ? {}
        : { workspaceBackupPath: workspaceBackupFixture.backupPath }),
    });
    if (
      e2eWorkspaceBackupFixture === 'activeReplacement' &&
      workspaceBackupFixture !== undefined
    ) {
      seedLegacyWorkspaceForActiveReplacement({
        fixture: workspaceBackupFixture,
        sourceDocumentsRoot: paths.documentsRoot,
        userDataPath: runtime.userDataPath,
      });
    }
    let api: APIRequestContext | undefined;
    let electronApp: ElectronApplication | undefined;
    let electronProcess: ReturnType<ElectronApplication['process']> | undefined;
    let connectionPending = false;
    let runtimeCleanupUnverified = false;
    let portReleaseUnverified = false;
    let failure: { error: unknown } | undefined;
    const launchObservations: ElectronLaunchObservation[] = [];
    let observationsTruncated = false;

    async function launchCurrentRuntime() {
      assertElectronRuntimeLaunchPrerequisites(runtime, runRoot);
      connectionPending = true;
      electronApp = undefined;
      electronProcess = undefined;
      return launchElectronRuntime({
        launch: () =>
          electron.launch({
            args: [resolveElectronE2eApplicationPath()],
            cwd: runRoot,
            env: createElectronEnvironment({
              configPath: runtime.configPath,
              profile: runtime.profile,
              runRoot: runtime.runtimeRoot,
            }),
            executablePath: resolveElectronE2eExecutable(),
            timeout: ELECTRON_E2E_PROCESS_CONNECT_TIMEOUT_MILLISECONDS,
          }),
        connected(application, child) {
          electronApp = application;
          electronProcess = child;
          connectionPending = false;
          child.stdout?.resume();
          child.stderr?.resume();
        },
        observe(observation) {
          if (launchObservations.length < MAX_ELECTRON_LAUNCH_OBSERVATIONS) {
            launchObservations.push(observation);
          } else {
            observationsTruncated = true;
          }
        },
      });
    }

    async function closeCurrentRuntime(alreadyClosed = false): Promise<void> {
      try {
        if (electronApp !== undefined) {
          if (electronProcess === undefined) {
            throw new Error('E2E_ELECTRON_RUNTIME_CLEANUP_UNVERIFIED');
          }
          const closeRuntime = alreadyClosed
            ? stopOwnedElectronRuntime
            : closeOwnedElectronRuntime;
          await closeRuntime(electronApp, electronProcess);
          electronApp = undefined;
          electronProcess = undefined;
        }
        if (connectionPending || runtimeCleanupUnverified) {
          throw new Error('E2E_ELECTRON_RUNTIME_CLEANUP_UNVERIFIED');
        }
      } catch {
        runtimeCleanupUnverified = true;
        throw new Error('E2E_ELECTRON_RUNTIME_CLEANUP_UNVERIFIED');
      }
    }

    async function releaseCurrentPort(): Promise<void> {
      try {
        await waitForLoopbackPortRelease(backendPort);
        if (portReleaseUnverified) {
          throw new Error('E2E_ELECTRON_PORT_RELEASE_UNVERIFIED');
        }
      } catch {
        portReleaseUnverified = true;
        throw new Error('E2E_ELECTRON_PORT_RELEASE_UNVERIFIED');
      }
    }

    try {
      const launched = await launchCurrentRuntime();
      api = await createElectronApi(backendPort, runtime.sessionSecret);

      async function launchNextRuntime(): Promise<void> {
        backendPort = await reserveLoopbackPort();
        runtime = createElectronE2eRuntime({
          backendPort,
          dialogMode: e2eDialogMode,
          nativeOpenDialogMode: e2eNativeOpenDialogMode,
          nativeOpenDialogPurpose: e2eNativeOpenDialogPurpose,
          paths,
          scenarioId,
          ...(workspaceBackupFixture === undefined
            ? {}
            : { workspaceBackupPath: workspaceBackupFixture.backupPath }),
        });
        const restarted = await launchCurrentRuntime();
        api = await createElectronApi(backendPort, runtime.sessionSecret);
        harness.api = api;
        harness.electronApp = restarted.electronApp;
        harness.page = restarted.page;
        harness.runtime = runtime;
      }

      const harness: IsolatedElectronHarness = {
        api,
        electronApp: launched.electronApp,
        launchSecondInstance: () =>
          launchSecondElectronInstance(runtime, runRoot),
        page: launched.page,
        paths,
        async performRelaunchingOperation(operation) {
          const previousRuntimeInstanceId = runtime.runtimeInstanceId;
          const previousSessionSecret = runtime.sessionSecret;
          const previousRelaunchCount = countWorkspaceRelaunchRequests(
            runtime.observationsPath,
          );
          const previousApplication = harness.electronApp;
          const previousPage = harness.page;
          const closeWaiter = createElectronApplicationCloseWaiter(
            previousApplication,
          );

          try {
            await operation();
          } catch (error) {
            if (!previousPage.isClosed()) {
              closeWaiter.cancel();
              throw error;
            }
          }
          const closeResult = await closeWaiter.promise;
          if (closeResult === 'timedOut') {
            throw new Error('Electron workspace relaunch did not close.');
          }
          await harness.api.dispose();
          await closeCurrentRuntime(true);
          await releaseCurrentPort();
          if (
            countWorkspaceRelaunchRequests(runtime.observationsPath) !==
            previousRelaunchCount + 1
          ) {
            throw new Error(
              'Workspace operation did not request exactly one relaunch.',
            );
          }

          await launchNextRuntime();
          return { previousRuntimeInstanceId, previousSessionSecret };
        },
        async restart() {
          const previousRuntimeInstanceId = runtime.runtimeInstanceId;
          const previousSessionSecret = runtime.sessionSecret;

          await harness.api.dispose();
          await closeCurrentRuntime();
          await releaseCurrentPort();
          await launchNextRuntime();

          return { previousRuntimeInstanceId, previousSessionSecret };
        },
        runRoot,
        runtime,
        ...(workspaceBackupFixture === undefined
          ? {}
          : { workspaceBackupFixture }),
      };

      await use(harness);
    } catch (error) {
      failure = { error };
    } finally {
      await finishIsolatedElectronTest({
        failure,
        testAlreadyFailed: testInfo.errors.length > 0,
        disposeApi: async () => {
          await api?.dispose();
        },
        closeRuntime: closeCurrentRuntime,
        releasePort: releaseCurrentPort,
        removeRoot: () => removeE2eRunRoot(runRoot),
        async report(cleanup) {
          if (
            failure !== undefined ||
            testInfo.errors.length > 0 ||
            cleanup.runRoot !== 'removed'
          ) {
            await reportElectronLifecycleEvidence(testInfo, {
              launch: launchObservations,
              observationsTruncated,
              cleanup,
            });
          }
        },
      });
    }
  },
});

function seedLegacyWorkspaceForActiveReplacement(input: {
  readonly fixture: Readonly<ElectronWorkspaceBackupFixture>;
  readonly sourceDocumentsRoot: string;
  readonly userDataPath: string;
}): void {
  const legacyRuntimeRoot = join(input.userDataPath, 'runtime');
  if (existsSync(legacyRuntimeRoot)) {
    throw new Error('Electron E2E legacy workspace source already exists.');
  }
  const dataRoot = join(legacyRuntimeRoot, 'data');
  const storageRoot = join(legacyRuntimeRoot, 'storage');
  const documentsRoot = join(storageRoot, 'invoices');
  mkdirSync(dataRoot, { mode: 0o700, recursive: true });
  mkdirSync(storageRoot, { mode: 0o700, recursive: true });
  copyFileSync(
    input.fixture.sourceDatabaseFilePath,
    join(dataRoot, 'eky.sqlite'),
  );
  cpSync(input.sourceDocumentsRoot, documentsRoot, { recursive: true });
}

interface ElectronCleanupResult {
  api: 'completed' | 'failed';
  runtime: 'completed' | 'unverified';
  port: 'released' | 'unverified';
  runRoot: 'removed' | 'retained' | 'removalFailed';
}

export async function reportElectronLifecycleEvidence(
  testInfo: TestInfo,
  evidence: {
    launch: readonly ElectronLaunchObservation[];
    observationsTruncated: boolean;
    cleanup: Readonly<ElectronCleanupResult>;
  },
): Promise<void> {
  const path = testInfo.outputPath('electron-lifecycle.json');
  await writeFile(
    path,
    JSON.stringify({
      schemaVersion: 1,
      attempt: testInfo.retry,
      launch: evidence.launch,
      observationsTruncated: evidence.observationsTruncated,
      cleanup: evidence.cleanup,
    }),
    { encoding: 'utf8', flag: 'wx', mode: 0o600 },
  );
  await testInfo.attach('electron-lifecycle', {
    contentType: 'application/json',
    path,
  });
}

export async function finishIsolatedElectronTest(input: {
  failure: { error: unknown } | undefined;
  testAlreadyFailed: boolean;
  disposeApi(): Promise<void>;
  closeRuntime(): Promise<void>;
  releasePort(): Promise<void>;
  removeRoot(): Promise<void>;
  report(result: Readonly<ElectronCleanupResult>): Promise<void>;
}): Promise<void> {
  const result: ElectronCleanupResult = {
    api: 'completed',
    runtime: 'completed',
    port: 'released',
    runRoot: 'retained',
  };
  try {
    await input.disposeApi();
  } catch {
    result.api = 'failed';
  }
  try {
    await input.closeRuntime();
  } catch {
    result.runtime = 'unverified';
  }
  try {
    await input.releasePort();
  } catch {
    result.port = 'unverified';
  }
  if (
    result.api === 'completed' &&
    result.runtime === 'completed' &&
    result.port === 'released'
  ) {
    try {
      await input.removeRoot();
      result.runRoot = 'removed';
    } catch {
      result.runRoot = 'removalFailed';
    }
  }
  let reportFailed = false;
  try {
    await input.report(Object.freeze(result));
  } catch {
    reportFailed = true;
  }
  // Playwright records body failures before fixture teardown. Never replace
  // that failure, or a setup exception, with a secondary cleanup exception.
  if (input.failure !== undefined) throw input.failure.error;
  if (!input.testAlreadyFailed && result.runRoot !== 'removed') {
    throw new Error(
      `E2E_ELECTRON_CLEANUP_FAILED runtime=${result.runtime} port=${result.port} root=${result.runRoot}`,
    );
  }
  if (!input.testAlreadyFailed && reportFailed) {
    throw new Error('E2E_ELECTRON_EVIDENCE_FAILED');
  }
}

function createElectronApi(
  backendPort: number,
  sessionSecret: string,
): Promise<APIRequestContext> {
  return requestFactory.newContext({
    baseURL: `http://127.0.0.1:${String(backendPort)}`,
    extraHTTPHeaders: {
      Accept: 'application/json',
      'x-eky-local-session': sessionSecret,
    },
  });
}

function createElectronApplicationCloseWaiter(
  electronApp: ElectronApplication,
): {
  cancel(): void;
  promise: Promise<'cancelled' | 'closed' | 'timedOut'>;
} {
  let settled = false;
  let closeListener: (() => void) | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let resolveWaiter:
    | ((result: 'cancelled' | 'closed' | 'timedOut') => void)
    | undefined;
  const promise = new Promise<'cancelled' | 'closed' | 'timedOut'>((resolve) => {
    resolveWaiter = resolve;
    timeout = setTimeout(() => {
      settled = true;
      resolve('timedOut');
    }, 30_000);
    closeListener = () => {
      settled = true;
      clearTimeout(timeout);
      resolve('closed');
    };
    electronApp.once('close', closeListener);
  });
  return {
    cancel() {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (closeListener !== undefined) {
        electronApp.off('close', closeListener);
      }
      resolveWaiter?.('cancelled');
    },
    promise,
  };
}

function countWorkspaceRelaunchRequests(observationsPath: string): number {
  if (!existsSync(observationsPath)) return 0;
  let count = 0;
  for (const line of readFileSync(observationsPath, 'utf8').split(/\r?\n/u)) {
    if (line === '') continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        !Array.isArray(parsed) &&
        (parsed as Record<string, unknown>).operation ===
          'workspaceRelaunchRequested'
      ) {
        count += 1;
      }
    } catch {
      throw new Error('Electron E2E observations are invalid.');
    }
  }
  return count;
}

function launchSecondElectronInstance(
  runtime: ElectronE2eRuntime,
  runRoot: string,
): Promise<void> {
  assertElectronRuntimeLaunchPrerequisites(runtime, runRoot);
  return new Promise((resolveLaunch, rejectLaunch) => {
    const child = spawn(
      resolveElectronE2eExecutable(),
      [resolveElectronE2eApplicationPath()],
      {
        cwd: runRoot,
        env: createElectronEnvironment({
          configPath: runtime.configPath,
          profile: runtime.profile,
          runRoot: runtime.runtimeRoot,
        }),
        shell: false,
        stdio: 'ignore',
        windowsHide: true,
      },
    ) as ElectronChildProcess;
    const timer = setTimeout(() => {
      child.kill();
      rejectLaunch(new Error('Second Electron instance did not exit.'));
    }, 15_000);

    child.on('error', (error: Error) => {
      clearTimeout(timer);
      rejectLaunch(error);
    });
    child.on('exit', (code: number | null) => {
      clearTimeout(timer);
      if (code === 0) {
        resolveLaunch();
        return;
      }
      rejectLaunch(
        new Error(
          `Second Electron instance exited with code ${String(code)}.`,
        ),
      );
    });
  });
}

function assertElectronRuntimeLaunchPrerequisites(
  runtime: ElectronE2eRuntime,
  runRoot: string,
): void {
  assertElectronLaunchPrerequisites({
    applicationPath: resolveElectronE2eApplicationPath(),
    configPath: runtime.configPath,
    cwd: runRoot,
    executablePath: resolveElectronE2eExecutable(),
    profileDirectories: listElectronE2eProfileDirectories(runtime.profile),
    runRoot,
  });
}

export { expect } from '@playwright/test';
