import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { HISTORICAL_WINDOWS_INSTALLER_FIXTURE } from './historicalWindowsInstallerFixtureProvenance.mjs';
import { HISTORICAL_WINDOWS_INSTALLER_FIXTURE_POLICY } from './historicalWindowsInstallerFixturePolicy.mjs';
import {
  assertHistoricalDotnetToolchain,
  assertHistoricalFixtureRegularFile,
  runHistoricalToolchainProcess,
} from './historicalWindowsInstallerToolchain.mjs';

const execFileAsync = promisify(execFile);

export async function restoreHistoricalInstaller({ workspaceRoot }) {
  const dotnetExecutable = process.env.EKY_DOTNET_EXE ?? 'dotnet';
  await assertHistoricalDotnetToolchain({
    dotnetExecutable,
    workspaceRoot,
  });
  await runHistoricalToolchainProcess(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      join(
        workspaceRoot,
        'apps/desktop/installer/scripts/verifyLockedInstallerRestore.ps1',
      ),
      '-DotnetExecutable',
      dotnetExecutable,
    ],
    {
      code: 'HISTORICAL_FIXTURE_LOCKED_RESTORE_FAILED',
      cwd: workspaceRoot,
      environment: process.env,
    },
  );
}

export async function buildHistoricalInstallerRelease({ workspaceRoot }) {
  const dotnetExecutable = process.env.EKY_DOTNET_EXE ?? 'dotnet';
  const releaseModule = await import(
    `${pathToFileURL(
      join(
        workspaceRoot,
        'apps/desktop/installer/scripts/releaseWindowsInstaller.mjs',
      ),
    ).href}?fixture=${Date.now().toString(10)}`
  );
  const previousDotnetExecutable = process.env.EKY_DOTNET_EXE;
  process.env.EKY_DOTNET_EXE = dotnetExecutable;
  try {
    return await releaseModule.createWindowsInstallerRelease({
      buildRevision: HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedCommit,
    });
  } finally {
    if (previousDotnetExecutable === undefined) {
      delete process.env.EKY_DOTNET_EXE;
    } else {
      process.env.EKY_DOTNET_EXE = previousDotnetExecutable;
    }
  }
}

export async function inspectWindowsInstallerIdentity(installerPath) {
  const { desktopDirectory, maximumJsonBytes, repositoryRoot } =
    HISTORICAL_WINDOWS_INSTALLER_FIXTURE_POLICY;
  await assertHistoricalFixtureRegularFile(
    installerPath,
    'HISTORICAL_FIXTURE_INSTALLER_ARTIFACT_INVALID',
  );
  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        join(
          desktopDirectory,
          'resources/update/inspectWindowsInstallerIdentity.ps1',
        ),
        '-MsiPath',
        installerPath,
      ],
      {
        cwd: repositoryRoot,
        encoding: 'utf8',
        maxBuffer: maximumJsonBytes,
        windowsHide: true,
      },
    ));
    return JSON.parse(stdout);
  } catch {
    throw new Error('HISTORICAL_FIXTURE_INSTALLER_INSPECTION_FAILED');
  }
}
