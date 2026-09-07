import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createInstallerProductCode, INSTALLER_UPGRADE_CODE } from '../installerIdentity.mjs';
import { createInstallerManifest, writeInstallerManifest } from '../installerManifest.mjs';
import { createW6b2SyntheticReleasePair } from '../scripts/w6b2SyntheticWindowsPackageFixture.mjs';
import { buildWorkspaceSuccessArtifact } from './buildWorkspaceSuccessArtifact.mjs';
import { hashWorkspaceSuccessArtifactFile } from './workspaceSuccessArtifact.mjs';
import { WORKSPACE_SUCCESS_DESCRIPTOR_FILENAME } from './workspaceSuccessArtifactDescriptor.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const REVISION = '0123456789abcdef0123456789abcdef01234567';

// Small independent bytes, never an executable or installable MSI.
export async function createWorkspaceSuccessArtifactTestFixture(t, { build = true, temporaryRoot = tmpdir() } = {}) {
  const root = await realpath(await mkdtemp(resolve(temporaryRoot, 'eky-v26-artifact-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const canonical = JSON.parse(await readFile(resolve(ROOT, '../installer-release.json'), 'utf8'));
  const releases = createW6b2SyntheticReleasePair(canonical);
  const pair = { buildRevision: REVISION.slice(0, 12), upgradeCode: INSTALLER_UPGRADE_CODE };
  for (const roleName of ['source', 'target']) {
    const roleRoot = resolve(root, `staged-${roleName}`);
    await mkdir(roleRoot);
    const release = releases[roleName];
    const installerPath = resolve(roleRoot, `Eky-${release.appVersion}-x64.msi`);
    await writeFile(installerPath, `Synthetic ${roleName} package bytes`, { flag: 'wx' });
    const manifestPath = resolve(roleRoot, 'manifest.json');
    const manifest = await createInstallerManifest({ buildRevision: pair.buildRevision, installerPath, release });
    await writeInstallerManifest(manifestPath, manifest);
    const packagedApplicationPath = resolve(roleRoot, 'payload');
    await mkdir(packagedApplicationPath);
    await writeFile(resolve(packagedApplicationPath, 'Eky.exe'), `Synthetic ${roleName} payload`);
    pair[roleName] = { appVersion: release.appVersion, buildRevision: pair.buildRevision,
      installerPath, manifestPath, packagedApplicationPath,
      productCode: createInstallerProductCode(release.msiProductVersion),
      packageSha256: manifest.packageSha256, packageSize: manifest.packageSize };
  }
  let buildCount = 0;
  const artifactRoot = resolve(root, 'artifact');
  const options = { artifactRoot, readGitState: async () => REVISION,
    createInstallerPair: async () => { buildCount += 1; return pair; } };
  const summary = build ? await buildWorkspaceSuccessArtifact(options) : undefined;
  const verification = { artifactRoot, expectedBuildRevision: REVISION, expectedDescriptorSha256: summary?.descriptorSha256 };
  const descriptorPath = resolve(artifactRoot, WORKSPACE_SUCCESS_DESCRIPTOR_FILENAME);
  return { root, pair, options, summary, verification, artifactRoot, descriptorPath,
    getBuildCount: () => buildCount,
    async descriptor() { return JSON.parse(await readFile(descriptorPath, 'utf8')); },
    async rewriteDescriptor(value) {
      await writeFile(descriptorPath, JSON.stringify(value));
      verification.expectedDescriptorSha256 = (await hashWorkspaceSuccessArtifactFile(descriptorPath)).sha256;
    },
  };
}
