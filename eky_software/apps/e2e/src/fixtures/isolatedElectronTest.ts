import {
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

import {
  _electron as electron,
  request as requestFactory,
  test as base,
  type APIRequestContext,
  type ElectronApplication,
  type Page,
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
    let electronStderr = '';
    let electronStdout = '';

    try {
      const launched = await launchElectronRuntime({
        appendStderr(chunk) {
          electronStderr = appendBoundedOutput(electronStderr, chunk);
        },
        appendStdout(chunk) {
          electronStdout = appendBoundedOutput(electronStdout, chunk);
        },
        runRoot,
        runtime,
      });
      electronApp = launched.electronApp;
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
        electronStderr = '';
        electronStdout = '';
        const restarted = await launchElectronRuntime({
          appendStderr(chunk) {
            electronStderr = appendBoundedOutput(electronStderr, chunk);
          },
          appendStdout(chunk) {
            electronStdout = appendBoundedOutput(electronStdout, chunk);
          },
          runRoot,
          runtime,
        });
        electronApp = restarted.electronApp;
        api = await createElectronApi(backendPort, runtime.sessionSecret);
        harness.api = api;
        harness.electronApp = restarted.electronApp;
        harness.page = restarted.page;
        harness.runtime = runtime;
      }

      const harness: IsolatedElectronHarness = {
        api,
        electronApp,
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
          await waitForLoopbackPortRelease(backendPort);
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
          await harness.electronApp.close().catch(() => undefined);
          await waitForLoopbackPortRelease(backendPort);
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
    } finally {
      await api?.dispose();
      const electronProcess = electronApp?.process();
      let runtimeCleanupFailed = false;
      try {
        if (electronApp !== undefined && electronProcess !== undefined) {
          await closeOwnedElectronRuntime(electronApp, electronProcess);
        } else {
          await electronApp?.close().catch(() => undefined);
        }
      } catch {
        runtimeCleanupFailed = true;
      }
      try {
        await waitForLoopbackPortRelease(backendPort);
      } finally {
        await removeE2eRunRoot(runRoot);
      }
      if (runtimeCleanupFailed) {
        throw new Error('Electron E2E runtime cleanup failed.');
      }
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

async function launchElectronRuntime(input: {
  appendStderr(chunk: Buffer): void;
  appendStdout(chunk: Buffer): void;
  runRoot: string;
  runtime: ElectronE2eRuntime;
}): Promise<{ electronApp: ElectronApplication; page: Page }> {
  assertElectronRuntimeLaunchPrerequisites(input.runtime, input.runRoot);
  let electronApp: ElectronApplication;
  try {
    electronApp = await electron.launch({
      args: [resolveElectronE2eApplicationPath()],
      cwd: input.runRoot,
      env: createElectronEnvironment({
        configPath: input.runtime.configPath,
        profile: input.runtime.profile,
        runRoot: input.runtime.runtimeRoot,
      }),
      executablePath: resolveElectronE2eExecutable(),
      timeout: 45_000,
    });
  } catch {
    throw createSafeElectronLaunchError(
      input.runtime.userDataPath,
      input.runtime.observationsPath,
    );
  }
  const electronProcess = electronApp.process();
  electronProcess.stderr?.on('data', input.appendStderr);
  electronProcess.stdout?.on('data', input.appendStdout);

  try {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    return { electronApp, page };
  } catch {
    const safeDiagnostics = readSafeElectronDiagnostics(
      input.runtime.userDataPath,
      input.runtime.observationsPath,
    );
    await stopOwnedElectronRuntime(electronApp, electronProcess);
    throw new Error(
      safeDiagnostics === ''
        ? 'Electron E2E window was not created.'
        : `Electron E2E window was not created.\n${safeDiagnostics}`,
    );
  }
}

function createSafeElectronLaunchError(
  userDataPath: string,
  observationsPath: string,
): Error {
  const safeDiagnostics = readSafeElectronDiagnostics(
    userDataPath,
    observationsPath,
  );
  return new Error(
    safeDiagnostics === ''
      ? 'Electron E2E process exited before connecting.'
      : `Electron E2E process exited before connecting.\n${safeDiagnostics}`,
  );
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

function appendBoundedOutput(current: string, chunk: Buffer): string {
  return `${current}${chunk.toString('utf8')}`.slice(-64 * 1024);
}

function readSafeElectronDiagnostics(
  userDataPath: string,
  observationsPath: string,
): string {
  const summaries: string[] = [];
  const logsRoot = join(userDataPath, 'runtime', 'logs');

  for (const directoryName of ['desktop-warning-error', 'desktop-info']) {
    const directoryPath = join(logsRoot, directoryName);
    if (!existsSync(directoryPath)) {
      continue;
    }
    for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
        continue;
      }
      appendSafeJsonLineSummaries(
        summaries,
        readFileSync(join(directoryPath, entry.name), 'utf8'),
        ['eventName', 'errorCode', 'stage'],
      );
    }
  }

  if (existsSync(observationsPath)) {
    appendSafeJsonLineSummaries(
      summaries,
      readFileSync(observationsPath, 'utf8'),
      ['operation', 'reason', 'errorCode'],
    );
  }

  return summaries.length === 0
    ? ''
    : `Safe Electron diagnostics:\n${summaries.slice(-20).join('\n')}`;
}

function appendSafeJsonLineSummaries(
  destination: string[],
  content: string,
  allowedFields: readonly string[],
): void {
  for (const line of content.split(/\r?\n/u).filter(Boolean)) {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        continue;
      }
      const record = parsed as Record<string, unknown>;
      const summary = allowedFields
        .flatMap((field) =>
          typeof record[field] === 'string'
            ? [`${field}=${record[field]}`]
            : [],
        )
        .join(' ');
      if (summary !== '') {
        destination.push(summary);
      }
    } catch {
      // Invalid test diagnostics are omitted instead of exposing raw content.
    }
  }
}

export { expect } from '@playwright/test';
