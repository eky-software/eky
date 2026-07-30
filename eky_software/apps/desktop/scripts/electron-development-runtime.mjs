import {
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';

import { readDesktopElectronVersionFromMetadata } from './read-desktop-electron-version.mjs';

const defaultDesktopPackageJsonPath = fileURLToPath(
  new URL('../package.json', import.meta.url),
);

export class ElectronDevelopmentRuntimeError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ElectronDevelopmentRuntimeError';
    this.code = code;
  }
}

export function resolveElectronDevelopmentRuntime(input = {}) {
  const desktopPackageJsonPath =
    input.desktopPackageJsonPath ?? defaultDesktopPackageJsonPath;
  const desktopPackageMetadata = readJsonObject(
    desktopPackageJsonPath,
    'ELECTRON_PACKAGE_INVALID',
  );
  const expectedVersion =
    readDesktopElectronVersionFromMetadata(desktopPackageMetadata);
  const desktopRequire = createRequire(desktopPackageJsonPath);

  let electronPackageJsonPath;
  try {
    electronPackageJsonPath = desktopRequire.resolve('electron/package.json');
  } catch {
    fail('ELECTRON_PACKAGE_MISSING');
  }

  const electronPackageMetadata = readJsonObject(
    electronPackageJsonPath,
    'ELECTRON_PACKAGE_INVALID',
  );
  if (
    typeof electronPackageMetadata.version !== 'string' ||
    electronPackageMetadata.version !== expectedVersion
  ) {
    fail('ELECTRON_VERSION_MISMATCH');
  }

  const electronPackageRoot = realpathSync(dirname(electronPackageJsonPath));
  const executableName = readRuntimeExecutableName(electronPackageRoot);
  const electronDistRoot = resolve(electronPackageRoot, 'dist');
  const executablePath = resolve(electronDistRoot, executableName);
  const executablePathWithinDist = relative(electronDistRoot, executablePath);
  if (
    executablePathWithinDist === '' ||
    executablePathWithinDist === '..' ||
    executablePathWithinDist.startsWith(`..${sep}`)
  ) {
    fail('ELECTRON_PACKAGE_INVALID');
  }

  const executableRealPath = requireRegularFile(executablePath);
  const executableRelativePath = relative(
    electronPackageRoot,
    executableRealPath,
  );
  if (
    executableRelativePath === '' ||
    executableRelativePath === '..' ||
    executableRelativePath.startsWith(`..${sep}`)
  ) {
    fail('ELECTRON_PACKAGE_INVALID');
  }

  return {
    executablePath: executableRealPath,
    version: expectedVersion,
  };
}

function readRuntimeExecutableName(electronPackageRoot) {
  let executableName;
  try {
    executableName = readFileSync(
      join(electronPackageRoot, 'path.txt'),
      'utf8',
    ).trim();
  } catch {
    fail('ELECTRON_EXECUTABLE_MISSING');
  }
  if (executableName === '' || isAbsolute(executableName)) {
    fail('ELECTRON_PACKAGE_INVALID');
  }
  return executableName;
}

function readJsonObject(path, code) {
  let value;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    fail(code);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(code);
  }
  return value;
}

function requireRegularFile(path) {
  try {
    if (lstatSync(path).isSymbolicLink()) {
      fail('ELECTRON_EXECUTABLE_MISSING');
    }
    const realPath = realpathSync(path);
    if (!statSync(realPath).isFile()) {
      fail('ELECTRON_EXECUTABLE_MISSING');
    }
    return realPath;
  } catch (error) {
    if (error instanceof ElectronDevelopmentRuntimeError) {
      throw error;
    }
    fail('ELECTRON_EXECUTABLE_MISSING');
  }
}

function fail(code) {
  throw new ElectronDevelopmentRuntimeError(code);
}
