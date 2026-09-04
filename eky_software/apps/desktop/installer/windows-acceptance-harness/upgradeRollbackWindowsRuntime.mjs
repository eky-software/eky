import { spawn } from 'node:child_process';
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseStrictJsonObjectBytes } from './strictJsonObject.mjs';
import { validateInstallerProductStateResult } from './cleanInstallUninstallWindowsRuntime.mjs';
import { verifyUpgradeRollbackArtifact } from './upgradeRollbackArtifact.mjs';

const INSPECTOR_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'inspectWindowsInstallerProductState.ps1',
);

function bracedProductCode(productCode) {
  return `{${productCode}}`;
}

function runOwnedProcess(command, arguments_, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, arguments_, {
      cwd: options.cwd,
      stdio: 'ignore',
      windowsHide: true,
    });
    const processId = child.pid;
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
}

async function pathKind(path) {
  try {
    const metadata = await lstat(path, { bigint: true });
    if (metadata.isSymbolicLink()) {
      return 'invalid';
    }
    if (metadata.isDirectory()) {
      return 'directory';
    }
    if (metadata.isFile() && metadata.nlink === 1n) {
      return 'file';
    }
    return 'invalid';
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return 'absent';
    }
    throw new Error('installerStateInspectionFailed');
  }
}

async function requireRegularFile(path, errorCode) {
  try {
    const metadata = await lstat(path, { bigint: true });
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.nlink !== 1n ||
      metadata.size < 1n
    ) {
      throw new Error(errorCode);
    }
  } catch {
    throw new Error(errorCode);
  }
}

export async function createUpgradeRollbackWindowsRuntime(request, artifact) {
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
  const cmd = resolve(systemRoot, 'System32', 'cmd.exe');
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
  const rollbackBlockerPath = resolve(
    installRoot,
    'resources',
    'desktop-runtime',
    'installer-rollback-probe',
  );
  const rollbackScriptPath = resolve(
    installRoot,
    'resources',
    'update-runtime',
    'rollbackWindowsInstaller.ps1',
  );
  const runRoot = dirname(request.fixtureRoot);
  const logRoot = resolve(runRoot, 'upgrade-msi-logs');
  await mkdir(logRoot, { recursive: false });
  let inspectionSequence = 0;

  async function inspectExactProduct(productCode) {
    const resultPath = resolve(
      runRoot,
      `upgrade-product-state-${inspectionSequence}.json`,
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
          bracedProductCode(productCode),
          '-ResultPath',
          resultPath,
        ],
        { cwd: runRoot },
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
    const source = await inspectExactProduct(
      artifact.roles.source.productCode,
    );
    const target = await inspectExactProduct(
      artifact.roles.target.productCode,
    );
    const installRootKind = await pathKind(installRoot);
    const executableKind = await pathKind(executablePath);
    const shortcutKind = await pathKind(shortcutPath);
    const rollbackBlockerKind = await pathKind(rollbackBlockerPath);
    if (
      !['absent', 'directory'].includes(installRootKind) ||
      !['absent', 'file'].includes(executableKind) ||
      !['absent', 'file'].includes(shortcutKind) ||
      !['absent', 'file'].includes(rollbackBlockerKind) ||
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
      rollbackBlockerKind,
      ekyProcessCount: source.ekyProcessCount,
    });
  }

  const operations = Object.freeze({
    sourceInstall: ['/i', artifact.roles.source.installerPath],
    majorUpgrade: ['/i', artifact.roles.target.installerPath],
    downgrade: ['/i', artifact.roles.source.installerPath],
    windowsInstallerRollback: [
      '/i',
      artifact.roles.windowsRollback.installerPath,
    ],
    finalUninstall: [
      '/x',
      bracedProductCode(artifact.roles.source.productCode),
    ],
    cleanupSource: [
      '/x',
      bracedProductCode(artifact.roles.source.productCode),
    ],
    cleanupTarget: [
      '/x',
      bracedProductCode(artifact.roles.target.productCode),
    ],
  });

  async function runMsiOperation(operation) {
    const operationArguments = operations[operation];
    if (operationArguments === undefined) {
      throw new Error('unexpectedFailure');
    }
    try {
      const processResult = await runOwnedProcess(
        msiexec,
        [
          ...operationArguments,
          '/qn',
          '/norestart',
          '/l*v',
          resolve(logRoot, `${operation}.log`),
        ],
        { cwd: runRoot },
      );
      return processResult.exitCode;
    } catch {
      return -1;
    }
  }

  async function invokeBinaryRollback() {
    await requireRegularFile(rollbackScriptPath, 'binaryRollbackFailed');
    let launcher;
    try {
      launcher = await runOwnedProcess(cmd, ['/d', '/s', '/c', 'exit 0'], {
        cwd: runRoot,
      });
    } catch {
      throw new Error('binaryRollbackFailed');
    }
    if (launcher.exitCode !== 0) {
      throw new Error('binaryRollbackFailed');
    }
    try {
      const rollback = await runOwnedProcess(
        powershell,
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          rollbackScriptPath,
          '-MsiExecPath',
          msiexec,
          '-FailedProductCode',
          bracedProductCode(artifact.roles.target.productCode),
          '-LauncherProcessId',
          String(launcher.processId),
          '-FailedPackagePath',
          artifact.roles.target.installerPath,
          '-RollbackPackagePath',
          artifact.roles.source.installerPath,
        ],
        { cwd: runRoot },
      );
      return rollback.exitCode;
    } catch {
      return -1;
    }
  }

  async function createRollbackBlocker() {
    if ((await pathKind(rollbackBlockerPath)) !== 'absent') {
      throw new Error('rollbackBlockerFailed');
    }
    await writeFile(rollbackBlockerPath, 'synthetic rollback blocker', {
      encoding: 'ascii',
      flag: 'wx',
    });
    if ((await pathKind(rollbackBlockerPath)) !== 'file') {
      throw new Error('rollbackBlockerFailed');
    }
  }

  async function removeRollbackBlocker() {
    const kind = await pathKind(rollbackBlockerPath);
    if (kind === 'absent') {
      return;
    }
    if (kind !== 'file') {
      throw new Error('rollbackBlockerFailed');
    }
    await rm(rollbackBlockerPath, { force: false });
    if ((await pathKind(rollbackBlockerPath)) !== 'absent') {
      throw new Error('rollbackBlockerFailed');
    }
  }

  async function verifyArtifact() {
    try {
      await verifyUpgradeRollbackArtifact({
        artifactRoot: request.fixtureRoot,
        expectedBuildRevision: artifact.buildRevision,
        expectedDescriptorSha256: request.artifactDescriptorSha256,
      });
    } catch {
      throw new Error('artifactVerificationFailed');
    }
  }

  return Object.freeze({
    createRollbackBlocker,
    inspectState,
    invokeBinaryRollback,
    removeRollbackBlocker,
    runMsiOperation,
    verifyArtifact,
  });
}
