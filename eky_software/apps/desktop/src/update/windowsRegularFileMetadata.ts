import { execFile } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const inspectionTimeoutMilliseconds = 10_000;
const outputMaxBytes = 4 * 1024;
const metadataFields = new Set(['lastWriteTimeUtcTicks', 'length']);
const windowsTicksPattern = /^\d{17,19}$/u;

export interface WindowsRegularFileMetadata {
  lastWriteTimeUtcTicks: string;
  length: number;
}

interface ProcessResult {
  stderr: string;
  stdout: string;
}

interface ReadWindowsRegularFileMetadataOptions {
  filePath: string;
  inspectorScriptPath: string;
  powershellPath: string;
  runProcess?: (
    executablePath: string,
    args: readonly string[],
  ) => Promise<ProcessResult>;
}

export class WindowsRegularFileInspectionError extends Error {
  constructor() {
    super('The selected update file could not be verified.');
    this.name = 'WindowsRegularFileInspectionError';
  }
}

export async function readWindowsRegularFileMetadata(
  options: ReadWindowsRegularFileMetadataOptions,
): Promise<Readonly<WindowsRegularFileMetadata>> {
  try {
    await assertNodeRegularFile(options.filePath);
    await assertNodeRegularFile(options.inspectorScriptPath);
    await assertNodeRegularFile(options.powershellPath);
    const runProcess = options.runProcess ?? runPowerShellInspector;
    const result = await runProcess(options.powershellPath, [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      options.inspectorScriptPath,
      '-FilePath',
      options.filePath,
    ]);
    if (
      result.stderr.trim() !== '' ||
      Buffer.byteLength(result.stdout, 'utf8') > outputMaxBytes
    ) {
      throw new WindowsRegularFileInspectionError();
    }
    const lines = result.stdout
      .trim()
      .split(/\r?\n/u)
      .filter((line) => line.length > 0);
    if (lines.length !== 1 || lines[0] === undefined) {
      throw new WindowsRegularFileInspectionError();
    }
    return parseWindowsRegularFileMetadata(JSON.parse(lines[0]));
  } catch (error) {
    if (error instanceof WindowsRegularFileInspectionError) {
      throw error;
    }
    throw new WindowsRegularFileInspectionError();
  }
}

export function parseWindowsRegularFileMetadata(
  value: unknown,
): Readonly<WindowsRegularFileMetadata> {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== metadataFields.size ||
    Object.keys(value).some((key) => !metadataFields.has(key)) ||
    !Number.isSafeInteger(value.length) ||
    (value.length as number) < 1 ||
    typeof value.lastWriteTimeUtcTicks !== 'string' ||
    !windowsTicksPattern.test(value.lastWriteTimeUtcTicks)
  ) {
    throw new WindowsRegularFileInspectionError();
  }
  return Object.freeze({
    lastWriteTimeUtcTicks: value.lastWriteTimeUtcTicks,
    length: value.length as number,
  });
}

async function assertNodeRegularFile(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1) {
    throw new WindowsRegularFileInspectionError();
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
