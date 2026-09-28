import * as filesystem from 'node:fs';
import { posix } from 'node:path';
import { types } from 'node:util';
import { currentIdentity } from './pidNamespaceActor.mjs';
import { exactKeys, isNonce, NamespaceFailure, requireCondition, validateIdentity } from './pidNamespaceContract.mjs';
import { inspectManagedRoot } from './managedNamespaceRoot.mjs';

const filename = 'chromium-failure.json';
const byteLimit = 256;
const phases = ['setup', 'import', 'launch', 'assert', 'close', 'tempCleanup'];
const reasons = ['operationFailed', 'deadlineExceeded', 'postconditionFailed'];
const scopeKeys = ['root', 'generation', 'uid', 'gid', 'rootReceipt', 'tempRoot'];

function record(value, keys) {
  requireCondition(!types.isProxy(value) && exactKeys(value, keys), 'reportFailed');
  return Object.fromEntries(keys.map(key => [key, value[key]]));
}

export function validateManagedChromiumDiagnostic(value) {
  try {
    const result = record(value, ['status', 'phase', 'reason']);
    requireCondition(result.status === 'valid'
      ? phases.includes(result.phase) && reasons.includes(result.reason)
      : ['absent', 'invalid', 'unavailable'].includes(result.status) &&
        result.phase === null && result.reason === null, 'reportFailed');
    return Object.freeze(result);
  } catch { throw new NamespaceFailure('reportFailed'); }
}

const diagnostic = (status, phase = null, reason = null) =>
  validateManagedChromiumDiagnostic({ status, phase, reason });

function copyScope(value) {
  const scope = record(value, scopeKeys);
  scope.rootReceipt = Object.freeze(record(scope.rootReceipt, ['dev', 'ino']));
  requireCondition(isNonce(scope.generation) && typeof scope.tempRoot === 'string' &&
    posix.isAbsolute(scope.tempRoot) && posix.normalize(scope.tempRoot) === scope.tempRoot &&
    Number.isSafeInteger(scope.rootReceipt.dev) && scope.rootReceipt.dev >= 0 &&
    Number.isSafeInteger(scope.rootReceipt.ino) && scope.rootReceipt.ino > 0, 'reportFailed');
  return Object.freeze(scope);
}

function checkRoot(scope, fs, runtime) {
  validateIdentity(currentIdentity(runtime), scope);
  requireCondition(fs.realpathSync(scope.tempRoot) === scope.tempRoot, 'rootFailed');
  inspectManagedRoot(scope.root, scope, {
    fs, previous: scope.rootReceipt, tempDirectory: () => scope.tempRoot,
  });
}

function validFile(stat, scope) {
  return stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 &&
    stat.uid === scope.uid && stat.gid === scope.gid && (stat.mode & 0o7777) === 0o600 &&
    Number.isSafeInteger(stat.dev) && stat.dev >= 0 && Number.isSafeInteger(stat.ino) && stat.ino > 0 &&
    Number.isSafeInteger(stat.size) && stat.size >= 0 && stat.size <= byteLimit;
}

function sameFile(left, right) {
  return ['dev', 'ino', 'size', 'mode', 'uid', 'gid', 'nlink', 'mtimeMs', 'ctimeMs']
    .every(key => left[key] === right[key]);
}

function serialize(generation, phase, reason) {
  requireCondition(isNonce(generation) && phases.includes(phase) && reasons.includes(reason), 'reportFailed');
  const bytes = Buffer.from(`${JSON.stringify({ version: 1, generation, phase, reason })}\n`, 'utf8');
  requireCondition(bytes.length <= byteLimit, 'reportFailed');
  return bytes;
}

export function createManagedChromiumFailureWriter(value, { fs = filesystem, runtime = process } = {}) {
  let scope;
  try { scope = copyScope(value); } catch { /* Invalid scope never permits a write. */ }
  let attempted = false;
  return (phase, reason) => {
    if (attempted) return false;
    attempted = true;
    let fd;
    try {
      const bytes = serialize(scope?.generation, phase, reason);
      checkRoot(scope, fs, runtime);
      fd = fs.openSync(posix.join(scope.root, filename), 'wx', 0o600);
      requireCondition(validFile(fs.fstatSync(fd), scope), 'reportFailed');
      checkRoot(scope, fs, runtime);
      requireCondition(fs.writeSync(fd, bytes, 0, bytes.length, 0) === bytes.length, 'reportFailed');
      const closing = fd;
      fd = undefined;
      fs.closeSync(closing);
      checkRoot(scope, fs, runtime);
      return true;
    } catch { return false; }
    finally {
      if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* Preserve the original failure. */ } }
    }
  };
}

export function readManagedChromiumFailure(value, { fs = filesystem, runtime = process } = {}) {
  let fd;
  let result = diagnostic('unavailable');
  try {
    const scope = copyScope(value);
    const read = () => {
      checkRoot(scope, fs, runtime);
      const path = posix.join(scope.root, filename);
      let before;
      try { before = fs.lstatSync(path); }
      catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        checkRoot(scope, fs, runtime);
        return diagnostic('absent');
      }
      if (!validFile(before, scope)) return diagnostic('invalid');
      const { O_RDONLY, O_NOFOLLOW, O_NONBLOCK } = fs.constants;
      requireCondition(Number.isInteger(O_NOFOLLOW) && O_NOFOLLOW !== 0 &&
        Number.isInteger(O_NONBLOCK) && O_NONBLOCK !== 0, 'reportFailed');
      fd = fs.openSync(path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
      requireCondition(sameFile(before, fs.fstatSync(fd)), 'reportFailed');
      const bytes = Buffer.alloc(byteLimit + 1);
      let used = 0;
      while (used < bytes.length) {
        const count = fs.readSync(fd, bytes, used, bytes.length - used, used);
        requireCondition(Number.isInteger(count) && count >= 0 && count <= bytes.length - used, 'reportFailed');
        if (count === 0) break;
        used += count;
      }
      checkRoot(scope, fs, runtime);
      requireCondition(sameFile(before, fs.fstatSync(fd)) && sameFile(before, fs.lstatSync(path)), 'reportFailed');
      if (used > byteLimit || used !== before.size) return diagnostic('invalid');
      try {
        const line = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, used));
        const parsed = record(JSON.parse(line), ['version', 'generation', 'phase', 'reason']);
        requireCondition(parsed.version === 1 && parsed.generation === scope.generation &&
          serialize(parsed.generation, parsed.phase, parsed.reason).toString('utf8') === line, 'reportFailed');
        return diagnostic('valid', parsed.phase, parsed.reason);
      } catch { return diagnostic('invalid'); }
    };
    result = read();
  } catch { /* A failed read or identity check is not evidence of an absent file. */ }
  finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { result = diagnostic('unavailable'); }
    }
  }
  return result;
}
