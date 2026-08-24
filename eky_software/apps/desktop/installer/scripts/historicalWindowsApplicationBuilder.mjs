import { HISTORICAL_WINDOWS_INSTALLER_FIXTURE } from './historicalWindowsInstallerFixtureProvenance.mjs';
import {
  resolveHistoricalJavaScriptToolchain,
  runHistoricalToolchainProcess,
} from './historicalWindowsInstallerToolchain.mjs';

export async function installHistoricalDependencies({ workspaceRoot }) {
  const toolchain = await resolveHistoricalJavaScriptToolchain(workspaceRoot);
  await runHistoricalToolchainProcess(
    process.execPath,
    [toolchain.pnpmCliPath, 'install', '--frozen-lockfile'],
    {
      code: 'HISTORICAL_FIXTURE_FROZEN_INSTALL_FAILED',
      cwd: workspaceRoot,
      environment: process.env,
    },
  );
}

export async function packageHistoricalApplication({ workspaceRoot }) {
  const toolchain = await resolveHistoricalJavaScriptToolchain(workspaceRoot);
  await runHistoricalToolchainProcess(
    process.execPath,
    [toolchain.pnpmCliPath, '--filter', '@eky/desktop', 'package:windows'],
    {
      code: 'HISTORICAL_FIXTURE_PACKAGE_FAILED',
      cwd: workspaceRoot,
      environment: createHistoricalApplicationBuildEnvironment(process.env),
    },
  );
}

export function createHistoricalApplicationBuildEnvironment(baseEnvironment) {
  return {
    ...baseEnvironment,
    EKY_BUILD_REVISION:
      HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedRuntimeBuildRevision,
  };
}
