import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { ProfileInspectionDeployment } from '../runtime/profileInspectionMessages.js';

/** Read only the delivered resource contract; main never loads the SQLite driver. */
export async function createProfileInspectionDeployment(input: {
  readonly backendRoot: string;
  readonly resourcesRoot: string;
}): Promise<ProfileInspectionDeployment> {
  const module: unknown = await import(pathToFileURL(join(input.backendRoot,
    'dist', 'database', 'connection', 'profileInspectionNativeContract.js')).href);
  if (!isRecord(module) || !isRecord(module.profileInspectionNativeContract)) {
    throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
  }
  const directoryName = module.profileInspectionNativeContract.directoryName;
  if (typeof directoryName !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(directoryName)) {
    throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
  }
  return Object.freeze({
    backendRoot: input.backendRoot,
    migrationsDirectory: join(input.backendRoot, 'dist', 'database', 'migrations'),
    nativeResourceRoot: join(input.resourcesRoot, directoryName),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
