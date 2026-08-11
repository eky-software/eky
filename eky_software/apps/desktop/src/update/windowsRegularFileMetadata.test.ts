import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  parseWindowsRegularFileMetadata,
  readWindowsRegularFileMetadata,
  WindowsRegularFileInspectionError,
} from './windowsRegularFileMetadata.js';

const roots: string[] = [];
const validMetadata = {
  lastWriteTimeUtcTicks: '638905536000000000',
  length: 123,
};

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe('Windows regular update file inspection', () => {
  it('uses only the fixed executable and static script with separate arguments', async () => {
    const files = await createFiles();
    const runProcess = vi.fn(async () => ({
      stderr: '',
      stdout: `${JSON.stringify(validMetadata)}\r\n`,
    }));
    await expect(
      readWindowsRegularFileMetadata({ ...files, runProcess }),
    ).resolves.toEqual(validMetadata);
    expect(runProcess).toHaveBeenCalledWith(files.powershellPath, [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      files.inspectorScriptPath,
      '-FilePath',
      files.filePath,
    ]);
  });

  it('rejects malformed output and unexpected fields safely', async () => {
    const files = await createFiles();
    for (const result of [
      { stderr: 'C:/sensitive', stdout: JSON.stringify(validMetadata) },
      { stderr: '', stdout: `${JSON.stringify(validMetadata)}\nextra` },
      { stderr: '', stdout: JSON.stringify({ ...validMetadata, path: 'C:/' }) },
      { stderr: '', stdout: '{' },
    ]) {
      await expect(
        readWindowsRegularFileMetadata({
          ...files,
          runProcess: async () => result,
        }),
      ).rejects.toThrow(WindowsRegularFileInspectionError);
    }
  });

  it('validates the exact output schema', () => {
    expect(parseWindowsRegularFileMetadata(validMetadata)).toEqual(validMetadata);
    expect(() =>
      parseWindowsRegularFileMetadata({ ...validMetadata, length: 0 }),
    ).toThrow(WindowsRegularFileInspectionError);
  });
});

async function createFiles() {
  const root = await mkdtemp(join(tmpdir(), 'eky-update-file-'));
  roots.push(root);
  const filePath = join(root, 'manifest.json');
  const inspectorScriptPath = join(root, 'inspect.ps1');
  const powershellPath = join(root, 'powershell.exe');
  await Promise.all([
    writeFile(filePath, '{}'),
    writeFile(inspectorScriptPath, 'script'),
    writeFile(powershellPath, 'executable'),
  ]);
  return { filePath, inspectorScriptPath, powershellPath };
}
