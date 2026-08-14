import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  isNumericReleaseVersion,
  parseDesktopBuildInfo,
  type DesktopBuildInfo,
} from './desktopBuildInfo.js';

const execFileAsync = promisify(execFile);

interface CreatePackageBuildInfoOptions {
  appVersion: string;
  environment?: Readonly<Record<string, string | undefined>>;
  now?: () => Date;
  readGitOutput?: (args: readonly string[]) => Promise<string>;
  repositoryRoot: string;
}

export async function createPackageBuildInfo(
  options: CreatePackageBuildInfoOptions,
): Promise<Readonly<DesktopBuildInfo>> {
  if (!isNumericReleaseVersion(options.appVersion)) {
    throw new Error('DESKTOP_PACKAGE_VERSION_INVALID');
  }

  const readGitOutput =
    options.readGitOutput ??
    (async (args: readonly string[]) => {
      const result = await execFileAsync('git', [...args], {
        cwd: options.repositoryRoot,
        encoding: 'utf8',
        windowsHide: true,
      });
      return result.stdout;
    });
  const environment = options.environment ?? process.env;
  const configuredRevision = environment.EKY_BUILD_REVISION;
  let buildRevision: string;

  if (configuredRevision !== undefined) {
    buildRevision = configuredRevision;
  } else {
    try {
      buildRevision = (
        await readGitOutput(['rev-parse', '--short=12', 'HEAD'])
      ).trim();
    } catch {
      throw new Error('DESKTOP_BUILD_REVISION_UNAVAILABLE');
    }
  }

  let status: string;
  try {
    status = await readGitOutput(['status', '--porcelain']);
  } catch {
    throw new Error('DESKTOP_BUILD_STATUS_UNAVAILABLE');
  }

  try {
    return parseDesktopBuildInfo({
      appVersion: options.appVersion,
      buildCreatedAt: (options.now ?? (() => new Date()))().toISOString(),
      buildDirty: status.length > 0,
      buildRevision,
      schemaVersion: 1,
    });
  } catch {
    throw new Error('DESKTOP_BUILD_INFO_INVALID');
  }
}

export function readDesktopPackageVersion(value: unknown): string {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !('version' in value) ||
    typeof value.version !== 'string' ||
    !isNumericReleaseVersion(value.version)
  ) {
    throw new Error('DESKTOP_PACKAGE_VERSION_INVALID');
  }

  return value.version;
}
