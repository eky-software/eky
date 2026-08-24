import { isAbsolute } from 'node:path';

export async function preparePackageBackendStage({
  backendStage,
  prepareBackendStage,
}) {
  if (typeof backendStage !== 'string' || !isAbsolute(backendStage)) {
    throw new Error('PACKAGE_BACKEND_STAGE_INVALID');
  }
  if (prepareBackendStage === undefined) {
    return;
  }
  if (typeof prepareBackendStage !== 'function') {
    throw new Error('PACKAGE_BACKEND_STAGE_PREPARATION_INVALID');
  }

  await prepareBackendStage(backendStage);
}
