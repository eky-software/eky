import * as filesystem from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnvironment, exactKeys } from './pidNamespaceContract.mjs';
import { inspectManagedRoot, managedControlPath } from './managedNamespaceRoot.mjs';
import { below, guardLinuxService, linuxServiceLimits, requireService, servicePath,
  validateServiceConfig, linuxChromiumPaths, linuxChromiumBrowserConfig, linuxChromiumServerEntry,
  serviceFailure } from './linuxServiceContract.mjs';
import { chromiumControlMaximumBytes, chromiumWorkerProtocol } from '../../src/environment/chromiumWorkerContract.mjs';

export const linuxServiceInitPath = fileURLToPath(new URL('./linuxServiceInit.mjs', import.meta.url));
const configName = 'service.json';

export function inspectServicePath(path, directory, fs = filesystem) {
  servicePath(path);
  let current = '/';
  const segments = path.slice(1).split('/');
  for (let index = 0; index < segments.length; index++) {
    current = posix.join(current, segments[index]);
    const stat = fs.lstatSync(current);
    requireService(!stat.isSymbolicLink() && (index < segments.length - 1 || directory
      ? stat.isDirectory() : stat.isFile()));
  }
  requireService(fs.realpathSync(path) === path);
  return path;
}

function readBoundedFile(path, limit, fs, privateIdentity) {
  const before = fs.lstatSync(path);
  requireService(before.isFile() && !before.isSymbolicLink() && before.size > 0 && before.size <= limit);
  if (privateIdentity) requireService(before.nlink === 1 && before.uid === privateIdentity.uid &&
    before.gid === privateIdentity.gid && (before.mode & 0o7777) === 0o600);
  const fd = fs.openSync(path, filesystem.constants.O_RDONLY | filesystem.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd);
    const same = stat => stat.dev === before.dev && stat.ino === before.ino && stat.size === before.size &&
      stat.mtimeMs === before.mtimeMs && stat.ctimeMs === before.ctimeMs && stat.nlink === before.nlink;
    requireService(same(opened));
    const bytes = Buffer.alloc(limit + 1);
    const count = fs.readSync(fd, bytes, 0, bytes.length, 0);
    requireService(count === before.size && count <= limit && same(fs.fstatSync(fd)) && same(fs.lstatSync(path)));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, count));
  } finally { fs.closeSync(fd); }
}

export function resolveLinuxViteEntrypoint(repositoryRoot, fs = filesystem) {
  const web = inspectServicePath(posix.join(repositoryRoot, 'apps/web'), true, fs);
  inspectServicePath(posix.join(web, 'vite.config.ts'), false, fs);
  const selector = posix.join(inspectServicePath(posix.join(web, 'node_modules'), true, fs), 'vite');
  requireService(fs.lstatSync(selector).isSymbolicLink());
  const target = inspectServicePath(posix.resolve(posix.dirname(selector), fs.readlinkSync(selector)), true, fs);
  requireService(target === fs.realpathSync(selector));
  const store = inspectServicePath(posix.join(repositoryRoot, 'node_modules/.pnpm'), true, fs);
  const segments = posix.relative(store, below(target, store)).split('/');
  requireService(segments.length === 3 && segments[0].startsWith('vite@') &&
    segments[1] === 'node_modules' && segments[2] === 'vite');
  const manifest = JSON.parse(readBoundedFile(inspectServicePath(posix.join(target, 'package.json'), false, fs),
    linuxServiceLimits.config, fs));
  requireService(manifest.name === 'vite' && typeof manifest.version === 'string' &&
    /^[A-Za-z0-9.+-]{1,64}$/u.test(manifest.version) &&
    (segments[0] === `vite@${manifest.version}` || segments[0].startsWith(`vite@${manifest.version}_`)) &&
    manifest.bin && Object.keys(manifest.bin).length === 1 && manifest.bin.vite === 'bin/vite.js');
  return inspectServicePath(posix.join(target, 'bin/vite.js'), false, fs);
}

// No command, argument vector or inherited environment is accepted from callers.
export function linuxServiceWorkload(config, { fs = filesystem, tempDirectory = tmpdir, preparing = false } = {}) {
  validateServiceConfig(config);
  const repository = inspectServicePath(config.repositoryRoot, true, fs);
  const run = inspectServicePath(config.runRoot, true, fs);
  const hostTempRoot = fs.realpathSync(tempDirectory());
  requireService(posix.dirname(run) === posix.join(hostTempRoot, 'eky-e2e') &&
    run !== repository && !run.startsWith(repository + '/') && !repository.startsWith(run + '/'));
  const node = inspectServicePath(config.node, false, fs);
  requireService((fs.lstatSync(node).mode & 0o111) !== 0);
  if (config.profile === 'chromium') {
    const browser = inspectServicePath(config.browserExecutable, false, fs);
    requireService((fs.lstatSync(browser).mode & 0o111) !== 0);
    const entry = inspectServicePath(posix.join(repository, linuxChromiumServerEntry), false, fs);
    const paths = linuxChromiumPaths(config);
    if (!preparing) {
      const actual = readLinuxChromiumConfig(paths.config, { fs, identity: config });
      requireService(JSON.stringify(actual) === JSON.stringify(linuxChromiumBrowserConfig(config)));
    }
    return Object.freeze({ file: node, args: Object.freeze([entry, paths.config]), cwd: repository,
      env: Object.freeze({ ...childEnvironment(), NODE_ENV: 'test', TMPDIR: paths.temp, HOME: paths.temp,
        PLAYWRIGHT_BROWSERS_PATH: posix.dirname(posix.dirname(posix.dirname(browser))) }) });
  }
  const temp = inspectServicePath(config.profile === 'backend'
    ? posix.join(posix.dirname(config.runtimeConfigPath), 'temp') : config.environmentRoot, true, fs);
  below(temp, run);
  const env = { ...childEnvironment(), NODE_ENV: 'test', TMPDIR: temp, HOME: temp };
  if (config.profile === 'backend') {
    const entry = inspectServicePath(posix.join(repository, 'apps/backend/e2e-dist/e2e/backendEntrypoint.js'), false, fs);
    const path = inspectServicePath(below(config.runtimeConfigPath, run), false, fs);
    requireService(fs.lstatSync(path).nlink === 1);
    // The config reader validates the original test root independently of the
    // child's isolated OS temp directory, using the existing owner contract.
    return Object.freeze({ file: node, args: Object.freeze([entry, '--config', path]), cwd: repository,
      env: Object.freeze({ ...env, EKY_E2E_OS_TEMP_ROOT: hostTempRoot, TEMP: temp, TMP: temp }) });
  }
  inspectServicePath(below(config.environmentRoot, run), true, fs);
  return Object.freeze({ file: node, args: Object.freeze([resolveLinuxViteEntrypoint(repository, fs),
    '--config', 'vite.config.ts', '--host', '127.0.0.1', '--port', String(config.webPort), '--strictPort',
    '--mode', 'eky-e2e']), cwd: posix.join(repository, 'apps/web'), env: Object.freeze({ ...env,
      EKY_E2E_BACKEND_ORIGIN: config.backendOrigin, EKY_E2E_ENV_ROOT: config.environmentRoot,
      EKY_E2E_RUNTIME_SESSION: config.sessionSecret }) });
}

export function prepareLinuxService(profile, input, {
  runtime = process, fs = filesystem, tempDirectory = tmpdir,
  initPath = linuxServiceInitPath,
  now = () => process.hrtime.bigint(), performanceNow = () => performance.now(), nonce = () => randomBytes(16).toString('hex'),
  browserNonce = () => randomBytes(32).toString('hex'),
} = {}) {
  const identity = guardLinuxService(runtime);
  const anchor = now();
  const startupRemaining = Math.floor(input.startupDeadline - performanceNow());
  const remaining = input.lifetime.readRemainingWorkMilliseconds();
  requireService(typeof anchor === 'bigint' && anchor > 0n && Number.isSafeInteger(remaining) &&
    remaining > 0 && remaining <= 2_147_483_647 && Number.isSafeInteger(startupRemaining) && startupRemaining > 0,
  'startupDeadlineExceeded');
  const config = {
    version: 1, profile, generation: nonce(), uid: identity.uid, gid: identity.gid,
    root: posix.join(fs.realpathSync(tempDirectory()), 'eky-managed-ns-000000'),
    repositoryRoot: input.repositoryRoot, runRoot: input.runRoot, node: fs.realpathSync(runtime.execPath),
    startUntil: String(anchor + BigInt(Math.min(startupRemaining, remaining)) * 1_000_000n),
    workUntil: String(anchor + BigInt(remaining) * 1_000_000n),
    redactedValues: [...input.redactedValues],
    ...(profile === 'backend' ? { runtimeConfigPath: input.runtimeConfigPath }
      : profile === 'chromium' ? { browserExecutable: input.browserExecutable, browserGeneration: browserNonce() } : {
      webPort: input.webPort, environmentRoot: input.environmentRoot,
      backendOrigin: input.backendOrigin, sessionSecret: input.sessionSecret }),
  };
  // Validate the whole launch before creating any owner artifact.
  linuxServiceWorkload(config, { fs, tempDirectory, preparing: true });
  inspectServicePath(initPath, false, fs);
  requireService(now() < BigInt(config.startUntil), 'startupDeadlineExceeded');
  const created = [];
  const remember = (path, fileNames) => {
    const entry = { path, fileNames, identity: undefined };
    created.push(entry);
    const stat = fs.lstatSync(path);
    requireService(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === identity.uid && stat.gid === identity.gid);
    entry.identity = { dev: stat.dev, ino: stat.ino };
  };
  try {
    config.root = fs.mkdtempSync(posix.join(fs.realpathSync(tempDirectory()), 'eky-managed-ns-'));
    remember(config.root, [configName]);
    fs.chmodSync(config.root, 0o700);
    const rootIdentity = inspectManagedRoot(config.root, identity, { fs, tempDirectory });
    const bytes = JSON.stringify(config);
    requireService(Buffer.byteLength(bytes) <= linuxServiceLimits.config);
    fs.writeFileSync(posix.join(config.root, configName), bytes, { flag: 'wx', mode: 0o600 });
    if (profile === 'chromium') {
      const paths = linuxChromiumPaths(config);
      fs.mkdirSync(paths.root, { mode: 0o700 }); remember(paths.root, [posix.basename(paths.config)]);
      fs.mkdirSync(paths.temp, { mode: 0o700 }); remember(paths.temp, []);
      fs.writeFileSync(paths.config, JSON.stringify(linuxChromiumBrowserConfig(config)), { flag: 'wx', mode: 0o600 });
    }
    requireService(now() < BigInt(config.startUntil), 'startupDeadlineExceeded');
    return Object.freeze({ config: Object.freeze(config), rootIdentity });
  } catch (error) {
    // No workload exists yet. Remove only these newly created, identity-bound
    // directories and their closed file sets; never recurse over a caller root.
    let uncertain = false;
    for (const entry of created.reverse()) {
      try {
        const stat = fs.lstatSync(entry.path);
        requireService(entry.identity && stat.dev === entry.identity.dev && stat.ino === entry.identity.ino &&
          stat.uid === identity.uid && stat.gid === identity.gid);
        inspectServicePath(entry.path, true, fs);
        const names = fs.readdirSync(entry.path);
        requireService(names.every(name => entry.fileNames.includes(name)));
        for (const name of names) {
          const path = posix.join(entry.path, name);
          const file = fs.lstatSync(inspectServicePath(path, false, fs));
          requireService(file.nlink === 1 && file.uid === identity.uid && file.gid === identity.gid &&
            (file.mode & 0o7777) === 0o600);
          fs.unlinkSync(path);
        }
        fs.rmdirSync(entry.path);
      } catch { uncertain = true; }
    }
    if (uncertain) throw Object.assign(serviceFailure(error?.reason ?? 'preparationFailed'), { preparationCleanupUnverified: true });
    throw error;
  }
}

export function readLinuxChromiumConfig(path, { fs = filesystem, identity = guardLinuxService() } = {}) {
  inspectServicePath(path, false, fs);
  const value = JSON.parse(readBoundedFile(path, chromiumControlMaximumBytes, fs, identity));
  requireService(exactKeys(value, ['protocol', 'schemaVersion', 'generation', 'browserExecutable', 'runRoot', 'startUntil']) &&
    value.protocol === chromiumWorkerProtocol && value.schemaVersion === 1 &&
    typeof value.startUntil === 'string' && /^[1-9][0-9]{0,23}$/u.test(value.startUntil));
  const paths = linuxChromiumPaths({ runRoot: value.runRoot, browserGeneration: value.generation });
  requireService(path === paths.config && /^run-[A-Za-z0-9-]+$/u.test(posix.basename(value.runRoot)) &&
    posix.basename(posix.dirname(value.runRoot)) === 'eky-e2e');
  for (const directory of [paths.root, paths.temp]) {
    const stat = fs.lstatSync(inspectServicePath(directory, true, fs));
    requireService(stat.uid === identity.uid && stat.gid === identity.gid && (stat.mode & 0o7777) === 0o700);
  }
  inspectServicePath(value.browserExecutable, false, fs);
  requireService(posix.basename(value.browserExecutable) === 'chrome' &&
    posix.basename(posix.dirname(value.browserExecutable)) === 'chrome-linux64');
  return value;
}

export function readLinuxServiceConfig(root, { runtime = process, fs = filesystem, tempDirectory = tmpdir } = {}) {
  const identity = guardLinuxService(runtime);
  inspectManagedRoot(root, identity, { fs, tempDirectory });
  const config = validateServiceConfig(JSON.parse(readBoundedFile(posix.join(root, configName),
    linuxServiceLimits.config, fs, identity)));
  requireService(config.root === root && config.uid === identity.uid && config.gid === identity.gid);
  return config;
}

export function removeLinuxServiceControl(prepared, { fs = filesystem, tempDirectory = tmpdir, runtime = process } = {}) {
  const { config, rootIdentity } = prepared;
  inspectManagedRoot(config.root, config, { fs, tempDirectory, previous: rootIdentity });
  // The socket must already have been removed by the actual listener close.
  requireService(fs.readdirSync(config.root).length === 1 && fs.readdirSync(config.root)[0] === configName,
    'cleanupUnverified');
  const actual = readLinuxServiceConfig(config.root, { fs, tempDirectory, runtime });
  requireService(JSON.stringify(actual) === JSON.stringify(config), 'cleanupUnverified');
  fs.unlinkSync(posix.join(config.root, configName));
  fs.rmdirSync(config.root);
}

export { managedControlPath };
