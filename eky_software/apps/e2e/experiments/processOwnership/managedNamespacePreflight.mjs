import * as filesystem from 'node:fs/promises';
import { posix } from 'node:path';
import { currentIdentity } from './pidNamespaceActor.mjs';
import { validateIdentity } from './pidNamespaceContract.mjs';
import { managedSystemTools } from './managedNamespaceLaunchContract.mjs';

const cgroupRoot = '/sys/fs/cgroup';
const cgroup2Magic = 0x63677270;
const managerDirectory = '/run/systemd/system';
const managerSocket = '/run/systemd/private';

function failure(reason, stage) {
  return Object.assign(new Error('Managed namespace host metadata unverified'), { reason, stage });
}

// Metadata only, for the trusted CI image. This does not prove sudo policy,
// manager reachability, supported properties, unit ownership or tree cleanup.
// Importing this module performs no host access. No path is supplied by callers.
export async function inspectManagedHost({ deadline, runtime = process, fs = filesystem, time = globalThis }) {
  let stage = 'context';
  let finished = false;
  let timer;
  let identity;
  const check = () => {
    if (finished) throw failure('deadlineExceeded', stage);
    try { deadline.check('ready'); }
    catch { throw failure('deadlineExceeded', stage); }
  };
  const call = async operation => {
    check();
    const result = await operation();
    check();
    return result;
  };
  const directories = new Set();
  async function entry(path, kind, specialBits = 0) {
    const stat = await call(() => fs.lstat(path));
    if (stat.isSymbolicLink() || !stat[kind]() || stat.uid !== 0 ||
        !Number.isSafeInteger(stat.mode) || stat.mode < 0 || stat.mode > 0xffff ||
        (stat.mode & 0o022) !== 0 || (stat.mode & 0o7000) !== specialBits ||
        !Number.isSafeInteger(stat.dev) || stat.dev < 0 || !Number.isSafeInteger(stat.ino) || stat.ino <= 0) {
      throw failure('metadataInvalid', stage);
    }
    if (await call(() => fs.realpath(path)) !== path) throw failure('metadataInvalid', stage);
    return stat;
  }
  async function ancestors(path) {
    const parent = posix.dirname(path);
    if (directories.has(parent)) return;
    if (parent !== '/') await ancestors(parent);
    await entry(parent, 'isDirectory');
    directories.add(parent);
  }
  async function observe() {
    stage = 'tools';
    for (const [name, path] of Object.entries(managedSystemTools)) {
      await ancestors(path);
      const stat = await entry(path, 'isFile', name === 'sudo' ? 0o4000 : 0);
      if ((stat.mode & 0o111) !== 0o111) throw failure('metadataInvalid', stage);
    }
    stage = 'manager';
    await ancestors(managerDirectory);
    await entry(managerDirectory, 'isDirectory');
    await entry(managerSocket, 'isSocket');
    stage = 'cgroup';
    await ancestors(cgroupRoot);
    await entry(cgroupRoot, 'isDirectory');
    if ((await call(() => fs.statfs(cgroupRoot))).type !== cgroup2Magic) {
      throw failure('cgroupV2Unverified', stage);
    }
    // Check the v2 interface without opening process lists or control files.
    for (const name of ['cgroup.controllers', 'cgroup.subtree_control']) {
      await entry(posix.join(cgroupRoot, name), 'isFile');
    }
    check();
    return Object.freeze({ kind: 'managedHostMetadata', uid: identity.uid, gid: identity.gid });
  }
  try {
    if (runtime.platform !== 'linux' || runtime.env.EKY_E2E !== '1' ||
        runtime.env.CI !== 'true' || runtime.env.GITHUB_ACTIONS !== 'true') {
      throw failure('invalidContext', stage);
    }
    identity = currentIdentity(runtime);
    try { validateIdentity(identity, identity); }
    catch { throw failure('invalidIdentity', stage); }
    check();
    const timeout = new Promise((resolve, reject) => {
      timer = time.setTimeout(() => reject(failure('deadlineExceeded', stage)), deadline.remaining('ready'));
    });
    const receipt = await Promise.race([observe(), timeout]);
    check();
    return receipt;
  } catch (error) {
    const reasons = ['invalidContext', 'invalidIdentity', 'metadataInvalid', 'cgroupV2Unverified', 'deadlineExceeded'];
    throw failure(reasons.includes(error?.reason) ? error.reason : 'metadataReadFailed', stage);
  } finally {
    finished = true;
    time.clearTimeout(timer);
  }
}
