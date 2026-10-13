import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { buildProfileInspectionNative } from '../../backend/scripts/build-profile-inspection-native.mjs';
import { profileInspectionNativeContract as contract } from '../../backend/src/database/connection/profileInspectionNativeContract.ts';

export async function prepareProfileInspectionNativeStage({
  backendStage,
  buildRoot,
  nativeStage,
}) {
  const delivery = await import(pathToFileURL(resolve(backendStage,
    'dist/database/connection/deliverProfileInspectionNativeResource.js')).href);
  const built = await buildProfileInspectionNative({
    buildRoot,
    outputRoot: join(buildRoot, `resource-${randomUUID()}`),
    npmRoot: resolve(dirname(process.execPath), 'node_modules/npm'),
  });
  const result = await delivery.deliverProfileInspectionNativeResource(
    built.outputRoot, nativeStage, { platform: 'win32', arch: 'x64' },
  );
  return result.metadata;
}

export async function verifyPackagedProfileInspectionNative({ packagedPath, expectedMetadata }) {
  const resources = resolve(packagedPath, 'resources');
  const inspector = await import(pathToFileURL(resolve(resources,
    'backend/dist/database/connection/inspectProfileInspectionNativeResource.js')).href);
  const result = await inspector.inspectProfileInspectionNativeResource(
    resolve(resources, contract.directoryName), { platform: 'win32', arch: 'x64' },
  );
  if (expectedMetadata === undefined ||
      JSON.stringify(result.metadata) !== JSON.stringify(expectedMetadata)) {
    throw new Error('PROFILE_INSPECTION_NATIVE_DELIVERY_INVALID');
  }
  return result.metadata;
}
