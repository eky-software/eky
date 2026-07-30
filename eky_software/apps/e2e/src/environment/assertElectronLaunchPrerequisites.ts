import {
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import {
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';

import { assertPathUnderRoot } from './assertE2eSafetyBoundary.js';

export type ElectronLaunchPrerequisiteErrorCode =
  | 'ELECTRON_APPLICATION_MISSING'
  | 'ELECTRON_CONFIG_MISSING'
  | 'ELECTRON_CWD_MISSING'
  | 'ELECTRON_EXECUTABLE_MISSING'
  | 'ELECTRON_MAIN_MISSING'
  | 'ELECTRON_PROFILE_MISSING';

export class ElectronLaunchPrerequisiteError extends Error {
  readonly code: ElectronLaunchPrerequisiteErrorCode;

  constructor(code: ElectronLaunchPrerequisiteErrorCode) {
    super(code);
    this.name = 'ElectronLaunchPrerequisiteError';
    this.code = code;
  }
}

export function assertElectronLaunchPrerequisites(input: {
  applicationPath: string;
  configPath: string;
  cwd: string;
  executablePath: string;
  profileDirectories: readonly string[];
  runRoot: string;
}): void {
  requireRegularFile(
    input.executablePath,
    'ELECTRON_EXECUTABLE_MISSING',
  );
  const applicationPath = requireDirectory(
    input.applicationPath,
    'ELECTRON_APPLICATION_MISSING',
  );
  requireApplicationMain(applicationPath);

  const cwd = requireDirectory(input.cwd, 'ELECTRON_CWD_MISSING');
  requirePathWithinRunRoot(cwd, input.runRoot, 'ELECTRON_CWD_MISSING');

  const configPath = requireRegularFile(
    input.configPath,
    'ELECTRON_CONFIG_MISSING',
  );
  requirePathWithinRunRoot(
    configPath,
    input.runRoot,
    'ELECTRON_CONFIG_MISSING',
  );

  if (input.profileDirectories.length === 0) {
    fail('ELECTRON_PROFILE_MISSING');
  }
  for (const profileDirectory of input.profileDirectories) {
    const profilePath = requireDirectory(
      profileDirectory,
      'ELECTRON_PROFILE_MISSING',
    );
    requirePathWithinRunRoot(
      profilePath,
      input.runRoot,
      'ELECTRON_PROFILE_MISSING',
    );
  }
}

function requireApplicationMain(applicationPath: string): void {
  let packageDocument: unknown;
  try {
    packageDocument = JSON.parse(
      readFileSync(join(applicationPath, 'package.json'), 'utf8'),
    ) as unknown;
  } catch {
    fail('ELECTRON_APPLICATION_MISSING');
  }

  if (
    typeof packageDocument !== 'object' ||
    packageDocument === null ||
    Array.isArray(packageDocument)
  ) {
    fail('ELECTRON_APPLICATION_MISSING');
  }

  const main = (packageDocument as Record<string, unknown>).main;
  if (
    typeof main !== 'string' ||
    main.trim() === '' ||
    isAbsolute(main)
  ) {
    fail('ELECTRON_MAIN_MISSING');
  }

  const mainPath = resolve(applicationPath, main);
  const relativeMainPath = relative(applicationPath, mainPath);
  if (
    relativeMainPath === '..' ||
    relativeMainPath.startsWith(`..${sep}`)
  ) {
    fail('ELECTRON_MAIN_MISSING');
  }
  requireRegularFile(mainPath, 'ELECTRON_MAIN_MISSING');
}

function requireDirectory(
  path: string,
  code: ElectronLaunchPrerequisiteErrorCode,
): string {
  try {
    if (lstatSync(path).isSymbolicLink()) {
      fail(code);
    }
    const realPath = realpathSync(path);
    if (!statSync(realPath).isDirectory()) {
      fail(code);
    }
    return realPath;
  } catch (error) {
    if (error instanceof ElectronLaunchPrerequisiteError) {
      throw error;
    }
    fail(code);
  }
}

function requireRegularFile(
  path: string,
  code: ElectronLaunchPrerequisiteErrorCode,
): string {
  try {
    if (lstatSync(path).isSymbolicLink()) {
      fail(code);
    }
    const realPath = realpathSync(path);
    if (!statSync(realPath).isFile()) {
      fail(code);
    }
    return realPath;
  } catch (error) {
    if (error instanceof ElectronLaunchPrerequisiteError) {
      throw error;
    }
    fail(code);
  }
}

function requirePathWithinRunRoot(
  path: string,
  runRoot: string,
  code: ElectronLaunchPrerequisiteErrorCode,
): void {
  try {
    assertPathUnderRoot(path, runRoot);
  } catch {
    fail(code);
  }
}

function fail(code: ElectronLaunchPrerequisiteErrorCode): never {
  throw new ElectronLaunchPrerequisiteError(code);
}
