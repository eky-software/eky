import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createE2eRunRoot } from '../../../e2e/src/environment/createE2eRunRoot.ts';
import { buildProfileInspectionNative } from '../../../backend/scripts/build-profile-inspection-native.mjs';
import { profileInspectionNativeContract } from '../../../backend/src/database/connection/profileInspectionNativeContract.ts';
import { inspectionProofPaths, inspectionProofVariants, parseInspectionProofConfig } from './linuxProfileInspectionContract.mjs';
import { linuxProfileInspectionPaths } from '../../../e2e/experiments/processOwnership/linuxServiceContract.mjs';
import { readInspectionSourceIdentity } from './linuxProfileInspectionCase.mjs';

export const inspectionNativeFailureMaximumBytes = 64 * 1024;

export async function readInspectionNativeBuildFailure(root, identity) {
  const same = (left, right) => left.dev === right.dev && left.ino === right.ino &&
    left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs &&
    left.nlink === right.nlink;
  const directory = async path => {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() ||
      info.gid !== process.getgid() || (info.mode & 0o7777) !== 0o700 || await realpath(path) !== path) {
      throw Error('INSPECTION_NATIVE_EVIDENCE_UNVERIFIED');
    }
    return info;
  };
  try {
    const before = await directory(root);
    if (before.dev !== identity.dev || before.ino !== identity.ino) throw Error('INSPECTION_NATIVE_EVIDENCE_UNVERIFIED');
    const entries = await readdir(root, { withFileTypes: true });
    if (entries.length === 0) return { status: 'missing' };
    if (entries.length !== 1 || !entries[0].isDirectory() ||
      !/^inspection-native-[A-Za-z0-9]{6}$/u.test(entries[0].name)) throw Error('INSPECTION_NATIVE_EVIDENCE_UNVERIFIED');
    const work = join(root, entries[0].name);
    const workBefore = await directory(work);
    const path = join(work, 'build.private.log');
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 ||
      info.uid !== process.getuid() || info.gid !== process.getgid() ||
      (info.mode & 0o7777) !== 0o600 || !Number.isSafeInteger(info.size) || info.size < 1) {
      throw Error('INSPECTION_NATIVE_EVIDENCE_UNVERIFIED');
    }
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (!same(info, await handle.stat())) throw Error('INSPECTION_NATIVE_EVIDENCE_UNVERIFIED');
      // Large logs retain only their start and end, never the omitted middle.
      const complete = info.size <= inspectionNativeFailureMaximumBytes;
      const prefix = Buffer.alloc(complete ? info.size : inspectionNativeFailureMaximumBytes / 2);
      const suffix = Buffer.alloc(complete ? 0 : inspectionNativeFailureMaximumBytes / 2);
      const first = await handle.read(prefix, 0, prefix.length, 0);
      const last = suffix.length === 0 ? { bytesRead: 0 }
        : await handle.read(suffix, 0, suffix.length, info.size - suffix.length);
      if (first.bytesRead !== prefix.length || last.bytesRead !== suffix.length ||
        !same(info, await handle.stat()) || !same(info, await lstat(path)) ||
        !same(workBefore, await directory(work)) || !same(before, await directory(root))) {
        throw Error('INSPECTION_NATIVE_EVIDENCE_UNVERIFIED');
      }
      return { status: 'retained', complete, sourceBytes: info.size,
        retainedBytes: prefix.length + suffix.length,
        prefixBase64: prefix.toString('base64'), suffixBase64: suffix.toString('base64') };
    } finally { await handle.close(); }
  } catch (error) { return { status: error.code === 'ENOENT' ? 'missing' : 'unverified' }; }
}

export async function inspectionPreparationEvidence(failure, { root, identity, mode }) {
  if (mode !== 'sandboxProbe' || failure.phase !== 'preparation' ||
    failure.causeCode !== 'PROFILE_INSPECTION_NATIVE_BUILD_FAILED' || !root || !identity) return failure;
  return { ...failure, nativeCompilationEvidence: await readInspectionNativeBuildFailure(root, identity) };
}

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
