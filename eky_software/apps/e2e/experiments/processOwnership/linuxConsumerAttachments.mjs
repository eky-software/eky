import * as filesystem from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { types } from 'node:util';

const maximumAttachments = 32;
const maximumFileBytes = 4 * 1024 * 1024;
const maximumTotalBytes = 16 * 1024 * 1024;
const failure = () => new Error('E2E_LINUX_CONSUMER_ATTACHMENT_UNVERIFIED');
const requireValue = condition => { if (!condition) throw failure(); };
const sameIdentity = (left, right) => ['dev', 'ino', 'uid', 'gid', 'mode'].every(key => left[key] === right[key]);
const sameFile = (left, right) => sameIdentity(left, right) &&
  ['nlink', 'size', 'mtimeNs', 'ctimeNs'].every(key => left[key] === right[key]);
const samePath = (left, right) => relative(left, right) === '';
const below = (path, root) => {
  const part = relative(root, path);
  return part !== '' && part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part);
};

function dataRecord(value) {
  requireValue(value && typeof value === 'object' && !types.isProxy(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)));
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  requireValue(keys.every(key => typeof key === 'string' && descriptors[key].enumerable &&
    Object.hasOwn(descriptors[key], 'value')));
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}

function cleanupBody(bytes) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const value = dataRecord(JSON.parse(text));
  // The real fixture writes JSON.stringify output. This also rejects duplicate keys.
  requireValue(JSON.stringify(value) === text && Object.keys(value).length === 2 &&
    value.schemaVersion === 1 && Object.hasOwn(value, 'cleanup'));
  const cleanup = dataRecord(value.cleanup);
  const steps = ['context', 'api', 'web', 'backend', 'webPort', 'backendPort', 'artifacts'];
  const keys = [...steps, 'priorCleanup', 'runRoot'];
  requireValue(Object.keys(cleanup).length === keys.length && keys.every(key => Object.hasOwn(cleanup, key)) &&
    steps.every(key => ['notStarted', 'completed', 'failed'].includes(cleanup[key])) &&
    ['verified', 'unverified'].includes(cleanup.priorCleanup) &&
    ['retained', 'removed', 'removalFailed'].includes(cleanup.runRoot));
  return Object.freeze(cleanup);
}

// Private experiment evidence only. No upload, source deletion or cleanup authority.
export function createLinuxConsumerAttachments(input, { fs = filesystem, runtime = process } = {}) {
  try {
    const { root, readTestRoot, ...extra } = dataRecord(input);
    requireValue(Object.keys(extra).length === 0 && typeof root === 'string' &&
      isAbsolute(root) && typeof readTestRoot === 'function');
    const windows = runtime.platform === 'win32';
    requireValue(windows || runtime.platform === 'linux');
    const identity = windows ? undefined : { uid: BigInt(runtime.getuid()), gid: BigInt(runtime.getgid()) };
    if (identity) requireValue(identity.uid > 0n && identity.gid > 0n);
    const tempRoot = fs.realpathSync(tmpdir());
    const evidenceRoot = resolve(root);
    const metadata = { bigint: true };
    const owned = stat => !identity || (stat.uid === identity.uid && stat.gid === identity.gid);
    const directory = path => {
      const stat = fs.lstatSync(path, metadata);
      requireValue(stat.isDirectory() && !stat.isSymbolicLink() && owned(stat) &&
        (windows || (stat.mode & 0o7777n) === 0o700n) && samePath(fs.realpathSync(path), path));
      return stat;
    };
    const directories = path => {
      requireValue(below(path, tempRoot));
      let current = tempRoot;
      let stat;
      for (const part of relative(tempRoot, path).split(sep)) {
        current = join(current, part); stat = directory(current);
      }
      return stat;
    };
    // Windows uses the caller's private OS-temp ACL inheritance, not POSIX mode bits.
    const evidenceIdentity = directories(evidenceRoot);
    const checkEvidence = () => requireValue(sameIdentity(directories(evidenceRoot), evidenceIdentity));
    const file = (stat, destination = false) => {
      requireValue(stat.isFile() && !stat.isSymbolicLink() && owned(stat) && stat.nlink === 1n &&
        stat.size >= 0n && stat.size <= BigInt(maximumFileBytes) &&
        (windows || (destination ? (stat.mode & 0o7777n) === 0o600n : (stat.mode & 0o7022n) === 0n)));
      return stat;
    };
    let sourceRoot;
    let sourceIdentity;
    const checkSource = path => {
      const supplied = readTestRoot();
      requireValue(typeof supplied === 'string' && isAbsolute(supplied));
      const root = resolve(supplied);
      requireValue(samePath(dirname(root), join(tempRoot, 'eky-e2e')) && /^run-[A-Za-z0-9-]+$/u.test(basename(root)) &&
        !samePath(root, evidenceRoot) && !below(evidenceRoot, root) && !below(root, evidenceRoot));
      const stat = directories(root);
      if (sourceRoot === undefined) { sourceRoot = root; sourceIdentity = stat; }
      requireValue(samePath(root, sourceRoot) && sameIdentity(stat, sourceIdentity) && below(path, root));
      directories(dirname(path));
    };
    const nofollow = fs.constants.O_NOFOLLOW ?? 0;
    const nonblock = fs.constants.O_NONBLOCK ?? 0;
    requireValue(Number.isInteger(fs.constants.O_RDONLY) && Number.isInteger(nofollow) && Number.isInteger(nonblock) &&
      (windows || (nofollow !== 0 && nonblock !== 0)));
    const readSource = path => {
      requireValue(typeof path === 'string' && path.length <= 4096 && isAbsolute(path));
      path = resolve(path); checkSource(path);
      const before = file(fs.lstatSync(path, metadata));
      // O_NOFOLLOW/O_NONBLOCK are mandatory on Linux. Windows also binds the open
      // handle to the inspected file and refuses reparse-point ancestors.
      const fd = fs.openSync(path, fs.constants.O_RDONLY | nofollow | nonblock);
      let bytes;
      try {
        requireValue(sameFile(before, file(fs.fstatSync(fd, metadata))));
        const buffer = Buffer.alloc(Number(before.size) + 1);
        let used = 0;
        while (used < buffer.length) {
          const count = fs.readSync(fd, buffer, used, buffer.length - used, used);
          requireValue(Number.isInteger(count) && count >= 0 && count <= buffer.length - used);
          if (count === 0) break;
          used += count;
        }
        requireValue(BigInt(used) === before.size && sameFile(before, file(fs.fstatSync(fd, metadata))) &&
          sameFile(before, file(fs.lstatSync(path, metadata))));
        checkSource(path); bytes = buffer.subarray(0, used);
      } finally { fs.closeSync(fd); }
      checkSource(path);
      requireValue(sameFile(before, file(fs.lstatSync(path, metadata))));
      return bytes;
    };
    const persist = (index, bytes) => {
      checkEvidence();
      const path = join(evidenceRoot, `attachment-${String(index).padStart(2, '0')}.bin`);
      const fd = fs.openSync(path, 'wx', 0o600);
      let written;
      try {
        const opened = file(fs.fstatSync(fd, metadata), true);
        requireValue(opened.size === 0n); checkEvidence();
        let used = 0;
        while (used < bytes.length) {
          const count = fs.writeSync(fd, bytes, used, bytes.length - used, used);
          requireValue(Number.isInteger(count) && count > 0 && count <= bytes.length - used);
          used += count;
        }
        written = file(fs.fstatSync(fd, metadata), true);
        requireValue(sameIdentity(opened, written) && written.size === BigInt(bytes.length) &&
          sameFile(written, file(fs.lstatSync(path, metadata), true)));
      } finally { fs.closeSync(fd); }
      checkEvidence();
      requireValue(sameFile(written, file(fs.lstatSync(path, metadata), true)));
    };
    let count = 0;
    let total = 0;
    let cleanup;
    let cleanupAttempted = false;
    let cleanupFailed = false;
    return Object.freeze({
      async attach(name, options) {
        const isCleanup = name === 'service-fixture-cleanup';
        try {
          requireValue(typeof name === 'string' && name.length > 0 && Buffer.byteLength(name) <= 256);
          if (isCleanup) { requireValue(!cleanupAttempted); cleanupAttempted = true; }
          requireValue(count < maximumAttachments); const index = ++count;
          const value = dataRecord(options);
          const body = Object.hasOwn(value, 'body');
          const path = Object.hasOwn(value, 'path');
          requireValue(body !== path && Object.keys(value).every(key => ['body', 'path', 'contentType'].includes(key)) &&
            (value.contentType === undefined || (typeof value.contentType === 'string' && Buffer.byteLength(value.contentType) <= 128)) &&
            (!isCleanup || (body && value.contentType === 'application/json')));
          let bytes;
          if (body) {
            requireValue(!types.isProxy(value.body) && (typeof value.body === 'string' || Buffer.isBuffer(value.body)) &&
              Buffer.byteLength(value.body) <= maximumFileBytes);
            bytes = Buffer.from(value.body);
          } else bytes = readSource(value.path);
          requireValue(bytes.length <= maximumTotalBytes - total);
          total += bytes.length;
          persist(index, bytes);
          if (isCleanup) cleanup = cleanupBody(bytes);
        } catch {
          if (isCleanup) cleanupFailed = true;
          throw failure();
        }
      },
      readServiceCleanup() {
        requireValue(!cleanupFailed);
        return cleanup;
      },
    });
  } catch { throw failure(); }
}
