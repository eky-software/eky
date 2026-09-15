import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  rename,
  rm,
} from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  readInstallerManifest,
  verifyInstallerManifestPackage,
} from '../installerManifest.mjs';

async function requireRegularFile(path, { independent }) {
  try {
    const metadata = await lstat(path, { bigint: true });
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size < 1n ||
      (independent && metadata.nlink !== 1n)
    ) {
      throw new Error('WINDOWS_ACCEPTANCE_BUILD_OUTPUT_INVALID');
    }
    return metadata;
  } catch {
    throw new Error('WINDOWS_ACCEPTANCE_BUILD_OUTPUT_INVALID');
  }
}

export async function detachWindowsInstallerBuildOutput(manifestInputPath) {
  const manifestPath = resolve(manifestInputPath);
  await requireRegularFile(manifestPath, { independent: true });
  const manifest = await readInstallerManifest(manifestPath);
  const installerPath = resolve(
    dirname(manifestPath),
    manifest.packageFilename,
  );
  if (dirname(installerPath) !== dirname(manifestPath)) {
    throw new Error('WINDOWS_ACCEPTANCE_BUILD_OUTPUT_INVALID');
  }
  const sourceMetadata = await requireRegularFile(installerPath, {
    independent: false,
  });
  await verifyInstallerManifestPackage({ installerPath, manifest });
  if (sourceMetadata.nlink === 1n) {
    return Object.freeze({ detached: false, installerPath, manifestPath });
  }

  const detachRoot = resolve(
    dirname(manifestPath),
    `.v2-artifact-detach-${randomUUID()}`,
  );
  let detachRootCreated = false;
  try {
    await mkdir(detachRoot, { recursive: false });
    detachRootCreated = true;
    const detachedInstallerPath = resolve(
      detachRoot,
      manifest.packageFilename,
    );
    await copyFile(
      installerPath,
      detachedInstallerPath,
      constants.COPYFILE_EXCL,
    );
    await requireRegularFile(detachedInstallerPath, { independent: true });
    await verifyInstallerManifestPackage({
      installerPath: detachedInstallerPath,
      manifest,
    });
    await rename(detachedInstallerPath, installerPath);
    await requireRegularFile(installerPath, { independent: true });
    await verifyInstallerManifestPackage({ installerPath, manifest });
    return Object.freeze({ detached: true, installerPath, manifestPath });
  } finally {
    if (detachRootCreated) {
      await rm(detachRoot, { force: true, recursive: true }).catch(
        () => undefined,
      );
    }
  }
}
