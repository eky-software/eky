import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  parseWindowsInstallerIdentity,
  readWindowsInstallerIdentity,
  resolveWindowsPowerShellPath,
  WindowsInstallerIdentityInspectionError,
} from './windowsInstallerIdentity.js';

const temporaryRoots: string[] = [];
const validIdentity = {
  architecture: 'x64',
  packageScope: 'perUser',
  productCode: '{02F99C94-ECBD-48A4-8117-1DE7F55C1E09}',
  productVersion: '0.1.1',
  upgradeCode: '{302530B2-D950-41F5-8397-264B485FEE9A}',
};

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('Windows Installer identity inspection', () => {
  it('invokes only the fixed executable and static script with separate arguments', async () => {
    const files = await createFiles();
    const runProcess = vi.fn(async () => ({
      stderr: '',
      stdout: `${JSON.stringify(validIdentity)}\r\n`,
    }));

    await expect(
      readWindowsInstallerIdentity({ ...files, runProcess }),
    ).resolves.toEqual(validIdentity);
    expect(runProcess).toHaveBeenCalledWith(files.powershellPath, [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      files.inspectorScriptPath,
      '-MsiPath',
      files.msiPath,
    ]);
  });

  it('rejects extra output, stderr and untrusted metadata with one safe error', async () => {
    const files = await createFiles();
    for (const result of [
      { stderr: 'C:/sensitive', stdout: JSON.stringify(validIdentity) },
      {
        stderr: '',
        stdout: `${JSON.stringify(validIdentity)}\n${JSON.stringify(validIdentity)}`,
      },
      {
        stderr: '',
        stdout: JSON.stringify({ ...validIdentity, packageScope: 'perMachine' }),
      },
      {
        stderr: '',
        stdout: JSON.stringify({ ...validIdentity, path: 'C:/sensitive' }),
      },
      { stderr: '', stdout: '{' },
    ]) {
      await expect(
        readWindowsInstallerIdentity({
          ...files,
          runProcess: async () => result,
        }),
      ).rejects.toThrow(WindowsInstallerIdentityInspectionError);
    }
  });

  it('rejects paths that are not regular files before process creation', async () => {
    const files = await createFiles();
    const runProcess = vi.fn();
    await rm(files.msiPath);

    await expect(
      readWindowsInstallerIdentity({ ...files, runProcess }),
    ).rejects.toThrow(WindowsInstallerIdentityInspectionError);
    expect(runProcess).not.toHaveBeenCalled();
  });

  it('validates the exact identity schema and Windows PowerShell location', () => {
    expect(parseWindowsInstallerIdentity(validIdentity)).toEqual(validIdentity);
    expect(resolveWindowsPowerShellPath('C:\\Windows')).toBe(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    );
    expect(() => resolveWindowsPowerShellPath(undefined)).toThrow(
      WindowsInstallerIdentityInspectionError,
    );
    expect(() =>
      parseWindowsInstallerIdentity({ ...validIdentity, productVersion: '1' }),
    ).toThrow(WindowsInstallerIdentityInspectionError);
  });
});

async function createFiles() {
  const root = await mkdtemp(join(tmpdir(), 'eky-msi-identity-'));
  temporaryRoots.push(root);
  const msiPath = join(root, 'candidate.msi');
  const inspectorScriptPath = join(root, 'inspect.ps1');
  const powershellPath = join(root, 'powershell.exe');
  await Promise.all([
    writeFile(msiPath, 'msi'),
    writeFile(inspectorScriptPath, 'script'),
    writeFile(powershellPath, 'executable'),
  ]);
  return { inspectorScriptPath, msiPath, powershellPath };
}
