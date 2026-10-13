import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { join } from 'node:path';

import type { W6b2PackagedProofConfiguration } from './w6b2PackagedProof.js';

export const W6B2_INSTALLER_LOG_FILE = 'target-installer.private.log';
export const W6B2_INSTALLER_LOG_RECEIPT = 'target-installer-retention.private.json';
export const W6B2_INSTALLER_LOG_MAX_BYTES = 64 * 1024 * 1024;

// Only the marker-validated synthetic source handoff enables native MSI logging.
export async function prepareW6b2PackagedInstallerLog(
  configuration: Readonly<W6b2PackagedProofConfiguration> | undefined,
): Promise<string | undefined> {
  if (configuration === undefined) return undefined;
  if (!configuration.enabled || configuration.role !== 'source' ||
      configuration.phase !== 'sourceHandoff') {
    throw new Error('W6B2_PROOF_CONFIGURATION_INVALID');
  }
  const directory = join(configuration.root, 'result');
  for (const path of [configuration.root, directory]) {
    if (path === directory) {
      try { await mkdir(directory, { mode: 0o700 }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== path) {
      throw new Error('W6B2_PROOF_CONFIGURATION_INVALID');
    }
  }
  const path = join(directory, W6B2_INSTALLER_LOG_FILE);
  const handle = await open(path, 'wx', 0o600);
  await handle.close();
  return path;
}
