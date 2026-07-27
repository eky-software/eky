import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  parseDesktopBuildInfo,
  type DesktopBuildInfo,
} from './desktopBuildInfo.js';

interface ReadDesktopBuildInfoOptions {
  applicationPath: string;
  appVersion: string;
  isPackaged: boolean;
  now?: () => Date;
  readTextFile?: (path: string) => Promise<string>;
}

export async function readDesktopBuildInfo(
  options: ReadDesktopBuildInfoOptions,
): Promise<Readonly<DesktopBuildInfo>> {
  if (!options.isPackaged) {
    return parseDesktopBuildInfo(
      {
        appVersion: options.appVersion,
        buildCreatedAt: (options.now ?? (() => new Date()))().toISOString(),
        buildDirty: true,
        buildRevision: 'development',
        schemaVersion: 1,
      },
      {
        allowDevelopmentRevision: true,
        expectedAppVersion: options.appVersion,
      },
    );
  }

  const read = options.readTextFile ?? ((path) => readFile(path, 'utf8'));
  let value: unknown;

  try {
    value = JSON.parse(
      await read(join(options.applicationPath, 'dist', 'build-info.json')),
    ) as unknown;
  } catch {
    throw new Error('PACKAGED_BUILD_INFO_INVALID');
  }

  try {
    return parseDesktopBuildInfo(value, {
      expectedAppVersion: options.appVersion,
    });
  } catch {
    throw new Error('PACKAGED_BUILD_INFO_INVALID');
  }
}
