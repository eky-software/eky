import assert from 'node:assert/strict';
import test from 'node:test';
import { createManagedChromiumFailureWriter, readManagedChromiumFailure,
  validateManagedChromiumDiagnostic } from './managedChromiumFailure.mjs';

const scope = { root: '/tmp/eky-managed-ns-ABC123', generation: 'a'.repeat(32),
  uid: 1001, gid: 1002, rootReceipt: { dev: 2, ino: 3 }, tempRoot: '/tmp' };
const path = `${scope.root}/chromium-failure.json`;
const empty = status => ({ status, phase: null, reason: null });
const valid = { status: 'valid', phase: 'launch', reason: 'operationFailed' };

function fixture() {
  const calls = [];
  let bytes;
  const root = { ...scope.rootReceipt, uid: scope.uid, gid: scope.gid, mode: 0o40700,
    isDirectory: () => true, isSymbolicLink: () => false };
  const file = { dev: 2, ino: 4, uid: scope.uid, gid: scope.gid, mode: 0o100600,
    nlink: 1, mtimeMs: 1, ctimeMs: 1, isFile: () => true, isSymbolicLink: () => false };
  const stat = () => ({ ...file, size: bytes?.length ?? 0 });
  const missing = () => Object.assign(Error('PRIVATE'), { code: 'ENOENT' });
  const fs = {
    constants: { O_RDONLY: 0, O_NOFOLLOW: 131072, O_NONBLOCK: 2048 },
    realpathSync: value => value,
    lstatSync(value) {
      calls.push(['lstat', value]);
      if (value === scope.root) return { ...root };
      assert.equal(value, path);
      if (bytes === undefined) throw missing();
      return stat();
    },
    openSync(value, flags, mode) {
      calls.push(['open', value, flags, mode]); assert.equal(value, path);
      if (flags === 'wx') {
        assert.equal(mode, 0o600);
        if (bytes !== undefined) throw Object.assign(Error('PRIVATE'), { code: 'EEXIST' });
        bytes = Buffer.alloc(0);
      } else assert.equal(flags, fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      return 7;
    },
    fstatSync(fd) { assert.equal(fd, 7); return stat(); },
    writeSync(fd, value, offset, length, position) {
      assert.equal(fd, 7); assert.equal(position, 0); assert.equal(offset, 0);
      calls.push(['write', length]); bytes = Buffer.from(value.subarray(offset, offset + length)); return length;
    },
    readSync(fd, buffer, offset, length, position) {
      assert.equal(fd, 7); calls.push(['read', buffer.length]);
      const count = Math.min(length, Math.max(0, bytes.length - position));
      bytes.copy(buffer, offset, position, position + count); return count;
    },
    closeSync(fd) { assert.equal(fd, 7); calls.push(['close']); },
  };
  const runtime = { getuid: () => scope.uid, geteuid: () => scope.uid,
    getgid: () => scope.gid, getegid: () => scope.gid };
  const options = { fs, runtime };
  const writer = createManagedChromiumFailureWriter(scope, options);
  return { calls, root, file, fs, runtime, options, writer,
    read: () => readManagedChromiumFailure(scope, options),
    get bytes() { return bytes; }, set bytes(value) { bytes = Buffer.from(value); } };
}

test('writer is inert until first failure; exact canonical bytes round trip to a frozen diagnostic', () => {
  const f = fixture();
  assert.deepEqual(f.calls, []);
  assert.equal(f.writer('launch', 'operationFailed'), true);
  assert.equal(f.bytes.toString(), `${JSON.stringify({ version: 1, generation: scope.generation,
    phase: 'launch', reason: 'operationFailed' })}\n`);
  assert.ok(f.bytes.length <= 256);
  assert.deepEqual(f.read(), valid); assert.ok(Object.isFrozen(f.read()));
  assert.ok(f.calls.filter(([name]) => name === 'read').every(([, size]) => size === 257));
});

test('first write attempt wins even when it fails; an existing file is never overwritten', () => {
  for (const mode of ['success', 'openError', 'invalidPhase', 'existing']) {
    const f = fixture();
    if (mode === 'openError') f.fs.openSync = () => { throw Error('PRIVATE'); };
    if (mode === 'existing') f.bytes = 'existing';
    assert.equal(f.writer(mode === 'invalidPhase' ? 'unknown' : 'assert', 'postconditionFailed'), mode === 'success');
    const before = f.bytes?.toString(); const count = f.calls.length;
    assert.equal(f.writer('close', 'operationFailed'), false);
    assert.equal(f.calls.length, count); assert.equal(f.bytes?.toString(), before);
  }
});

test('scope is copied without I/O and later mutation cannot redirect the writer', () => {
  const f = fixture(); const mutable = structuredClone(scope);
  const write = createManagedChromiumFailureWriter(mutable, f.options);
  mutable.root = '/other'; mutable.rootReceipt.ino = 99;
  assert.equal(write('setup', 'operationFailed'), true);
  assert.deepEqual(f.read(), { status: 'valid', phase: 'setup', reason: 'operationFailed' });
});

test('invalid scope cannot authorize filesystem access or reveal caught errors', () => {
  const badScopes = [null, { ...scope, generation: 'invalid' }, { ...scope, extra: true },
    { ...scope, tempRoot: 'relative' }, { ...scope, rootReceipt: { dev: 2, ino: 0 } }];
  for (const value of badScopes) {
    const f = fixture();
    assert.equal(createManagedChromiumFailureWriter(value, f.options)('setup', 'operationFailed'), false);
    assert.deepEqual(readManagedChromiumFailure(value, f.options), empty('unavailable'));
    assert.deepEqual(f.calls, []);
  }
});

test('all closed phases and reasons round trip without raw diagnostics', () => {
  for (const phase of ['setup', 'import', 'launch', 'assert', 'close', 'tempCleanup']) {
    for (const reason of ['operationFailed', 'deadlineExceeded', 'postconditionFailed']) {
      const f = fixture(); assert.equal(f.writer(phase, reason), true);
      assert.deepEqual(f.read(), { status: 'valid', phase, reason });
      assert.doesNotMatch(f.bytes.toString(), /PRIVATE|\/tmp|stack|message/u);
    }
  }
});

test('only confirmed absence in the trusted root is absent', () => {
  const f = fixture(); assert.deepEqual(f.read(), empty('absent'));
  assert.equal(f.calls.some(([name]) => name === 'open'), false);
  f.root.ino++; assert.deepEqual(f.read(), empty('unavailable'));
});

for (const mode of ['rootInode', 'rootLink', 'identity', 'tempParent', 'readError', 'closeError', 'flagsMissing']) {
  test(`reader and writer refuse uncertain ownership/I/O: ${mode}`, () => {
    const f = fixture(); f.writer('launch', 'operationFailed');
    if (mode === 'rootInode') f.root.ino++;
    if (mode === 'rootLink') f.root.isSymbolicLink = () => true;
    if (mode === 'identity') f.runtime.geteuid = () => 0;
    if (mode === 'tempParent') f.fs.realpathSync = value => value === '/tmp' ? '/elsewhere' : value;
    if (mode === 'readError') f.fs.readSync = () => { throw Error('PRIVATE'); };
    if (mode === 'closeError') f.fs.closeSync = () => { throw Error('PRIVATE'); };
    if (mode === 'flagsMissing') delete f.fs.constants.O_NOFOLLOW;
    assert.deepEqual(f.read(), empty('unavailable'));
  });
}

for (const [name, change] of Object.entries({
  owner: { uid: 0 }, group: { gid: 0 }, permission: { mode: 0o100644 }, hardlink: { nlink: 2 },
  symlink: { isSymbolicLink: () => true }, fifo: { isFile: () => false }, inode: { ino: 0 },
})) {
  test(`invalid file metadata is rejected before opening: ${name}`, () => {
    const f = fixture(); f.writer('launch', 'operationFailed'); Object.assign(f.file, change); f.calls.length = 0;
    assert.deepEqual(f.read(), empty('invalid'));
    assert.equal(f.calls.some(([operation]) => operation === 'open'), false);
  });
}

test('bounded canonical reader rejects malformed, duplicate, extra and stale data', () => {
  const baseline = `${JSON.stringify({ version: 1, generation: scope.generation, phase: 'launch', reason: 'operationFailed' })}\n`;
  for (const value of ['', 'x'.repeat(257), baseline.trimEnd(), `${baseline}\n`, ` ${baseline}`,
    baseline.replace('"version":1', '"version":1,"version":1'),
    baseline.replace('"version":1', '"version":2'), baseline.replace('launch', 'arbitrary'),
    baseline.replace(scope.generation, 'b'.repeat(32)), baseline.replace('operationFailed', 'PRIVATE'),
    baseline.replace('}', ',"message":"PRIVATE"}'), baseline.replace('"version":1,', ''),
    Buffer.from([0xff, 10])]) {
    const f = fixture(); f.bytes = value;
    assert.deepEqual(f.read(), empty('invalid'));
  }
});

test('replacement or content mutation while reading is unavailable, not trusted evidence', () => {
  for (const mode of ['fd', 'path', 'root', 'timestamp']) {
    const f = fixture(); f.writer('launch', 'operationFailed');
    const read = f.fs.readSync;
    f.fs.readSync = (...args) => {
      const count = read(...args);
      if (mode === 'fd') f.file.ino++;
      if (mode === 'root') f.root.ino++;
      if (mode === 'timestamp') f.file.mtimeMs++;
      if (mode === 'path') {
        const stat = f.fs.lstatSync;
        f.fs.lstatSync = value => value === path ? { ...stat(value), ino: 99 } : stat(value);
      }
      return count;
    };
    assert.deepEqual(f.read(), empty('unavailable'));
    assert.equal(f.calls.filter(([name]) => name === 'close').length, 2);
  }
});

test('partial writes and close failures return false and do not retry or delete', () => {
  for (const mode of ['partial', 'close', 'root']) {
    const f = fixture();
    if (mode === 'partial') f.fs.writeSync = () => 1;
    if (mode === 'close') f.fs.closeSync = () => { throw Error('PRIVATE'); };
    if (mode === 'root') f.root.ino++;
    assert.equal(f.writer('close', 'operationFailed'), false);
    assert.equal(f.writer('assert', 'postconditionFailed'), false);
  }
});

test('public validator accepts only exact data fields and never invokes accessors/proxies', () => {
  for (const value of [valid, ...['absent', 'invalid', 'unavailable'].map(empty)]) {
    assert.deepEqual(validateManagedChromiumDiagnostic(value), value);
    assert.notEqual(validateManagedChromiumDiagnostic(value), value);
  }
  let touched = false;
  const accessor = { status: 'valid', phase: 'launch', get reason() { touched = true; throw Error('PRIVATE'); } };
  const proxy = new Proxy({}, { ownKeys() { touched = true; throw Error('PRIVATE'); } });
  for (const value of [null, [], {}, accessor, proxy, { ...valid, extra: true },
    { ...valid, phase: null }, { ...valid, reason: 'PRIVATE' }, { ...valid, status: 'absent' },
    { status: 'unavailable' }, { ...empty('unknown') }, Object.create(valid)]) {
    assert.throws(() => validateManagedChromiumDiagnostic(value), error => error.reason === 'reportFailed' && !error.message.includes('PRIVATE'));
  }
  assert.equal(touched, false);
});
