import { execFile } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { win32 } from 'node:path';
import { promisify } from 'node:util';

import { requireCanonicalWindowsSystemRoot } from './windowsSystemRoot.js';

const execFileAsync = promisify(execFile);
const outputMaxBytes = 8 * 1024;
const inspectionTimeoutMilliseconds = 10_000;
const identityFields = new Set([
  'architecture',
  'packageScope',
  'productCode',
  'productVersion',
  'upgradeCode',
]);
const guidPattern = /^\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}$/;
const msiProductVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export interface WindowsInstallerIdentity {
  architecture: 'x64';
  packageScope: 'perUser';
  productCode: string;
  productVersion: string;
  upgradeCode: string;
}

interface ProcessResult {
  stderr: string;
  stdout: string;
}

interface ReadWindowsInstallerIdentityOptions {
  inspectorScriptPath: string;
  msiPath: string;
  powershellPath: string;
  runProcess?: (
    executablePath: string,
    args: readonly string[],
  ) => Promise<ProcessResult>;
}

export class WindowsInstallerIdentityInspectionError extends Error {
  constructor() {
    super('The Windows installer identity could not be verified.');
    this.name = 'WindowsInstallerIdentityInspectionError';
  }
}

export async function readWindowsInstallerIdentity(
  options: ReadWindowsInstallerIdentityOptions,
): Promise<Readonly<WindowsInstallerIdentity>> {
  try {
    await assertRegularFile(options.msiPath, '.msi');
    await assertRegularFile(options.inspectorScriptPath, '.ps1');
    await assertRegularFile(options.powershellPath, '.exe');

    const runProcess = options.runProcess ?? runPowerShellInspector;
    const result = await runProcess(options.powershellPath, [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      options.inspectorScriptPath,
      '-MsiPath',
      options.msiPath,
    ]);
    if (Buffer.byteLength(result.stdout, 'utf8') > outputMaxBytes) {
      throw new WindowsInstallerIdentityInspectionError();
    }
    if (result.stderr.trim() !== '') {
      throw new WindowsInstallerIdentityInspectionError();
    }
    const outputLines = result.stdout
      .trim()
      .split(/\r?\n/u)
      .filter((line) => line.length > 0);
    if (outputLines.length !== 1 || outputLines[0] === undefined) {
      throw new WindowsInstallerIdentityInspectionError();
    }
    return parseWindowsInstallerIdentity(JSON.parse(outputLines[0]));
  } catch (error) {
    if (error instanceof WindowsInstallerIdentityInspectionError) {
      throw error;
    }
    throw new WindowsInstallerIdentityInspectionError();
  }
}

export function resolveWindowsPowerShellPath(
  systemRoot: string | undefined,
): string {
  try {
    return win32.join(
      requireCanonicalWindowsSystemRoot(systemRoot),
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
  } catch {
    throw new WindowsInstallerIdentityInspectionError();
  }
}

export function parseWindowsInstallerIdentity(
  value: unknown,
): Readonly<WindowsInstallerIdentity> {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== identityFields.size ||
    Object.keys(value).some((key) => !identityFields.has(key)) ||
    value.architecture !== 'x64' ||
    value.packageScope !== 'perUser' ||
    typeof value.productCode !== 'string' ||
    !guidPattern.test(value.productCode) ||
    typeof value.productVersion !== 'string' ||
    !isMsiProductVersion(value.productVersion) ||
    typeof value.upgradeCode !== 'string' ||
    !guidPattern.test(value.upgradeCode)
  ) {
    throw new WindowsInstallerIdentityInspectionError();
  }

  return Object.freeze({
    architecture: 'x64',
    packageScope: 'perUser',
    productCode: value.productCode,
    productVersion: value.productVersion,
    upgradeCode: value.upgradeCode,
  });
}

async function runPowerShellInspector(
  executablePath: string,
  args: readonly string[],
): Promise<ProcessResult> {
  const result = await execFileAsync(executablePath, [...args], {
    encoding: 'utf8',
    maxBuffer: outputMaxBytes,
    timeout: inspectionTimeoutMilliseconds,
    windowsHide: true,
  });
  return { stderr: result.stderr, stdout: result.stdout };
}

async function assertRegularFile(path: string, extension: string): Promise<void> {
  if (win32.extname(path).toLowerCase() !== extension) {
    throw new WindowsInstallerIdentityInspectionError();
  }
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1) {
    throw new WindowsInstallerIdentityInspectionError();
  }
}

function isMsiProductVersion(value: string): boolean {
  const match = msiProductVersionPattern.exec(value);
  if (match === null) {
    return false;
  }
  return (
    Number(match[1]) <= 255 &&
    Number(match[2]) <= 255 &&
    Number(match[3]) <= 65_535
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
