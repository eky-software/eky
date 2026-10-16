import { spawnSync } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  parseProfileInspectionNativeMetadata,
  profileInspectionNativeContract as contract,
} from '../src/database/connection/profileInspectionNativeContract.ts';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const maximumArchiveBytes = 32 * 1024 * 1024;
const buildTimeoutMs = 300_000;
export class InspectionNativeCompilationFailure extends Error {
  #logSettled;
  constructor(logSettled = false) {
    super('PROFILE_INSPECTION_NATIVE_BUILD_FAILED');
    this.#logSettled = logSettled;
  }
  get logSettled() { return this.#logSettled; }
}

export function inspectionNativeCompilationFailure(result) {
  // Only an observed normal nonzero compiler exit authorizes its settled log.
  const failure = new InspectionNativeCompilationFailure(!result.error && result.signal === null &&
    Number.isInteger(result.status) && result.status > 0);
  if (result.error?.code === 'ETIMEDOUT') failure.code = 'ETIMEDOUT';
  return failure;
}
const buildEnvironmentNames = new Set([
  'path', 'systemroot', 'windir', 'comspec', 'os', 'temp', 'tmp', 'tmpdir',
  'home', 'userprofile', 'appdata', 'localappdata',
  'vcinstalldir', 'vsinstalldir', 'vctoolsinstalldir', 'vscmd_ver', 'vscmd_arg_tgt_arch',
  'windowssdkversion', 'windowssdkdir', 'windowssdklibversion', 'universalcrtsdkdir',
  'ucrtversion', 'include', 'lib', 'libpath',
]);

export function createInspectionNativeBuildEnvironment(environment, configurationRoot) {
  if (typeof configurationRoot !== 'string' || !isAbsolute(configurationRoot)) {
    throw new Error('PROFILE_INSPECTION_NATIVE_TOOLCHAIN_INVALID');
  }
  const selected = {};
  for (const [name, value] of Object.entries(environment)) {
    const normalized = name.toLowerCase();
    if (!buildEnvironmentNames.has(normalized) || typeof value !== 'string') continue;
    const key = process.platform === 'win32' ? normalized : name;
    if (Object.hasOwn(selected, key) && selected[key] !== value) {
      throw new Error('PROFILE_INSPECTION_NATIVE_TOOLCHAIN_INVALID');
    }
    selected[key] = value;
  }
  return { ...selected, NODE_OPTIONS: '', npm_config_ignore_scripts: 'true',
    GYP_CONFIG_DIR: configurationRoot, PYTHONNOUSERSITE: '1', PYTHONSAFEPATH: '1' };
}

async function assertBuildDirectory(path) {
  for (let current = resolve(path); ; current = dirname(current)) {
    const stats = await lstat(current);
    if (!stats.isDirectory() || stats.isSymbolicLink() ||
        relative(current, await realpath(current)) !== '') {
      throw new Error('PROFILE_INSPECTION_NATIVE_TOOLCHAIN_INVALID');
    }
    if (dirname(current) === current) return;
  }
}

export async function copyInspectionNativeBuildOutput(work) {
  if (typeof work !== 'string' || !isAbsolute(work)) {
    throw new Error('PROFILE_INSPECTION_NATIVE_BUILD_FAILED');
  }
  const built = join(work, 'source', 'build', 'Release', contract.fileName);
  const alias = join(dirname(built), 'obj.target', contract.fileName);
  const minimumSize = BigInt(contract.minimumNativeBytes);
  const maximumSize = BigInt(contract.maximumNativeBytes);
  const sameIdentity = (left, right) => left.dev === right.dev && left.ino === right.ino &&
    left.size === right.size && left.nlink === right.nlink && left.mtimeNs === right.mtimeNs;
  const inspect = async (path, links) => {
    await assertBuildDirectory(dirname(path));
    const stats = await lstat(path, { bigint: true });
    if (!stats.isFile() || stats.isSymbolicLink() || !links.includes(stats.nlink) ||
        stats.size < minimumSize || stats.size > maximumSize ||
        relative(path, await realpath(path)) !== '') {
      throw new Error('PROFILE_INSPECTION_NATIVE_BUILD_FAILED');
    }
    return stats;
  };
  try {
    const before = await inspect(built, [1n, 2n]);
    if (before.nlink === 2n && !sameIdentity(before, await inspect(alias, [2n]))) {
      throw new Error('PROFILE_INSPECTION_NATIVE_BUILD_FAILED');
    }
    const sourceHash = createHash('sha256').update(await readFile(built)).digest('hex');
    // Linux node-gyp may link its two build-owned outputs. Never ship that identity.
    const isolatedRoot = join(work, 'verified-native');
    await mkdir(isolatedRoot, { mode: 0o700 });
    const isolated = join(isolatedRoot, contract.fileName);
    await copyFile(built, isolated, constants.COPYFILE_EXCL);
    const after = await inspect(built, [before.nlink]);
    const copied = await inspect(isolated, [1n]);
    if (!sameIdentity(before, after) ||
        (copied.dev === before.dev && copied.ino === before.ino) ||
        copied.size !== before.size ||
        createHash('sha256').update(await readFile(built)).digest('hex') !== sourceHash ||
        createHash('sha256').update(await readFile(isolated)).digest('hex') !== sourceHash ||
        (before.nlink === 2n && !sameIdentity(after, await inspect(alias, [2n])))) {
      throw new Error('PROFILE_INSPECTION_NATIVE_BUILD_FAILED');
    }
    return isolated;
  } catch (error) {
    throw new Error('PROFILE_INSPECTION_NATIVE_BUILD_FAILED', { cause: error });
  }
}

export function patchInspectionMemoryAccounting(contents) {
  if (typeof contents !== 'string' || contents.split(contract.sourceDefine).length !== 2 ||
      contents.includes(contract.targetDefine)) throw new Error('PROFILE_INSPECTION_NATIVE_SOURCE_INVALID');
  return contents.replace(contract.sourceDefine, contract.targetDefine);
}

export function verifyInspectionSourceArchive(bytes, integrity) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > maximumArchiveBytes ||
      !/^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity)) {
    throw new Error('PROFILE_INSPECTION_NATIVE_SOURCE_INVALID');
  }
  const expected = Buffer.from(integrity.slice('sha512-'.length), 'base64');
  const actual = createHash('sha512').update(bytes).digest();
  if (!timingSafeEqual(expected, actual)) throw new Error('PROFILE_INSPECTION_NATIVE_SOURCE_INVALID');
}

async function fetchSource(packageName, version, integrity, archivePath) {
  const response = await fetch(`https://registry.npmjs.org/${packageName}/-/${packageName}-${version}.tgz`, {
    redirect: 'error', signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok || response.body === null) throw new Error('PROFILE_INSPECTION_NATIVE_SOURCE_INVALID');
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.byteLength;
    if (length > maximumArchiveBytes) throw new Error('PROFILE_INSPECTION_NATIVE_SOURCE_INVALID');
    chunks.push(Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks);
  verifyInspectionSourceArchive(bytes, integrity);
  await writeFile(archivePath, bytes, { flag: 'wx', mode: 0o600 });
}

function runTool(command, args, cwd, env, timeout = buildTimeoutMs) {
  const result = spawnSync(command, args, {
    cwd, env, shell: false, windowsHide: true, timeout,
    encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  });
  return { result, ok: result.status === 0 && result.signal === null && result.error === undefined };
}

async function sourceFiles(root, parent = '') {
  const rows = [];
  for (const entry of await readdir(join(root, parent), { withFileTypes: true })) {
    const path = join(parent, entry.name);
    const metadata = await lstat(join(root, path));
    if (metadata.isSymbolicLink()) throw new Error('PROFILE_INSPECTION_NATIVE_SOURCE_INVALID');
    if (metadata.isDirectory()) rows.push(...await sourceFiles(root, path));
    else if (metadata.isFile() && metadata.nlink === 1) rows.push(path);
    else throw new Error('PROFILE_INSPECTION_NATIVE_SOURCE_INVALID');
  }
  return rows.sort();
}

async function sourceIdentity(root, paths) {
  const hash = createHash('sha256').update('Eky inspection native source v1\0');
  for (const path of paths) {
    const bytes = await readFile(join(root, path));
    hash.update(JSON.stringify([path.replaceAll('\\', '/'), bytes.length]));
    hash.update(createHash('sha256').update(bytes).digest());
  }
  return hash.digest('hex');
}

async function extractSource({ archive, destination, tarExecutable, env }) {
  await mkdir(destination, { mode: 0o700 });
  const extracted = runTool(tarExecutable, ['-xzf', archive, '--strip-components=1', '-C', destination],
    dirname(destination), env, 60_000);
  if (!extracted.ok) throw new Error('PROFILE_INSPECTION_NATIVE_SOURCE_INVALID');
  return sourceFiles(destination);
}

export async function buildProfileInspectionNative({
  buildRoot,
  outputRoot,
  npmRoot,
  tarExecutable = process.platform === 'win32' ? 'tar.exe' : 'tar',
  environment = process.env,
}) {
  if (process.versions.node !== contract.nodeVersion || process.arch !== 'x64' ||
      !['win32', 'linux'].includes(process.platform) ||
      ![buildRoot, outputRoot, npmRoot].every(path => typeof path === 'string' && isAbsolute(path))) {
    throw new Error('PROFILE_INSPECTION_NATIVE_TOOLCHAIN_INVALID');
  }
  const outputRelative = relative(buildRoot, outputRoot);
  if (outputRelative === '' || outputRelative === '..' || outputRelative.startsWith('../') ||
      outputRelative.startsWith('..\\') || isAbsolute(outputRelative)) {
    throw new Error('PROFILE_INSPECTION_NATIVE_TOOLCHAIN_INVALID');
  }
  const nodeGypRoot = join(npmRoot, 'node_modules', 'node-gyp');
  const nodeGyp = join(nodeGypRoot, 'bin', 'node-gyp.js');
  const gypMetadata = JSON.parse(await readFile(join(nodeGypRoot, 'package.json'), 'utf8'));
  if (gypMetadata.name !== 'node-gyp' || gypMetadata.version !== contract.nodeGypVersion) {
    throw new Error('PROFILE_INSPECTION_NATIVE_TOOLCHAIN_INVALID');
  }
  // The caller supplies a build-owned parent. Never reuse or delete an old attempt.
  await mkdir(buildRoot, { recursive: true, mode: 0o700 });
  await assertBuildDirectory(buildRoot);
  await assertBuildDirectory(dirname(outputRoot));
  const work = await mkdtemp(join(buildRoot, 'inspection-native-'));
  // GYP must not discover ~/.gyp/include.gypi from the developer or CI account.
  const configurationRoot = join(work, 'gyp-config');
  await mkdir(configurationRoot, { mode: 0o700 });
  const env = createInspectionNativeBuildEnvironment(environment, configurationRoot);
  const source = join(work, 'source');
  const archive = join(work, 'better-sqlite3.tgz');
  await fetchSource('better-sqlite3', contract.packageVersion, contract.sourceIntegrity, archive);
  const sourcePaths = await extractSource({ archive, destination: source, tarExecutable, env });
  const upstreamMetadata = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
  if (upstreamMetadata.name !== 'better-sqlite3' || upstreamMetadata.version !== contract.packageVersion) {
    throw new Error('PROFILE_INSPECTION_NATIVE_SOURCE_INVALID');
  }
  const originalIdentity = await sourceIdentity(source, sourcePaths);
  const definesPath = join(source, 'deps', 'defines.gypi');
  await writeFile(definesPath, patchInspectionMemoryAccounting(await readFile(definesPath, 'utf8')));
  const patchedIdentity = await sourceIdentity(source, sourcePaths);
  const addonArchive = join(work, 'node-addon-api.tgz');
  await fetchSource('node-addon-api', contract.addonApiVersion, contract.addonApiIntegrity, addonArchive);
  await mkdir(join(source, 'node_modules'), { mode: 0o700 });
  const addon = join(source, 'node_modules', 'node-addon-api');
  const addonPaths = await extractSource({ archive: addonArchive, destination: addon, tarExecutable, env });
  const addonIdentity = await sourceIdentity(addon, addonPaths);
  const addonMetadata = JSON.parse(await readFile(join(addon, 'package.json'), 'utf8'));
  if (addonMetadata.name !== 'node-addon-api' || addonMetadata.version !== contract.addonApiVersion) {
    throw new Error('PROFILE_INSPECTION_NATIVE_SOURCE_INVALID');
  }
  const compilation = runTool(process.execPath, [nodeGyp, 'rebuild', '--release', '--force_build=1',
    `--target=${contract.nodeVersion}`, '--arch=x64', '--jobs=2',
    `--devdir=${join(work, 'node-headers')}`], source, env);
  await writeFile(join(work, 'build.private.log'),
    `${compilation.result.stdout ?? ''}\n${compilation.result.stderr ?? ''}`, { flag: 'wx', mode: 0o600 });
  if (!compilation.ok) throw inspectionNativeCompilationFailure(compilation.result);
  if (await sourceIdentity(source, sourcePaths) !== patchedIdentity ||
      await sourceIdentity(addon, addonPaths) !== addonIdentity) {
    throw new Error('PROFILE_INSPECTION_NATIVE_SOURCE_INVALID');
  }
  const builtNative = await copyInspectionNativeBuildOutput(work);
  const stats = await lstat(builtNative);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 ||
      stats.size < contract.minimumNativeBytes || stats.size > contract.maximumNativeBytes ||
      relative(builtNative, await realpath(builtNative)) !== '') {
    throw new Error('PROFILE_INSPECTION_NATIVE_BUILD_FAILED');
  }
  const backendRequire = createRequire(join(backendRoot, 'package.json'));
  if (backendRequire('better-sqlite3/package.json').version !== contract.packageVersion) {
    throw new Error('PROFILE_INSPECTION_NATIVE_TOOLCHAIN_INVALID');
  }
  const Database = backendRequire('better-sqlite3');
  const database = new Database(':memory:', { nativeBinding: builtNative });
  let sqliteSourceId;
  let compileOptions;
  try {
    sqliteSourceId = database.prepare('SELECT sqlite_source_id() AS id').get().id;
    compileOptions = database.pragma('compile_options').map(row => row.compile_options).sort();
    // SQLite omits DEFAULT_MEMSTATUS=1 from compile_options because it is the default.
    if (compileOptions.includes('DEFAULT_MEMSTATUS=0') ||
        database.prepare('SELECT 40 + 2 AS value').get().value !== 42) {
      throw new Error('PROFILE_INSPECTION_NATIVE_BUILD_FAILED');
    }
  } finally { database.close(); }
  const metadata = parseProfileInspectionNativeMetadata({
    schemaVersion: contract.schemaVersion, purpose: contract.purpose,
    packageVersion: contract.packageVersion, addonApiVersion: contract.addonApiVersion,
    sourceIntegrity: contract.sourceIntegrity, addonApiIntegrity: contract.addonApiIntegrity,
    patchIdentity: contract.patchIdentity, sourceIdentity: originalIdentity,
    patchedSourceIdentity: patchedIdentity, platform: process.platform, arch: process.arch,
    nodeVersion: contract.nodeVersion, nodeGypVersion: contract.nodeGypVersion,
    napiVersion: contract.napiVersion, sqliteSourceId, compileOptions,
    nativeSize: stats.size,
    nativeSha256: createHash('sha256').update(await readFile(builtNative)).digest('hex'),
  }, { platform: process.platform, arch: process.arch });
  // Ship only the independent binary bytes and bounded provenance, not the source/tools/log.
  await assertBuildDirectory(dirname(outputRoot));
  await mkdir(outputRoot, { mode: 0o700 });
  await copyFile(builtNative, join(outputRoot, contract.fileName), constants.COPYFILE_EXCL);
  await writeFile(join(outputRoot, contract.metadataFileName), `${JSON.stringify(metadata, null, 2)}\n`,
    { flag: 'wx', mode: 0o600 });
  return Object.freeze({ outputRoot, metadata });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [buildRoot, outputRoot, npmRoot] = process.argv.slice(2);
  try {
    await buildProfileInspectionNative({ buildRoot, outputRoot, npmRoot });
    console.log('PROFILE_INSPECTION_NATIVE_BUILD_COMPLETED');
  } catch {
    console.error('PROFILE_INSPECTION_NATIVE_BUILD_FAILED');
    process.exitCode = 1;
  }
}
