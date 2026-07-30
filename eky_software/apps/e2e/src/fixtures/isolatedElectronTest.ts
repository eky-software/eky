import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
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
  resolveElectronExecutablePath,
  type ElectronE2eRuntime,
} from '../environment/createElectronE2eRuntime.js';
import { assertElectronLaunchPrerequisites } from '../environment/assertElectronLaunchPrerequisites.js';
import { createE2eRunRoot } from '../environment/createE2eRunRoot.js';
import { createE2eWorkerPaths } from '../environment/createE2eWorkerPaths.js';
import type { E2eWorkerPaths } from '../environment/e2eEnvironmentTypes.js';
import { reserveLoopbackPort } from '../environment/reserveLoopbackPort.js';
import { waitForLoopbackPortRelease } from '../environment/waitForLoopbackPortRelease.js';
import { readE2eScenarioId } from './readE2eScenarioId.js';

export interface IsolatedElectronHarness {
  api: APIRequestContext;
  electronApp: ElectronApplication;
  launchSecondInstance(): Promise<void>;
  page: Page;
  paths: E2eWorkerPaths;
  restart(): Promise<{
    previousRuntimeInstanceId: string;
    previousSessionSecret: string;
  }>;
  runRoot: string;
  runtime: ElectronE2eRuntime;
}

interface IsolatedElectronFixtures {
  e2eElectron: IsolatedElectronHarness;
}

interface IsolatedElectronOptions {
  e2eDialogMode: 'accept' | 'cancel';
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
  e2eElectron: async ({ e2eDialogMode }, use, testInfo) => {
    const scenarioId = readE2eScenarioId(testInfo.title);
    const runRoot = createE2eRunRoot();
    const paths = createE2eWorkerPaths(runRoot, scenarioId);
    let backendPort = await reserveLoopbackPort();
    let runtime = createElectronE2eRuntime({
      backendPort,
      dialogMode: e2eDialogMode,
      paths,
      scenarioId,
    });
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

      const harness: IsolatedElectronHarness = {
        api,
        electronApp,
        launchSecondInstance: () =>
          launchSecondElectronInstance(runtime, runRoot),
        page: launched.page,
        paths,
        async restart() {
          const previousRuntimeInstanceId = runtime.runtimeInstanceId;
          const previousSessionSecret = runtime.sessionSecret;

          await harness.api.dispose();
          await harness.electronApp.close().catch(() => undefined);
          await waitForLoopbackPortRelease(backendPort);

          backendPort = await reserveLoopbackPort();
          runtime = createElectronE2eRuntime({
            backendPort,
            dialogMode: e2eDialogMode,
            paths,
            scenarioId,
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

          return { previousRuntimeInstanceId, previousSessionSecret };
        },
        runRoot,
        runtime,
      };

      await use(harness);
    } finally {
      await api?.dispose();
      await electronApp?.close().catch(() => undefined);
      try {
        await waitForLoopbackPortRelease(backendPort);
      } finally {
        rmSync(runRoot, { force: true, recursive: true });
      }
    }
  },
});

async function launchElectronRuntime(input: {
  appendStderr(chunk: Buffer): void;
  appendStdout(chunk: Buffer): void;
  runRoot: string;
  runtime: ElectronE2eRuntime;
}): Promise<{ electronApp: ElectronApplication; page: Page }> {
  assertElectronRuntimeLaunchPrerequisites(input.runtime, input.runRoot);
  const electronApp = await electron.launch({
    args: [resolveElectronE2eApplicationPath()],
    cwd: input.runRoot,
    env: createElectronEnvironment(input.runtime.configPath),
    executablePath: resolveElectronExecutablePath(),
    timeout: 45_000,
  });
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
    await electronApp.close().catch(() => undefined);
    throw new Error(
      safeDiagnostics === ''
        ? 'Electron E2E window was not created.'
        : `Electron E2E window was not created.\n${safeDiagnostics}`,
    );
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

function launchSecondElectronInstance(
  runtime: ElectronE2eRuntime,
  runRoot: string,
): Promise<void> {
  assertElectronRuntimeLaunchPrerequisites(runtime, runRoot);
  return new Promise((resolveLaunch, rejectLaunch) => {
    const child = spawn(
      resolveElectronExecutablePath(),
      [resolveElectronE2eApplicationPath()],
      {
        cwd: runRoot,
        env: createElectronEnvironment(runtime.configPath),
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
    executablePath: resolveElectronExecutablePath(),
    profileDirectories: [runtime.userDataPath],
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
      ['operation'],
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

function createElectronEnvironment(
  configPath: string,
): Record<string, string> {
  const environment: Record<string, string> = {
    EKY_E2E: '1',
    EKY_ELECTRON_E2E_CONFIG: configPath,
    NODE_ENV: 'test',
  };
  for (const key of ['PATH', 'SystemRoot', 'TEMP', 'TMP', 'WINDIR']) {
    const entry = Object.entries(process.env).find(
      ([sourceKey, value]) =>
        sourceKey.toLowerCase() === key.toLowerCase() && value !== undefined,
    );
    if (entry?.[1] !== undefined) {
      environment[key] = entry[1];
    }
  }
  return environment;
}

export { expect } from '@playwright/test';
