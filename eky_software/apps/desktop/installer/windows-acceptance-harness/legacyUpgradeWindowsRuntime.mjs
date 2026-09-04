import { spawn } from 'node:child_process';
import { lstat, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { inspectPackageArtifactInventory } from '../../scripts/package-artifact-inventory.mjs';
import { validateInstallerProductStateResult } from './cleanInstallUninstallWindowsRuntime.mjs';
import {
  LEGACY_FIRST_START_EVIDENCE_FILENAME,
  LEGACY_SECOND_START_EVIDENCE_FILENAME,
  LEGACY_SOURCE_EVIDENCE_FILENAME,
  captureLegacySourceEvidence,
  captureLegacyTargetEvidence,
  deriveLegacySourceUserDataRoot,
  writeLegacySourceEvidence,
  writeLegacyTargetEvidence,
} from './legacyUpgradeProfileEvidence.mjs';
import { runHistoricalPackagedSmokeProcessChain } from './legacyUpgradeSourceSmoke.mjs';
import {
  captureDesktopLifecycleBaseline,
  requireTargetShutdownCompleted,
  waitForTargetDesktopStarted,
} from './legacyUpgradeStartupObserver.mjs';
import { parseStrictJsonObjectBytes } from './strictJsonObject.mjs';
import { verifyLegacyUpgradeArtifact } from './legacyUpgradeArtifact.mjs';

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const INSPECTOR_PATH = resolve(DIRECTORY, 'inspectWindowsInstallerProductState.ps1');
const CLOSE_REQUEST_PATH = resolve(DIRECTORY, 'requestWindowsApplicationClose.ps1');

function bracedProductCode(productCode) {
  return `{${productCode}}`;
}

async function startOwnedProcess(command, arguments_, options = {}) {
  const child = spawn(command, arguments_, {
    cwd: options.cwd,
    env: options.env,
    stdio: options.stdio ?? 'ignore',
    windowsHide: true,
  });
  let processId = null;
  const started = new Promise((resolvePromise, rejectPromise) => {
    child.once('spawn', () => {
      if (!Number.isInteger(child.pid)) {
        rejectPromise(new Error('ownedProcessStartFailed'));
        return;
      }
      processId = child.pid;
      resolvePromise();
    });
    child.once('error', () =>
      rejectPromise(new Error('ownedProcessStartFailed')),
    );
  });
  const completion = new Promise((resolvePromise, rejectPromise) => {
    child.once('error', () =>
      rejectPromise(new Error('ownedProcessStartFailed')),
    );
    child.once('close', (exitCode, signal) => {
      if (
        signal !== null ||
        !Number.isInteger(exitCode) ||
        !Number.isInteger(processId)
      ) {
        rejectPromise(new Error('ownedProcessExitInvalid'));
        return;
      }
      resolvePromise(Object.freeze({ exitCode, processId }));
    });
  });
  completion.catch(() => undefined);
  try {
    await started;
  } catch (error) {
    await completion.catch(() => undefined);
    throw error;
  }
  return Object.freeze({ child, completion, processId });
}

async function runOwnedProcess(command, arguments_, options = {}) {
  return (await startOwnedProcess(command, arguments_, options)).completion;
}

async function pathKind(path) {
  try {
    const metadata = await lstat(path, { bigint: true });
    if (metadata.isSymbolicLink()) return 'invalid';
    if (metadata.isDirectory()) return 'directory';
    if (metadata.isFile() && metadata.nlink === 1n) return 'file';
    return 'invalid';
  } catch (error) {
    if (error?.code === 'ENOENT') return 'absent';
    throw new Error('installerStateInspectionFailed');
  }
}

function withoutElectronNodeMode(overrides) {
  const environment = { ...process.env, ...overrides };
  delete environment.ELECTRON_RUN_AS_NODE;
  return environment;
}

function inventoriesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function createLegacyUpgradeWindowsRuntime(request, artifact) {
  const appData = process.env.APPDATA;
  const localAppData = process.env.LOCALAPPDATA;
  const systemRoot = process.env.SystemRoot;
  if (!appData || !localAppData || !systemRoot) {
    throw new Error('installerEnvironmentInvalid');
  }
  const powershell = resolve(
    systemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const msiexec = resolve(systemRoot, 'System32', 'msiexec.exe');
  const scenarioRoot = dirname(request.fixtureRoot);
  const installRoot = resolve(localAppData, 'Programs', 'Eky');
  const executablePath = resolve(installRoot, 'Eky.exe');
  const shortcutPath = resolve(
    appData,
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Eky',
    'Eky.lnk',
  );
  const logRoot = resolve(scenarioRoot, 'msi-logs');
  const evidenceRoot = resolve(scenarioRoot, 'private-evidence');
  const isolatedAppDataRoot = resolve(scenarioRoot, 'isolated-app-data');
  const sourceSmokeTempRoot = resolve(scenarioRoot, 'source-smoke-temp');
  const userDataRoot = deriveLegacySourceUserDataRoot(
    scenarioRoot,
    request.runNonce,
  );
  const smokeResultPath = resolve(
    sourceSmokeTempRoot,
    'eky-desktop-smoke',
    request.runNonce.slice(0, 32),
    'result',
    'desktop-smoke-result.json',
  );
  await mkdir(logRoot, { recursive: false });
  await mkdir(evidenceRoot, { recursive: false });
  await mkdir(isolatedAppDataRoot, { recursive: false });
  await mkdir(sourceSmokeTempRoot, { recursive: false });

  const identities = Object.freeze({
    source: Object.freeze({
      appVersion: artifact.source.appVersion,
      buildRevision: artifact.source.runtimeBuildRevision,
    }),
    target: Object.freeze({
      appVersion: artifact.target.appVersion,
      buildRevision: artifact.target.buildRevision,
    }),
  });
  let inspectionSequence = 0;
  let sourceEvidence = null;
  let firstTargetEvidence = null;

  async function inspectExactProduct(roleName) {
    const resultPath = resolve(
      scenarioRoot,
      `legacy-product-state-${inspectionSequence}-${roleName}.json`,
    );
    inspectionSequence += 1;
    try {
      const processResult = await runOwnedProcess(
        powershell,
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          INSPECTOR_PATH,
          '-ProductCode',
          bracedProductCode(artifact[roleName].productCode),
          '-ResultPath',
          resultPath,
        ],
        { cwd: scenarioRoot },
      );
      if (processResult.exitCode !== 0) {
        throw new Error('installerStateInspectionFailed');
      }
      const metadata = await lstat(resultPath, { bigint: true });
      if (
        !metadata.isFile() ||
        metadata.isSymbolicLink() ||
        metadata.nlink !== 1n ||
        metadata.size < 2n ||
        metadata.size > 64n * 1024n
      ) {
        throw new Error('installerStateInspectionFailed');
      }
      return validateInstallerProductStateResult(
        parseStrictJsonObjectBytes(await readFile(resultPath), {
          errorCode: 'installerStateInspectionFailed',
        }),
      );
    } catch {
      throw new Error('installerStateInspectionFailed');
    } finally {
      await rm(resultPath, { force: true }).catch(() => undefined);
    }
  }

  async function inspectState() {
    const source = await inspectExactProduct('source');
    const target = await inspectExactProduct('target');
    const installRootKind = await pathKind(installRoot);
    const executableKind = await pathKind(executablePath);
    const shortcutKind = await pathKind(shortcutPath);
    if (
      !['absent', 'directory'].includes(installRootKind) ||
      !['absent', 'file'].includes(executableKind) ||
      !['absent', 'file'].includes(shortcutKind) ||
      source.ownedRegistryExists !== target.ownedRegistryExists ||
      source.ekyProcessCount !== target.ekyProcessCount
    ) {
      throw new Error('installerStateInspectionFailed');
    }
    return Object.freeze({
      source,
      target,
      installRootExists: installRootKind === 'directory',
      executableExists: executableKind === 'file',
      shortcutExists: shortcutKind === 'file',
      installerRegistryExists: source.ownedRegistryExists,
      ekyProcessCount: source.ekyProcessCount,
    });
  }

  async function runMsiOperation(operation) {
    const roleName =
      operation === 'sourceInstall'
        ? 'source'
        : operation === 'majorUpgrade'
          ? 'target'
          : null;
    if (roleName === null) throw new Error('unexpectedFailure');
    try {
      return (
        await runOwnedProcess(
          msiexec,
          [
            '/i',
            artifact[roleName].installerPath,
            '/qn',
            '/norestart',
            '/l*v',
            resolve(logRoot, `${operation}.log`),
          ],
          { cwd: scenarioRoot },
        )
      ).exitCode;
    } catch {
      return -1;
    }
  }

  async function verifyArtifact() {
    try {
      await verifyLegacyUpgradeArtifact({
        artifactRoot: request.fixtureRoot,
        expectedBuildRevision: artifact.buildRevision,
        expectedDescriptorSha256: request.artifactDescriptorSha256,
      });
    } catch {
      throw new Error('artifactVerificationFailed');
    }
  }

  async function validateTargetPayload() {
    const actual = await inspectPackageArtifactInventory({
      root: installRoot,
      stage: 'packagedApp',
    }).catch(() => {
      throw new Error('majorUpgradeStateInvalid');
    });
    if (!inventoriesEqual(actual, artifact.target.payloadInventory)) {
      throw new Error('majorUpgradeStateInvalid');
    }
  }

  async function runSourcePackagedSmoke() {
    const environment = withoutElectronNodeMode({
      APPDATA: isolatedAppDataRoot,
      ELECTRON_ENABLE_SECURITY_WARNINGS: 'true',
      EKY_DESKTOP_SMOKE_TOKEN: request.runNonce.slice(0, 32),
      TEMP: sourceSmokeTempRoot,
      TMP: sourceSmokeTempRoot,
    });
    await runHistoricalPackagedSmokeProcessChain({
      resultPath: smokeResultPath,
      startGeneration(phase) {
        return startOwnedProcess(
          executablePath,
          phase === 'initial'
            ? ['--desktop-smoke']
            : ['--desktop-smoke', '--desktop-smoke-restored'],
          { cwd: scenarioRoot, env: environment },
        );
      },
    });
  }

  async function captureSourceEvidence() {
    sourceEvidence = await captureLegacySourceEvidence({
      identities,
      scenarioRoot,
      runNonce: request.runNonce,
    });
    await writeLegacySourceEvidence(
      resolve(evidenceRoot, LEGACY_SOURCE_EVIDENCE_FILENAME),
      sourceEvidence,
    );
  }

  async function requestGracefulClose(processId) {
    const result = await runOwnedProcess(
      powershell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        CLOSE_REQUEST_PATH,
        '-ProcessId',
        String(processId),
        '-ExpectedExecutablePath',
        executablePath,
      ],
      { cwd: scenarioRoot },
    );
    if (result.exitCode !== 0) {
      throw new Error('targetGracefulShutdownFailed');
    }
  }

  async function runTargetStartup(generation) {
    if (
      sourceEvidence === null ||
      !['first', 'second'].includes(generation) ||
      (generation === 'second' && firstTargetEvidence === null)
    ) {
      throw new Error('targetStartupPreconditionFailed');
    }
    const logDirectory = resolve(userDataRoot, 'runtime', 'logs', 'desktop');
    const baselineEventIds = await captureDesktopLifecycleBaseline(logDirectory);
    const application = await startOwnedProcess(
      executablePath,
      [`--user-data-dir=${userDataRoot}`],
      {
        cwd: scenarioRoot,
        env: withoutElectronNodeMode({ APPDATA: isolatedAppDataRoot }),
      },
    );
    const started = await waitForTargetDesktopStarted({
      baselineEventIds,
      childCompletion: application.completion,
      expectedIdentity: identities.target,
      logDirectory,
    });
    await requestGracefulClose(application.processId);
    const applicationResult = await application.completion;
    if (applicationResult.exitCode !== 0) {
      throw new Error('targetGracefulShutdownFailed');
    }
    await requireTargetShutdownCompleted({
      baselineEventIds,
      expectedIdentity: identities.target,
      logDirectory,
      runtimeInstanceId: started.runtimeInstanceId,
    });
    const evidence = await captureLegacyTargetEvidence({
      identities,
      previousEvidence:
        generation === 'second' ? firstTargetEvidence : undefined,
      runtimeInstanceId: started.runtimeInstanceId,
      sourceEvidence,
      userDataRoot,
    });
    await writeLegacyTargetEvidence(
      resolve(
        evidenceRoot,
        generation === 'first'
          ? LEGACY_FIRST_START_EVIDENCE_FILENAME
          : LEGACY_SECOND_START_EVIDENCE_FILENAME,
      ),
      evidence,
    );
    if (generation === 'first') firstTargetEvidence = evidence;
  }

  return Object.freeze({
    captureSourceEvidence,
    inspectState,
    runMsiOperation,
    runSourcePackagedSmoke,
    runTargetStartup,
    validateTargetPayload,
    verifyArtifact,
  });
}
