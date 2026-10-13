import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createE2eRunRoot } from '../../../e2e/src/environment/createE2eRunRoot.ts';
import { buildProfileInspectionNative } from '../../../backend/scripts/build-profile-inspection-native.mjs';
import { profileInspectionNativeContract } from '../../../backend/src/database/connection/profileInspectionNativeContract.ts';
import { inspectionProofPaths, inspectionProofVariants, parseInspectionProofConfig } from './linuxProfileInspectionContract.mjs';
import { linuxProfileInspectionPaths } from '../../../e2e/experiments/processOwnership/linuxServiceContract.mjs';
import { readInspectionSourceIdentity } from './linuxProfileInspectionCase.mjs';

export async function prepareMissingInspectionResource(root) {
  // Preserve the loader's canonical directory boundary; omit only its payload.
  await mkdir(join(root, 'missing-resources', profileInspectionNativeContract.directoryName), { mode: 0o700 });
}

// Fixture SQL runs in Node preparation, never inside Electron main.
export async function prepareLinuxInspectionProof(repository, hostTempRoot, nativeBuildRoot) {
  const backend = join(repository, 'apps/backend');
  const load = relative => import(pathToFileURL(join(backend, 'dist', relative)));
  const { runMigrations } = await load('database/migration/runMigrations.js');
  const { readMigrationManifest } = await load('database/migration/migrationManifest.js');
  const { createActiveProfileInspectionContextReader } = await load('runtime/profileSnapshot/activeProfileInspectionContext.js');
  const { deliverProfileInspectionNativeResource } = await load('database/connection/deliverProfileInspectionNativeResource.js');
  const Database = createRequire(join(backend, 'package.json'))('better-sqlite3');
  const migrationsDirectory = join(backend, 'dist/database/migrations');
  const manifest = readMigrationManifest(migrationsDirectory);
  const built = await buildProfileInspectionNative({ buildRoot: nativeBuildRoot,
    outputRoot: join(nativeBuildRoot, `resource-${randomUUID()}`),
    npmRoot: resolve(dirname(process.execPath), '../lib/node_modules/npm') });
  const fixtures = [];
  for (const variant of inspectionProofVariants) {
    const runRoot = createE2eRunRoot();
    const base = linuxProfileInspectionPaths(runRoot);
    const operationId = randomUUID();
    const operationRoot = join(base.root, 'staging', operationId);
    await mkdir(operationRoot, { recursive: true, mode: 0o700 });
    for (const name of ['temp', 'resources', 'missing-resources', 'electron-profile', 'electron-crash']) {
      await mkdir(join(base.root, name), { mode: 0o700 });
    }
    if (variant !== 'missingNative') await deliverProfileInspectionNativeResource(built.outputRoot,
      join(base.root, 'resources', profileInspectionNativeContract.directoryName), { platform: 'linux', arch: 'x64' });
    else await prepareMissingInspectionResource(base.root);
    const database = new Database(':memory:');
    let activeContext;
    try {
      await runMigrations(database, { migrationsDirectory });
      activeContext = createActiveProfileInspectionContextReader(database).readProfileInspectionContext();
      if (variant === 'schemaChanged') database.exec('CREATE VIEW unexpected_inspection_proof_view AS SELECT 1');
      await database.backup(join(operationRoot, 'profile.sqlite'));
    } finally { database.close(); }
    await writeFile(join(operationRoot, 'snapshot-catalog-v1.json'), JSON.stringify({ formatVersion: 1, artifacts: [] }),
      { flag: 'wx', mode: 0o600 });
    const config = { schemaVersion: 1, generation: randomUUID(), variant, operationId, activeContext,
      expected: { database: await readInspectionSourceIdentity(join(operationRoot, 'profile.sqlite')),
        artifactCatalog: await readInspectionSourceIdentity(join(operationRoot, 'snapshot-catalog-v1.json')),
        migrationChainIdentity: manifest.at(-1).chainSha256 } };
    parseInspectionProofConfig(JSON.stringify(config));
    const paths = inspectionProofPaths(base.config, config, hostTempRoot);
    await writeFile(paths.config, JSON.stringify(config), { flag: 'wx', mode: 0o600 });
    fixtures.push({ config, paths });
  }
  return fixtures;
}
