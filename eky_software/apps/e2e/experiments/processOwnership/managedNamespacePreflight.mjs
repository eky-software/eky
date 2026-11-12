import * as filesystem from 'node:fs/promises';
import { posix } from 'node:path';
import { currentIdentity } from './pidNamespaceActor.mjs';
import { validateIdentity } from './pidNamespaceContract.mjs';
import { managedSystemTools } from './managedNamespaceLaunchContract.mjs';

const cgroupRoot = '/sys/fs/cgroup';
const cgroup2Magic = 0x63677270;
const managerDirectory = '/run/systemd/system';
const managerSocket = '/run/systemd/private';

function failure(reason, stage, privateCheck) {
  let cause;
  if (privateCheck !== undefined) {
    cause = new Error(`MANAGED_NAMESPACE_PREFLIGHT_CHECK:${privateCheck.role}:${privateCheck.scope}:${privateCheck.check}`);
    cause.stack = undefined;
  }
  return Object.assign(new Error('Managed namespace host metadata unverified',
    cause === undefined ? undefined : { cause }), { reason, stage });
}

// Metadata only, for the trusted CI image. This does not prove sudo policy,
// manager reachability, supported properties, unit ownership or tree cleanup.
// Importing this module performs no host access. No path is supplied by callers.
export async function inspectManagedHost({ deadline, runtime = process, fs = filesystem, time = globalThis,
  privateDiagnostics = false }) {
  let stage = 'context';
  let finished = false;
  let timer;
  let identity;
  let failedCheck;
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
  function metadataInvalid(check, role, kind) {
    if (privateDiagnostics === true && stage === 'tools' && role !== undefined) {
      failedCheck = { role, scope: kind === 'isDirectory' ? 'ancestor' : 'tool', check };
    }
    return failure('metadataInvalid', stage);
  }
  async function entry(path, kind, specialBits = 0, role) {
    const stat = await call(() => fs.lstat(path));
    // Preserve the original short-circuit order; diagnostics contain no observed values.
    if (stat.isSymbolicLink()) throw metadataInvalid('symbolicLink', role, kind);
    if (!stat[kind]()) throw metadataInvalid('entryKind', role, kind);
    if (stat.uid !== 0) throw metadataInvalid('rootOwner', role, kind);
    if (!Number.isSafeInteger(stat.mode) || stat.mode < 0 || stat.mode > 0xffff) {
      throw metadataInvalid('modeRange', role, kind);
    }
    if ((stat.mode & 0o022) !== 0) throw metadataInvalid('writePermissions', role, kind);
    if ((stat.mode & 0o7000) !== specialBits) throw metadataInvalid('specialBits', role, kind);
    if (!Number.isSafeInteger(stat.dev) || stat.dev < 0) throw metadataInvalid('deviceIdentity', role, kind);
    if (!Number.isSafeInteger(stat.ino) || stat.ino <= 0) throw metadataInvalid('inodeIdentity', role, kind);
    if (await call(() => fs.realpath(path)) !== path) throw metadataInvalid('canonicalPath', role, kind);
    return stat;
  }
  async function ancestors(path, role) {
    const parent = posix.dirname(path);
    if (directories.has(parent)) return;
    if (parent !== '/') await ancestors(parent, role);
    await entry(parent, 'isDirectory', 0, role);
    directories.add(parent);
  }
  async function observe() {
    stage = 'tools';
    for (const [name, path] of Object.entries(managedSystemTools)) {
      await ancestors(path, name);
      const stat = await entry(path, 'isFile', name === 'sudo' ? 0o4000 : 0, name);
      if ((stat.mode & 0o111) !== 0o111) throw metadataInvalid('executable', name, 'isFile');
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
    const reason = reasons.includes(error?.reason) ? error.reason : 'metadataReadFailed';
    throw failure(reason, stage, reason === 'metadataInvalid' && stage === 'tools' ? failedCheck : undefined);
  } finally {
    finished = true;
    time.clearTimeout(timer);
  }
}
