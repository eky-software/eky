import assert from 'node:assert/strict';
import test from 'node:test';
import { exactKeys, limits } from './pidNamespaceContract.mjs';
import { linuxServiceLimits } from './linuxServiceContract.mjs';
import { openLinuxConsumerExchange } from './linuxConsumerExchange.mjs';

const root = '/synthetic-temp/eky-managed-ns-ABC123';
const identity = { uid: 1001, gid: 1002 };
const nonce = 'a'.repeat(32);
const payload = { status: 'ready' };
const fail = code => Object.assign(Error('PRIVATE filesystem detail'), { code });
const rejected = action => assert.throws(action, error => {
  assert.equal(error.message, 'E2E_LINUX_CONSUMER_EXCHANGE_UNVERIFIED');
  assert.equal(error.cause, undefined); assert.equal(error.code, undefined); return true;
});
const manifest = entries => Object.freeze(entries.map(entry => Object.freeze(entry)));
const records = manifest([
  { name: 'ready.json', writer: 'caller', validate(value) {
    assert.ok(exactKeys(value, ['status']) && value.status === 'ready');
  } },
  { name: 'grant.json', writer: 'outer', validate(value) {
    assert.ok(exactKeys(value, ['allowed']) && value.allowed === true);
  } },
]);
const canonical = (name = 'ready.json', value = payload) => Buffer.from(`${JSON.stringify({
  schemaVersion: 1, nonce, caseId: 'backend-owner', name, payload: value,
})}\n`);

function fixture() {
  const files = new Map(); const handles = new Map(); const calls = [];
  let nextInode = 10; let nextHandle = 0; let directories = 0;
  const directory = { dev: 2, ino: 3, ...identity, mode: 0o40700,
    isDirectory: () => true, isSymbolicLink: () => false };
  const add = (name, bytes = canonical(), changes = {}) => {
    const file = { bytes: Buffer.from(bytes), dev: 2, ino: ++nextInode, ...identity, mode: 0o100600,
      nlink: 1, mtimeMs: 1, ctimeMs: 1, isFile: () => true, isSymbolicLink: () => false, ...changes };
    files.set(name, file); return file;
  };
  const nameOf = path => { assert.ok(path.startsWith(`${root}/`)); return path.slice(root.length + 1); };
  const stat = file => { const { bytes, ...metadata } = file; return { ...metadata, size: bytes.length }; };
  const fs = {
    constants: { O_RDONLY: 0, O_NOFOLLOW: 131072, O_NONBLOCK: 2048 },
    realpathSync: path => path,
    lstatSync(path) {
      calls.push(['lstat', path]);
      if (path === root) return { ...directory };
      const file = files.get(nameOf(path)); if (!file) throw fail('ENOENT'); return stat(file);
    },
    opendirSync(path, options) {
      assert.equal(path, root); assert.deepEqual(options, { bufferSize: 1 });
      const names = [...files.keys()]; let cursor = 0; directories++;
      return {
        readSync() { calls.push(['directoryRead']); return cursor < names.length ? { name: names[cursor++] } : null; },
        closeSync() { directories--; calls.push(['directoryClose']); },
      };
    },
    openSync(path, flags, mode) {
      const name = nameOf(path); calls.push(['open', name, flags, mode]);
      if (flags === 'wx') {
        assert.equal(mode, 0o600); assert.ok(name.endsWith('.json.pending'));
        if (files.has(name)) throw fail('EEXIST'); add(name, Buffer.alloc(0));
      } else assert.equal(flags, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      const file = files.get(name); if (!file) throw fail('ENOENT');
      const fd = ++nextHandle; handles.set(fd, file); return fd;
    },
    fstatSync(fd) { assert.ok(handles.has(fd)); return stat(handles.get(fd)); },
    readSync(fd, buffer, offset, length, position) {
      assert.ok(handles.has(fd)); assert.equal(buffer.length, limits.result + 1);
      calls.push(['read', length]); const bytes = handles.get(fd).bytes;
      const count = Math.min(length, Math.max(0, bytes.length - position));
      bytes.copy(buffer, offset, position, position + count); return count;
    },
    writeSync(fd, bytes, offset, length, position) {
      calls.push(['write']); assert.ok(handles.has(fd)); assert.equal(position, 0); assert.equal(offset, 0);
      handles.get(fd).bytes = Buffer.from(bytes.subarray(offset, offset + length)); return length;
    },
    closeSync(fd) { assert.ok(handles.delete(fd)); calls.push(['close']); },
    renameSync(from, to) {
      calls.push(['rename']); const file = files.get(nameOf(from)); assert.ok(file);
      // Match rename's replacement semantics, not a fictional no-replace primitive.
      files.set(nameOf(to), file); files.delete(nameOf(from)); file.ctimeMs++;
    },
  };
  const input = { root, identity: { ...identity }, nonce, caseId: 'backend-owner', role: 'caller', records };
  const deps = { fs, tempDirectory: () => '/synthetic-temp' };
  return { fs, input, deps, files, directory, calls, add,
    open: (patch = {}) => openLinuxConsumerExchange({ ...input, ...patch }, deps),
    settled() { assert.equal(handles.size, 0); assert.equal(directories, 0); },
  };
}

function serviceFixture() {
  const f = fixture();
  Object.assign(f.input, { serviceRoot: true, records: manifest([{ ...records[0], name: 'armed.json' }]) });
  f.add('service.json', '{"synthetic":true}');
  f.add('control.sock', '', { mode: 0o140600, isFile: () => false, isSocket: () => true });
  return f;
}

test('independent roles publish canonical records, peek repeatedly and consume once without deleting', () => {
  const f = fixture(); const caller = f.open(); const outer = f.open({ role: 'outer' });
  assert.ok(Object.isFrozen(caller)); assert.deepEqual(Object.keys(caller), ['publish', 'read', 'consume']);
  assert.equal(outer.consume('ready.json'), undefined);
  assert.equal(caller.publish('ready.json', payload), undefined);
  assert.deepEqual(f.files.get('ready.json').bytes, canonical());
  for (let index = 0; index < 3; index++) {
    const read = outer.read('ready.json'); assert.deepEqual(read, payload); assert.ok(Object.isFrozen(read));
  }
  assert.deepEqual(outer.consume('ready.json'), payload); rejected(() => outer.consume('ready.json'));
  assert.deepEqual(outer.read('ready.json'), payload);
  outer.publish('grant.json', { allowed: true }); assert.deepEqual(caller.consume('grant.json'), { allowed: true });
  assert.deepEqual([...f.files.keys()], ['ready.json', 'grant.json']); f.settled();
});

test('configuration is copied; caller mutation cannot redirect identity, root or role', () => {
  const f = fixture(); const exchange = f.open();
  f.input.identity.uid = 9; f.input.root = '/other'; f.input.role = 'outer'; f.input.nonce = 'b'.repeat(32);
  exchange.publish('ready.json', payload); assert.deepEqual(exchange.read('ready.json'), payload); f.settled();
});

test('each fixed name has one writer and one publication attempt, including validation failure', () => {
  for (const mode of ['success', 'payload', 'writer', 'open', 'write', 'close', 'rename', 'existing', 'pending']) {
    const f = fixture(); const exchange = f.open({ role: mode === 'writer' ? 'outer' : 'caller' });
    if (mode === 'existing') f.add('ready.json');
    if (mode === 'pending') f.add('ready.json.pending', '');
    if (['open', 'write', 'rename'].includes(mode)) f.fs[`${mode}Sync`] = () => { throw fail('EIO'); };
    if (mode === 'close') {
      const close = f.fs.closeSync; f.fs.closeSync = fd => { close(fd); throw fail('EIO'); };
    }
    const publish = () => exchange.publish('ready.json', mode === 'payload' ? {} : payload);
    if (mode === 'success') publish(); else rejected(publish);
    const callCount = f.calls.length;
    rejected(() => exchange.publish('ready.json', payload)); assert.equal(f.calls.length, callCount);
    if (mode === 'existing') assert.deepEqual(f.files.get('ready.json').bytes, canonical());
    f.settled();
  }
});

test('only final-name ENOENT before any observation means absent', () => {
  const f = fixture(); const exchange = f.open();
  assert.equal(exchange.read('ready.json'), undefined);
  f.add('ready.json.pending', 'partial'); assert.equal(exchange.read('ready.json'), undefined);
  const lstat = f.fs.lstatSync;
  for (const code of ['EACCES', 'EIO', 'ENOTDIR', 'ELOOP']) {
    f.fs.lstatSync = path => { if (path === `${root}/ready.json`) throw fail(code); return lstat(path); };
    rejected(() => exchange.read('ready.json'));
  }
  f.fs.lstatSync = lstat; f.directory.ino++;
  rejected(() => exchange.read('ready.json')); f.settled();
});

test('manifest is frozen, exact, unique, bounded to 32 fixed basenames and contains only trusted validators', () => {
  for (const invalid of [[], records.slice(), manifest([{ ...records[0], extra: true }]),
    manifest([records[0], records[0]]), manifest([{ ...records[0], validate: null }]),
    ...['../ready.json', '/ready.json', 'ready', 'ready.json/child', 'ready.json\n', 'a.b.json', 'x'.repeat(65) + '.json']
      .map(name => manifest([{ ...records[0], name }])),
    manifest(Array.from({ length: 33 }, (_, index) => ({ ...records[0], name: `record-${index}.json` })))]) {
    const f = fixture(); rejected(() => f.open({ records: invalid })); assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  const full = manifest(Array.from({ length: 32 }, (_, index) => ({ ...records[0], name: `record-${index}.json` })));
  const exchange = f.open({ records: full });
  for (const { name } of full) exchange.publish(name, payload);
  assert.equal(f.files.size, 32); f.settled();
});

test('unknown requested names cause no filesystem activity', () => {
  const f = fixture(); const exchange = f.open(); const count = f.calls.length;
  for (const name of ['unknown.json', '../ready.json', 'ready.json.pending', null, {}, Symbol('PRIVATE')]) {
    rejected(() => exchange.read(name)); rejected(() => exchange.consume(name)); rejected(() => exchange.publish(name, payload));
  }
  assert.equal(f.calls.length, count);
});

test('unknown entries, duplicate entries and simultaneous final/pending names fail closed', () => {
  for (const mode of ['unknown', 'duplicate', 'finalPending']) {
    const f = fixture(); const exchange = f.open();
    if (mode === 'unknown') f.add('control.sock');
    if (mode === 'finalPending') { f.add('ready.json'); f.add('ready.json.pending'); }
    if (mode === 'duplicate') f.fs.opendirSync = () => ({ readSync: () => ({ name: 'ready.json' }), closeSync() {} });
    rejected(() => exchange.read('grant.json')); f.settled();
  }
});

test('directory iteration stops at the fixed bound and closes even on an oversized listing', () => {
  const f = fixture(); let reads = 0; let closed = false;
  const names = ['ready.json', 'grant.json', 'ready.json.pending', 'grant.json.pending', 'PRIVATE'];
  f.fs.opendirSync = () => ({ readSync() { return { name: names[reads++] }; }, closeSync() { closed = true; } });
  rejected(() => f.open()); assert.equal(reads, records.length * 2 + 1); assert.equal(closed, true);
});

for (const [label, patch] of Object.entries({
  uid: { uid: 0 }, gid: { gid: 0 }, mode: { mode: 0o100644 }, specialMode: { mode: 0o104600 },
  link: { nlink: 2 }, symlink: { isSymbolicLink: () => true }, fifo: { isFile: () => false },
  inode: { ino: 0 }, device: { dev: -1 }, missingTime: { mtimeMs: undefined },
})) {
  test(`file metadata rejects ${label} before an open, including pending files`, () => {
    for (const name of ['ready.json', 'ready.json.pending']) {
      const f = fixture(); f.add(name, canonical(), patch); rejected(() => f.open());
      assert.equal(f.calls.some(([operation]) => operation === 'open'), false); f.settled();
    }
  });
}

test('root identity, mode, type and canonical OS-temp parent are mandatory at open', () => {
  for (const patch of [{ uid: 0 }, { gid: 0 }, { mode: 0o40755 }, { ino: 0 },
    { isDirectory: () => false }, { isSymbolicLink: () => true }]) {
    const f = fixture(); Object.assign(f.directory, patch); rejected(() => f.open());
  }
  for (const patch of [{ root: '/other/eky-managed-ns-ABC123' }, { root: `${root}/` },
    { root: '/synthetic-temp/eky-managed-ns-bad' }, { identity: { uid: 0, gid: 1 } },
    { nonce: 'bad' }, { caseId: 'bad\n' }, { role: '../caller' }]) rejected(() => fixture().open(patch));
  const f = fixture(); f.fs.realpathSync = () => '/different'; rejected(() => f.open());
});

test('canonical reader rejects stale, duplicate, missing, extra, malformed and invalid UTF-8 bytes', () => {
  const baseline = canonical().toString();
  for (const bytes of ['', 'x'.repeat(limits.result + 1), baseline.trimEnd(), ` ${baseline}`, `${baseline}\n`,
    baseline.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
    baseline.replace('"schemaVersion":1', '"schemaVersion":2'), baseline.replace(nonce, 'b'.repeat(32)),
    baseline.replace('backend-owner', 'vite-owner'), baseline.replace('ready.json', 'grant.json'),
    baseline.replace('"name":"ready.json",', ''), baseline.replace('"status":"ready"', '"status":"PRIVATE"'),
    baseline.replace('"payload":', '"extra":true,"payload":'), Buffer.from([255, 10])]) {
    const f = fixture(); f.add('ready.json', bytes); rejected(() => f.open()); f.settled();
  }
});

test('stale unrelated records are rejected while polling a missing requested record', () => {
  const f = fixture(); const exchange = f.open();
  f.add('ready.json', canonical().toString().replace(nonce, 'b'.repeat(32)));
  rejected(() => exchange.read('grant.json')); f.settled();
});

test('observed records bind inode, metadata and bytes; disappearance cannot become absence', () => {
  for (const mode of ['inode', 'time', 'bytes', 'missing']) {
    const f = fixture(); const file = f.add('ready.json'); const exchange = f.open();
    assert.deepEqual(exchange.read('ready.json'), payload);
    if (mode === 'inode') f.add('ready.json');
    if (mode === 'time') file.mtimeMs++;
    if (mode === 'bytes') file.bytes = canonical().subarray(0, canonical().length - 1);
    if (mode === 'missing') f.files.delete('ready.json');
    rejected(() => exchange.read('ready.json')); rejected(() => exchange.consume('ready.json')); f.settled();
  }
});

test('changes before open, during bounded read and after fd read cannot pass identity checks', () => {
  for (const mode of ['open', 'path', 'fd', 'root', 'growth', 'missing']) {
    const f = fixture(); const exchange = f.open(); const file = f.add('ready.json');
    const method = mode === 'open' ? 'openSync' : 'readSync'; const original = f.fs[method];
    let changed = false;
    f.fs[method] = (...args) => {
      if (mode === 'open') f.add('ready.json');
      const result = original(...args);
      if (!changed) {
        if (mode === 'path') f.add('ready.json');
        if (mode === 'fd') file.ino++;
        if (mode === 'root') f.directory.ino++;
        if (mode === 'growth') file.bytes = Buffer.alloc(limits.result + 1, 32);
        if (mode === 'missing') f.files.delete('ready.json');
        changed = true;
      }
      return result;
    };
    rejected(() => exchange.read('ready.json')); f.settled();
  }
});

test('partial fd reads succeed; invalid read counts, I/O and close failures are never absence', () => {
  const f = fixture(); f.add('ready.json'); const read = f.fs.readSync;
  f.fs.readSync = (fd, buffer, offset, length, position) => read(fd, buffer, offset, Math.min(3, length), position);
  assert.deepEqual(f.open().read('ready.json'), payload); f.settled();
  for (const mode of ['negative', 'oversized', 'nan', 'throw', 'close']) {
    const g = fixture(); g.add('ready.json');
    if (mode === 'close') {
      const close = g.fs.closeSync; g.fs.closeSync = fd => { close(fd); throw fail('EIO'); };
    } else g.fs.readSync = () => {
      if (mode === 'throw') throw fail('ENOENT');
      return { negative: -1, oversized: limits.result + 2, nan: NaN }[mode];
    };
    rejected(() => g.open()); g.settled();
  }
});

test('publication checks pending identity, final absence again and post-rename inode and bytes', () => {
  for (const mode of ['shortWrite', 'pendingSwap', 'rootSwap', 'lateFinal', 'renamedInode', 'renamedBytes']) {
    const f = fixture(); const exchange = f.open(); const write = f.fs.writeSync; const rename = f.fs.renameSync;
    f.fs.writeSync = (...args) => {
      const count = write(...args);
      if (mode === 'pendingSwap') f.add('ready.json.pending');
      if (mode === 'rootSwap') f.directory.ino++;
      if (mode === 'lateFinal') f.add('ready.json');
      return mode === 'shortWrite' ? count - 1 : count;
    };
    f.fs.renameSync = (...args) => {
      rename(...args);
      if (mode === 'renamedInode') f.add('ready.json');
      if (mode === 'renamedBytes') f.files.get('ready.json').bytes = Buffer.from('PRIVATE');
    };
    rejected(() => exchange.publish('ready.json', payload));
    rejected(() => exchange.publish('ready.json', payload));
    assert.equal(f.calls.filter(([name]) => name === 'rename').length, mode.startsWith('renamed') ? 1 : 0);
    f.settled();
  }
});

test('payload copying rejects accessors, proxies, symbols, non-JSON and cycles without hooks', () => {
  let touched = false;
  const accessor = { get status() { touched = true; throw Error('PRIVATE'); } };
  const proxy = new Proxy({}, { ownKeys() { touched = true; throw Error('PRIVATE'); } });
  const cyclic = {}; cyclic.self = cyclic;
  const hidden = Object.defineProperty({}, 'status', { value: 'ready' });
  const hook = { toJSON() { touched = true; return payload; } };
  for (const value of [accessor, proxy, hidden, hook, { nested: accessor }, { nested: proxy }, cyclic,
    { [Symbol('PRIVATE')]: 1 }, undefined, () => {}, NaN, Infinity, 1n, new Date(), Array(1)]) {
    const f = fixture();
    const exchange = f.open({ records: manifest([{ ...records[0], validate: value => value }]) });
    rejected(() => exchange.publish('ready.json', value));
    assert.equal(f.calls.some(([operation]) => operation === 'open'), false); f.settled();
  }
  assert.equal(touched, false);
});

test('descriptor-safe scope rejects getters and proxies before filesystem access', () => {
  const f = fixture(); let touched = false;
  const getter = Object.defineProperty({ ...f.input }, 'nonce', { get() { touched = true; return nonce; } });
  const proxy = new Proxy(f.input, { getPrototypeOf() { touched = true; return Object.prototype; } });
  for (const input of [getter, proxy, { ...f.input, identity: { get uid() { touched = true; return 1; }, gid: 1 } }]) {
    rejected(() => openLinuxConsumerExchange(input, f.deps));
  }
  assert.equal(touched, false); assert.equal(f.calls.length, 0);
});

test('nested JSON is frozen and deterministic; byte cap includes the complete UTF-8 envelope', () => {
  const generic = manifest([{ ...records[0], validate: value => value }]);
  const f = fixture(); const exchange = f.open({ records: generic });
  const nested = { z: [null, true, 1, { b: 'two', a: 'one' }], a: false };
  exchange.publish('ready.json', nested); const value = exchange.read('ready.json');
  assert.deepEqual(value, nested); assert.ok(Object.isFrozen(value.z[3]));
  assert.deepEqual(Object.keys(value), ['a', 'z']); f.settled();
  const overhead = canonical('ready.json', '').length;
  for (const extra of [0, 1]) {
    const g = fixture(); const writer = g.open({ records: generic });
    const value = 'x'.repeat(limits.result - overhead + extra);
    if (extra) rejected(() => writer.publish('ready.json', value));
    else { writer.publish('ready.json', value); assert.equal(g.files.get('ready.json').bytes.length, limits.result); }
    g.settled();
  }
  const g = fixture(); rejected(() => g.open({ records: generic }).publish('ready.json', '\u00e4'.repeat(limits.result / 2)));
});

test('nofollow and nonblock support cannot silently disappear', () => {
  for (const flag of ['O_RDONLY', 'O_NOFOLLOW', 'O_NONBLOCK']) {
    const f = fixture(); delete f.fs.constants[flag]; rejected(() => f.open());
    assert.equal(f.calls.length, 0);
  }
});

test('a directory read or close failure never permits publication or reports an absent record', () => {
  for (const stage of ['readSync', 'closeSync']) {
    const f = fixture(); const exchange = f.open(); const open = f.fs.opendirSync;
    f.fs.opendirSync = (...args) => {
      const handle = open(...args); const original = handle[stage];
      handle[stage] = () => { if (stage === 'closeSync') original(); throw fail('ENOENT'); }; return handle;
    };
    rejected(() => exchange.read('ready.json')); rejected(() => exchange.publish('ready.json', payload));
    assert.equal(f.files.size, 0); f.settled();
  }
});

test('post-publication readback enforces the expected bytes even when substituted bytes are valid', () => {
  const f = fixture(); const exchange = f.open({ records: manifest([{ ...records[0], validate() {} }]) });
  const rename = f.fs.renameSync;
  f.fs.renameSync = (...args) => { rename(...args); f.files.get('ready.json').bytes = canonical('ready.json', { status: 'other' }); };
  rejected(() => exchange.publish('ready.json', payload)); f.settled();
});

test('a pending name renamed during directory inspection is accepted only with its validated final', () => {
  for (const mode of ['listedPending', 'listedBoth', 'vanished', 'stale']) {
    const f = fixture(); const exchange = f.open(); f.add('ready.json.pending');
    const open = f.fs.opendirSync;
    f.fs.opendirSync = (...args) => {
      const directory = open(...args); const close = directory.closeSync;
      if (mode === 'listedBoth') {
        let reads = 0; directory.readSync = () => reads++ < 2 ? { name: reads === 1 ? 'ready.json.pending' : 'ready.json' } : null;
      }
      directory.closeSync = () => {
        close();
        if (mode === 'vanished') f.files.delete('ready.json.pending');
        else {
          f.fs.renameSync(`${root}/ready.json.pending`, `${root}/ready.json`);
          if (mode === 'stale') f.files.get('ready.json').bytes = canonical().toString().replace(nonce, 'b'.repeat(32));
        }
      };
      return directory;
    };
    if (['listedPending', 'listedBoth'].includes(mode)) assert.deepEqual(exchange.read('ready.json'), payload);
    else rejected(() => exchange.read('ready.json'));
    f.settled();
  }
});

test('service-root opt-in supports the single fixed arm for each owner case without exposing ambient files', () => {
  for (const profile of ['backend', 'vite', 'chromium']) {
    const f = serviceFixture(); const caseId = `${profile}-owner`;
    const caller = f.open({ caseId }); const init = f.open({ caseId, role: 'init' });
    assert.equal(init.read('armed.json'), undefined);
    caller.publish('armed.json', payload);
    assert.deepEqual(init.read('armed.json'), payload); assert.deepEqual(init.read('armed.json'), payload);
    assert.deepEqual(init.consume('armed.json'), payload); rejected(() => init.consume('armed.json'));
    for (const name of ['service.json', 'control.sock']) {
      rejected(() => init.read(name)); rejected(() => init.consume(name)); rejected(() => caller.publish(name, payload));
    }
    assert.deepEqual([...f.files.keys()], ['service.json', 'control.sock', 'armed.json']); f.settled();
  }
});

test('service-root exceptions are default-off and reject other cases, manifests, writers or flag types before I/O', () => {
  for (const mode of ['omitted', 'false']) {
    const f = serviceFixture();
    if (mode === 'omitted') delete f.input.serviceRoot; else f.input.serviceRoot = false;
    rejected(() => f.open());
  }
  for (const patch of [
    ...['backend-control', 'vite-control', 'chromium-control', 'caller', 'unknown-owner'].map(caseId => ({ caseId })),
    { records }, { records: manifest([{ ...records[0], name: 'armed.json', writer: 'init' }]) },
    { records: manifest([{ ...records[0], name: 'other.json' }]) },
    ...[null, 0, 1, 'true', {}, []].map(serviceRoot => ({ serviceRoot })),
    { ambientNames: ['other.json'] },
  ]) {
    const f = serviceFixture(); rejected(() => f.open(patch)); assert.equal(f.calls.length, 0);
  }
  const f = serviceFixture(); let touched = false;
  Object.defineProperty(f.input, 'serviceRoot', { get() { touched = true; return true; } });
  rejected(() => openLinuxConsumerExchange(f.input, f.deps)); assert.equal(touched, false); assert.equal(f.calls.length, 0);
});

test('the service config is mandatory, regular, private, single-link and bounded by its existing limit', () => {
  for (const patch of [
    { uid: 0 }, { gid: 0 }, { mode: 0o100644 }, { mode: 0o104600 }, { nlink: 2 },
    { isFile: () => false }, { isSymbolicLink: () => true }, { dev: -1 }, { ino: 0 }, { mtimeMs: NaN },
    { bytes: Buffer.alloc(0) }, { bytes: Buffer.alloc(linuxServiceLimits.config + 1) },
  ]) {
    const f = serviceFixture(); Object.assign(f.files.get('service.json'), patch);
    rejected(() => f.open()); assert.equal(f.calls.some(([name]) => name === 'open'), false); f.settled();
  }
  const f = serviceFixture(); f.files.delete('service.json'); rejected(() => f.open());
  const g = serviceFixture(); g.files.get('service.json').bytes = Buffer.alloc(linuxServiceLimits.config);
  assert.equal(g.open().read('armed.json'), undefined); g.settled();
});

test('a present ambient control must be a private owned socket with safe device and inode', () => {
  for (const patch of [
    { uid: 0 }, { gid: 0 }, { mode: 0o140666 }, { mode: 0o144600 },
    { isSocket: () => false }, { isSymbolicLink: () => true }, { dev: -1 }, { ino: 0 }, { ino: NaN },
  ]) {
    const f = serviceFixture(); Object.assign(f.files.get('control.sock'), patch);
    rejected(() => f.open()); f.settled();
  }
});

test('ambient identities are revalidated on reads, consumes and publication without deleting anything', () => {
  for (const name of ['service.json', 'control.sock']) {
    for (const property of ['ino', 'dev', 'uid', 'gid', 'mode', ...(name === 'service.json' ? ['mtimeMs', 'ctimeMs', 'nlink'] : [])]) {
      const f = serviceFixture(); const exchange = f.open();
      f.files.get(name)[property]++;
      rejected(() => exchange.read('armed.json')); rejected(() => exchange.consume('armed.json'));
      rejected(() => exchange.publish('armed.json', payload));
      assert.deepEqual([...f.files.keys()], ['service.json', 'control.sock']); f.settled();
    }
  }
  const f = serviceFixture(); const exchange = f.open(); f.files.delete('service.json');
  rejected(() => exchange.read('armed.json')); f.settled();
});

test('socket ENOENT is allowed but never resets a previously retained socket identity', () => {
  const f = serviceFixture(); const socket = f.files.get('control.sock'); f.files.delete('control.sock');
  const caller = f.open(); const init = f.open({ role: 'init' });
  assert.equal(init.read('armed.json'), undefined);
  f.files.set('control.sock', socket); assert.equal(init.read('armed.json'), undefined);
  caller.publish('armed.json', payload); assert.deepEqual(init.read('armed.json'), payload);
  f.files.delete('control.sock'); assert.deepEqual(init.read('armed.json'), payload);
  assert.deepEqual(init.consume('armed.json'), payload);
  f.files.set('control.sock', socket); assert.deepEqual(init.read('armed.json'), payload);
  f.files.set('control.sock', { ...socket, ino: socket.ino + 1 }); rejected(() => init.read('armed.json'));
  f.settled();
});

test('only socket ENOENT is optional; permission and other I/O failures stay failures', () => {
  for (const code of ['EACCES', 'EIO', 'ENOTDIR', 'ELOOP']) {
    const f = serviceFixture(); const exchange = f.open(); const lstat = f.fs.lstatSync;
    f.fs.lstatSync = path => { if (path === `${root}/control.sock`) throw fail(code); return lstat(path); };
    rejected(() => exchange.read('armed.json')); rejected(() => exchange.publish('armed.json', payload)); f.settled();
  }
});

test('socket disposal after enumeration or publication does not invalidate the immutable arm', () => {
  for (const stage of ['enumeration', 'publication']) {
    const f = serviceFixture(); const exchange = f.open();
    if (stage === 'enumeration') {
      const open = f.fs.opendirSync;
      f.fs.opendirSync = (...args) => { const directory = open(...args); f.files.delete('control.sock'); return directory; };
    } else {
      const rename = f.fs.renameSync;
      f.fs.renameSync = (...args) => { rename(...args); f.files.delete('control.sock'); };
    }
    exchange.publish('armed.json', payload); assert.deepEqual(exchange.read('armed.json'), payload);
    assert.deepEqual([...f.files.keys()], ['service.json', 'armed.json']); f.settled();
  }
});

test('ambient replacement during arm read or write fails the post-operation identity check', () => {
  for (const stage of ['read', 'write']) {
    for (const name of ['service.json', 'control.sock']) {
      const f = serviceFixture(); const exchange = f.open();
      if (stage === 'read') exchange.publish('armed.json', payload);
      const operation = `${stage}Sync`; const original = f.fs[operation];
      f.fs[operation] = (...args) => { const result = original(...args); f.files.get(name).ino++; return result; };
      rejected(() => stage === 'read' ? exchange.read('armed.json') : exchange.publish('armed.json', payload));
      f.settled();
    }
  }
});

test('service-root opt-in still rejects unknown files, ambient pending aliases and excess entries', () => {
  for (const name of ['other.json', 'service.json.pending', 'control.sock.pending', 'browser.json']) {
    const f = serviceFixture(); const exchange = f.open(); f.add(name);
    rejected(() => exchange.read('armed.json')); rejected(() => exchange.publish('armed.json', payload)); f.settled();
  }
  const f = serviceFixture(); let reads = 0; let closed = false;
  const names = ['service.json', 'control.sock', 'armed.json', 'armed.json.pending', 'extra.json'];
  f.fs.opendirSync = () => ({ readSync: () => ({ name: names[reads++] }), closeSync() { closed = true; } });
  rejected(() => f.open()); assert.equal(reads, 5); assert.equal(closed, true);
});
