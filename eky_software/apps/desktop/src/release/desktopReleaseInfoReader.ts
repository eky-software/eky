import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  parseDesktopReleaseInfo,
  type DesktopReleaseInfo,
} from './desktopReleaseInfo.js';

interface ReadDesktopReleaseInfoOptions {
  applicationPath: string;
  appVersion: string;
  isPackaged: boolean;
  readTextFile?: (path: string) => Promise<string>;
}

export async function readDesktopReleaseInfo(
  options: ReadDesktopReleaseInfoOptions,
): Promise<Readonly<DesktopReleaseInfo> | undefined> {
  if (!options.isPackaged) {
    return undefined;
  }

  const read = options.readTextFile ?? ((path) => readFile(path, 'utf8'));
  try {
    return parseDesktopReleaseInfo(
      JSON.parse(
        await read(join(options.applicationPath, 'dist', 'release-info.json')),
      ) as unknown,
      options.appVersion,
    );
  } catch {
    throw new Error('PACKAGED_RELEASE_INFO_INVALID');
  }
}
