import * as filesystem from 'node:fs';
import { tmpdir } from 'node:os';
import { posix } from 'node:path';
import { types } from 'node:util';
import { exactKeys, isNonce, limits } from './pidNamespaceContract.mjs';
import { inspectManagedRoot, inspectManagedSocket } from './managedNamespaceRoot.mjs';
import { linuxServiceLimits } from './linuxServiceContract.mjs';

const envelopeKeys = ['schemaVersion', 'nonce', 'caseId', 'name', 'payload'];
const failure = () => new Error('E2E_LINUX_CONSUMER_EXCHANGE_UNVERIFIED');
const requireValue = condition => { if (!condition) throw failure(); };
const guarded = action => { try { return action(); } catch { throw failure(); } };
const token = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/u.test(value);
const sameInode = (a, b) => a.dev === b.dev && a.ino === b.ino;
const sameFile = (a, b) => ['dev', 'ino', 'size', 'mode', 'uid', 'gid', 'nlink', 'mtimeMs', 'ctimeMs']
  .every(key => a[key] === b[key]);

function record(value, keys) {
  requireValue(!types.isProxy(value) && exactKeys(value, keys));
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}

// Copy only JSON data descriptors, never getters, proxies or serialization hooks.
function jsonData(value, budget = { left: limits.result }) {
  requireValue(--budget.left >= 0);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') { requireValue(Number.isFinite(value)); return value; }
  if (typeof value === 'string') {
    budget.left -= Buffer.byteLength(value); requireValue(budget.left >= 0); return value;
  }
  requireValue(value && typeof value === 'object' && !types.isProxy(value));
  const array = Array.isArray(value);
  requireValue([array ? Array.prototype : Object.prototype, null].includes(Object.getPrototypeOf(value)));
  const fields = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(fields).filter(key => !array || key !== 'length');
  requireValue(keys.length <= budget.left && keys.every(key => typeof key === 'string' &&
    fields[key].enumerable && Object.hasOwn(fields[key], 'value')));
  if (array) requireValue(fields.length.value === keys.length && keys.every((key, index) => key === String(index)));
  const entries = (array ? keys : keys.sort()).map(key => {
    budget.left -= Buffer.byteLength(key); requireValue(budget.left >= 0);
    return [key, jsonData(fields[key].value, budget)];
  });
  return Object.freeze(array ? entries.map(([, item]) => item)
    : Object.fromEntries(entries));
}

// records is the parent's trusted frozen case manifest, never external data.
// Each role opens once per case. Names bind phases; the parent owns their order.
// validate(payload) is synchronous and throws on invalid data; its return is ignored.
// Only the fixed owner-loss arm may opt into the real service control root.
export function openLinuxConsumerExchange(input, { fs = filesystem, tempDirectory = tmpdir } = {}) {
  return guarded(() => {
    requireValue(input && typeof input === 'object' && !types.isProxy(input));
    const keys = ['root', 'identity', 'nonce', 'caseId', 'role', 'records'];
    if (Object.hasOwn(input, 'serviceRoot')) keys.push('serviceRoot');
    const { root, identity: suppliedIdentity, nonce, caseId, role, records, serviceRoot = false } = record(input, keys);
    const identity = Object.freeze(record(suppliedIdentity, ['uid', 'gid']));
    requireValue(typeof serviceRoot === 'boolean' &&
      Object.values(identity).every(value => Number.isSafeInteger(value) && value > 0) &&
      isNonce(nonce) && token(caseId) && token(role) && Array.isArray(records) &&
      !types.isProxy(records) && Object.isFrozen(records) && records.length > 0 && records.length <= 32);
    const manifest = new Map(); const pendingNames = new Map();
    for (const entry of records) {
      const item = record(entry, ['name', 'writer', 'validate']);
      requireValue(Object.isFrozen(entry) && typeof item.name === 'string' &&
        /^[A-Za-z0-9_-]{1,64}\.json$/u.test(item.name) && token(item.writer) &&
        typeof item.validate === 'function' && !manifest.has(item.name));
      manifest.set(item.name, item); pendingNames.set(`${item.name}.pending`, item.name);
    }
    requireValue(!serviceRoot || (['backend-owner', 'vite-owner', 'chromium-owner'].includes(caseId) &&
      manifest.size === 1 && manifest.get('armed.json')?.writer === 'caller'));
    const ambientNames = serviceRoot ? ['service.json', 'control.sock'] : [];
    const { O_RDONLY, O_NOFOLLOW, O_NONBLOCK } = fs.constants;
    requireValue(Number.isInteger(O_RDONLY) && Number.isInteger(O_NOFOLLOW) && O_NOFOLLOW !== 0 &&
      Number.isInteger(O_NONBLOCK) && O_NONBLOCK !== 0);
    const validFile = (stat, maximumBytes = limits.result) => stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 &&
      stat.uid === identity.uid && stat.gid === identity.gid && (stat.mode & 0o7777) === 0o600 &&
      Number.isSafeInteger(stat.dev) && stat.dev >= 0 && Number.isSafeInteger(stat.ino) && stat.ino > 0 &&
      Number.isSafeInteger(stat.size) && stat.size >= 0 && stat.size <= maximumBytes &&
      Number.isFinite(stat.mtimeMs) && Number.isFinite(stat.ctimeMs);
    let rootReceipt; let serviceReceipt; let socketReceipt;
    const checkRoot = () => {
      rootReceipt = inspectManagedRoot(root, identity, { fs, tempDirectory, previous: rootReceipt });
      if (!serviceRoot) return;
      const current = fs.lstatSync(posix.join(root, 'service.json'));
      requireValue(validFile(current, linuxServiceLimits.config) && current.size > 0 &&
        (!serviceReceipt || sameFile(serviceReceipt, current)));
      serviceReceipt = current;
      try { socketReceipt = inspectManagedSocket(root, identity, { fs, previous: socketReceipt }); }
      catch (error) {
        // Real control disposal may unlink the socket. This confers no absence proof
        // and does not forget the identity if a socket appears at this name again.
        requireValue(error?.code === 'ENOENT');
      }
    };
    const attempted = new Set(); const consumed = new Set(); const observed = new Map();
    const lookup = name => { requireValue(typeof name === 'string' && manifest.has(name)); return manifest.get(name); };
    const bytesFor = (name, payload) => {
      const clean = jsonData(payload); lookup(name).validate(clean);
      const bytes = Buffer.from(`${JSON.stringify({ schemaVersion: 1, nonce, caseId, name, payload: clean })}\n`);
      requireValue(bytes.length <= limits.result); return bytes;
    };
    const absent = path => {
      try { fs.lstatSync(path); } catch (error) { if (error?.code === 'ENOENT') return; throw error; }
      throw failure();
    };
    const readFile = name => {
      checkRoot(); const path = posix.join(root, name);
      let before;
      try { before = fs.lstatSync(path); } catch (error) {
        requireValue(error?.code === 'ENOENT' && !observed.has(name)); checkRoot(); return undefined;
      }
      requireValue(validFile(before));
      const fd = fs.openSync(path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
      const unchanged = stat => validFile(stat) && sameFile(before, stat);
      let bytes;
      try {
        requireValue(unchanged(fs.fstatSync(fd)));
        const buffer = Buffer.alloc(limits.result + 1); let used = 0;
        while (used < buffer.length) {
          const count = fs.readSync(fd, buffer, used, buffer.length - used, used);
          requireValue(Number.isInteger(count) && count >= 0 && count <= buffer.length - used);
          if (count === 0) break;
          used += count;
        }
        requireValue(used === before.size && used <= limits.result &&
          unchanged(fs.fstatSync(fd)) && unchanged(fs.lstatSync(path)));
        bytes = buffer.subarray(0, used);
      } finally { fs.closeSync(fd); }
      checkRoot();
      const parsed = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), envelopeKeys);
      requireValue(parsed.schemaVersion === 1 && parsed.nonce === nonce && parsed.caseId === caseId &&
        parsed.name === name && bytes.equals(bytesFor(name, parsed.payload)));
      const previous = observed.get(name);
      requireValue(!previous || (sameFile(previous.stat, before) && previous.bytes.equals(bytes)));
      const result = { stat: before, bytes, payload: jsonData(parsed.payload) };
      observed.set(name, result); return result;
    };
    const inspect = () => {
      checkRoot(); const directory = fs.opendirSync(root, { bufferSize: 1 }); const names = new Set();
      try {
        for (let entry; (entry = directory.readSync()) !== null;) {
          requireValue(names.size < manifest.size * 2 + ambientNames.length && !names.has(entry.name) &&
            (manifest.has(entry.name) || pendingNames.has(entry.name) || ambientNames.includes(entry.name)));
          names.add(entry.name);
        }
      } finally { directory.closeSync(); }
      checkRoot();
      for (const name of observed.keys()) requireValue(names.has(name));
      for (const name of names) {
        if (ambientNames.includes(name)) continue;
        if (manifest.has(name)) {
          absent(posix.join(root, `${name}.pending`)); requireValue(readFile(name) !== undefined);
        } else {
          let pending;
          try { pending = fs.lstatSync(posix.join(root, name)); }
          catch (error) { requireValue(error?.code === 'ENOENT'); }
          // A cooperating rename may finish after enumeration, before this stat.
          if (pending) requireValue(validFile(pending));
          else requireValue(readFile(pendingNames.get(name)) !== undefined);
        }
      }
      checkRoot();
    };
    const read = name => {
      lookup(name); inspect(); return readFile(name)?.payload;
    };
    inspect();
    return Object.freeze({
      publish(name, payload) {
        return guarded(() => {
          const item = lookup(name); requireValue(!attempted.has(name)); attempted.add(name);
          requireValue(item.writer === role);
          const bytes = bytesFor(name, payload); inspect();
          const finalPath = posix.join(root, name); const pending = `${finalPath}.pending`;
          absent(finalPath); checkRoot();
          let fd = fs.openSync(pending, 'wx', 0o600); let written;
          try {
            const opened = fs.fstatSync(fd);
            requireValue(validFile(opened) && opened.size === 0); checkRoot();
            requireValue(fs.writeSync(fd, bytes, 0, bytes.length, 0) === bytes.length);
            written = fs.fstatSync(fd);
            requireValue(validFile(written) && written.size === bytes.length && sameInode(opened, written) &&
              sameFile(written, fs.lstatSync(pending)));
            const closing = fd; fd = undefined; fs.closeSync(closing);
          } finally { if (fd !== undefined) fs.closeSync(fd); }
          checkRoot(); absent(finalPath);
          // rename CAN replace: cooperating single writers only, not hostile same-UID isolation.
          fs.renameSync(pending, finalPath);
          const published = readFile(name);
          requireValue(published && sameInode(written, published.stat) && published.bytes.equals(bytes));
          inspect();
        });
      },
      read: name => guarded(() => read(name)),
      consume: name => guarded(() => {
        lookup(name); requireValue(!consumed.has(name));
        const payload = read(name); if (payload !== undefined) consumed.add(name); return payload;
      }),
    });
  });
}
