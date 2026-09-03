import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createInstallerProductCode } from '../installerIdentity.mjs';
import {
  readInstallerManifest,
  verifyInstallerManifestPackage,
} from '../installerManifest.mjs';
import { parseStrictJsonObjectBytes } from './strictJsonObject.mjs';

const INSPECTOR_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'inspectWindowsInstallerProductState.ps1',
);
const STATE_KEYS = [
  'ekyProcessCount',
  'localPackagePresent',
  'ownedRegistryExists',
  'productName',
  'productState',
  'productVersion',
  'schemaVersion',
];

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function pathExistsAs(path, expectedKind) {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) {
      throw new Error('installerStateInspectionFailed');
    }
    const kind = metadata.isDirectory()
      ? 'directory'
      : metadata.isFile()
        ? 'file'
        : 'other';
    if (kind !== expectedKind) {
      throw new Error('installerStateInspectionFailed');
    }
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw new Error('installerStateInspectionFailed');
  }
}

function runOwnedProcess(command, arguments_) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, arguments_, {
      stdio: 'ignore',
      windowsHide: true,
    });
    child.once('error', () =>
      rejectPromise(new Error('ownedProcessStartFailed')),
    );
    child.once('close', (exitCode, signal) => {
      if (signal !== null || !Number.isInteger(exitCode)) {
        rejectPromise(new Error('ownedProcessExitInvalid'));
        return;
      }
      resolvePromise(exitCode);
    });
  });
}

function validateInspectorResult(value) {
  const keys =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? Object.keys(value).sort()
      : [];
  if (
    keys.length !== STATE_KEYS.length ||
    keys.some((key, index) => key !== STATE_KEYS[index]) ||
    value.schemaVersion !== 1 ||
    !Number.isInteger(value.productState) ||
    value.productState < -1 ||
    value.productState > 5 ||
    (value.productName !== null && typeof value.productName !== 'string') ||
    (value.productVersion !== null &&
      typeof value.productVersion !== 'string') ||
    typeof value.localPackagePresent !== 'boolean' ||
    typeof value.ownedRegistryExists !== 'boolean' ||
    !Number.isSafeInteger(value.ekyProcessCount) ||
    value.ekyProcessCount < 0
  ) {
    throw new Error('installerStateInspectionFailed');
  }
  return value;
}

export async function createCleanInstallUninstallWindowsRuntime(
  request,
  manifest,
) {
  const systemRoot = process.env.SystemRoot;
  const localAppData = process.env.LOCALAPPDATA;
  const appData = process.env.APPDATA;
  if (!systemRoot || !localAppData || !appData) {
    throw new Error('installerEnvironmentInvalid');
  }

  const productCode = `{${createInstallerProductCode(manifest.msiProductVersion)}}`;
  const installerPath = resolve(request.fixtureRoot, manifest.packageFilename);
  const manifestPath = resolve(request.fixtureRoot, 'installer.manifest.json');
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
  const logRoot = resolve(dirname(request.fixtureRoot), 'msi-logs');
  await mkdir(logRoot, { recursive: false });
  let stateSequence = 0;

  async function verifyFixture() {
    try {
      if ((await hashFile(manifestPath)) !== request.artifactDescriptorSha256) {
        throw new Error('fixtureVerificationFailed');
      }
      const currentManifest = await readInstallerManifest(manifestPath);
      await verifyInstallerManifestPackage({
        installerPath,
        manifest: currentManifest,
      });
    } catch {
      throw new Error('fixtureVerificationFailed');
    }
  }

  async function inspectState(label) {
    const resultPath = resolve(
      dirname(request.fixtureRoot),
      `product-state-${stateSequence}-${label}.json`,
    );
    stateSequence += 1;
    const powershell = resolve(
      systemRoot,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    const exitCode = await runOwnedProcess(powershell, [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      INSPECTOR_PATH,
      '-ProductCode',
      productCode,
      '-ResultPath',
      resultPath,
    ]).catch(() => -1);
    if (exitCode !== 0) {
      throw new Error('installerStateInspectionFailed');
    }
    let inspected;
    try {
      const resultMetadata = await lstat(resultPath);
      if (
        !resultMetadata.isFile() ||
        resultMetadata.isSymbolicLink() ||
        resultMetadata.size < 2 ||
        resultMetadata.size > 64 * 1024
      ) {
        throw new Error('installerStateInspectionFailed');
      }
      inspected = validateInspectorResult(
        parseStrictJsonObjectBytes(await readFile(resultPath), {
          errorCode: 'installerStateInspectionFailed',
        }),
      );
    } catch {
      throw new Error('installerStateInspectionFailed');
    }
    return Object.freeze({
      ...inspected,
      installRootExists: await pathExistsAs(installRoot, 'directory'),
      executableExists: await pathExistsAs(executablePath, 'file'),
      shortcutExists: await pathExistsAs(shortcutPath, 'file'),
    });
  }

  async function runMsiOperation(operation) {
    if (!['cleanup', 'install', 'uninstall'].includes(operation)) {
      throw new Error('unexpectedFailure');
    }
    const msiexec = resolve(systemRoot, 'System32', 'msiexec.exe');
    const operationArguments =
      operation === 'install' ? ['/i', installerPath] : ['/x', productCode];
    const logPath = resolve(logRoot, `${operation}.log`);
    try {
      return await runOwnedProcess(msiexec, [
        ...operationArguments,
        '/qn',
        '/norestart',
        '/l*v',
        logPath,
      ]);
    } catch {
      return -1;
    }
  }

  return Object.freeze({ inspectState, runMsiOperation, verifyFixture });
}
