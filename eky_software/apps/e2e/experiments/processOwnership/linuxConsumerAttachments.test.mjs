import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createLinuxConsumerAttachments } from './linuxConsumerAttachments.mjs';

const errorCode = 'E2E_LINUX_CONSUMER_ATTACHMENT_UNVERIFIED';
const mib = 1024 * 1024;
const cleanup = Object.freeze({ context: 'completed', api: 'completed', web: 'failed', backend: 'completed',
  webPort: 'completed', backendPort: 'completed', artifacts: 'completed', priorCleanup: 'unverified', runRoot: 'retained' });
const cleanupOptions = () => ({ body: JSON.stringify({ schemaVersion: 1, cleanup }), contentType: 'application/json' });
const rejection = action => assert.rejects(action, error => {
  assert.equal(error.message, errorCode); assert.equal(error.cause, undefined); assert.equal(error.code, undefined);
  return true;
});

function fixture(t) {
  const temp = fs.realpathSync(tmpdir());
  const evidence = fs.mkdtempSync(join(temp, 'eky-consumer-attachments-'));
  fs.chmodSync(evidence, 0o700);
  const root = join(evidence, 'evidence'); fs.mkdirSync(root, { mode: 0o700 });
  const base = join(temp, 'eky-e2e'); fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  const testRoot = fs.mkdtempSync(join(base, 'run-'));
  fs.chmodSync(testRoot, 0o700);
  const artifacts = join(testRoot, 'artifacts'); fs.mkdirSync(artifacts, { mode: 0o700 });
  const source = join(artifacts, 'synthetic.txt'); fs.writeFileSync(source, 'synthetic source', { mode: 0o600 });
  t.after(() => { fs.rmSync(evidence, { recursive: true, force: true }); fs.rmSync(testRoot, { recursive: true, force: true }); });
  return { root, evidence, testRoot, artifacts, source,
    make(overrides = {}, readTestRoot = () => testRoot) {
      return createLinuxConsumerAttachments({ root, readTestRoot }, { fs: { ...fs, ...overrides } });
    },
    output: index => join(root, `attachment-${String(index).padStart(2, '0')}.bin`),
  };
}

test('awaited string and Buffer attachments persist independent bytes using only indexed destinations', async t => {
  const f = fixture(t); const sink = f.make();
  assert.deepEqual(Object.keys(sink), ['attach', 'readServiceCleanup']);
  assert.ok(Object.isFrozen(sink)); assert.equal(sink.readServiceCleanup(), undefined);
  const body = Buffer.from('synthetic bytes');
  const attached = sink.attach('../../unchecked-name', { body }); body.fill(0);
  assert.ok(attached instanceof Promise); await attached;
  await sink.attach('text', { body: 'synthetic string', contentType: 'text/plain' });
  await sink.attach('empty', { body: Buffer.alloc(0) });
  assert.deepEqual(fs.readdirSync(f.root).sort(), ['attachment-01.bin', 'attachment-02.bin', 'attachment-03.bin']);
  assert.equal(fs.readFileSync(f.output(1), 'utf8'), 'synthetic bytes');
  assert.equal(fs.readFileSync(f.output(2), 'utf8'), 'synthetic string');
  assert.equal(fs.statSync(f.output(3)).size, 0);
});

test('path attachment closes its stable source before destination creation and survives source removal', async t => {
  const f = fixture(t); const calls = []; const handles = new Map();
  const sink = f.make({
    openSync(path, flags, mode) {
      calls.push(path === f.source ? 'source open' : 'destination open');
      if (path !== f.source) { assert.equal(handles.size, 0); assert.equal(flags, 'wx'); assert.equal(mode, 0o600); }
      const fd = fs.openSync(path, flags, mode); handles.set(fd, path); return fd;
    },
    closeSync(fd) { calls.push(handles.get(fd) === f.source ? 'source close' : 'destination close'); fs.closeSync(fd); handles.delete(fd); },
  });
  await sink.attach('source', { path: f.source, contentType: 'text/plain' });
  assert.deepEqual(calls, ['source open', 'source close', 'destination open', 'destination close']);
  assert.equal(handles.size, 0); assert.equal(fs.readFileSync(f.source, 'utf8'), 'synthetic source');
  fs.unlinkSync(f.source);
  assert.equal(fs.readFileSync(f.output(1), 'utf8'), 'synthetic source');
});

test('cleanup is parsed only after persistence and remains readable after the fixture root is gone', async t => {
  const f = fixture(t); let sink; let closed = false;
  sink = f.make({ closeSync(fd) {
    assert.equal(sink.readServiceCleanup(), undefined); fs.closeSync(fd); closed = true;
  } });
  fs.rmSync(f.testRoot, { recursive: true });
  await sink.attach('service-fixture-cleanup', cleanupOptions());
  assert.equal(closed, true); assert.deepEqual(sink.readServiceCleanup(), cleanup);
  assert.ok(Object.isFrozen(sink.readServiceCleanup()));
  assert.equal(fs.readFileSync(f.output(1), 'utf8'), cleanupOptions().body);
  await rejection(() => sink.attach('service-fixture-cleanup', cleanupOptions()));
  assert.throws(() => sink.readServiceCleanup(), { message: errorCode });
  assert.equal(fs.readdirSync(f.root).length, 1);
});

test('malformed and non-closed cleanup bodies are retained but never exposed as successful evidence', async t => {
  const bodies = [
    '{', 'null', '[]', JSON.stringify({ schemaVersion: 2, cleanup }),
    JSON.stringify({ schemaVersion: 1, cleanup, privateMessage: 'synthetic' }),
    JSON.stringify({ schemaVersion: 1, cleanup: { ...cleanup, privateMessage: 'synthetic' } }),
    JSON.stringify({ schemaVersion: 1, cleanup: { ...cleanup, context: 'success' } }),
    JSON.stringify({ schemaVersion: 1, cleanup: { ...cleanup, priorCleanup: 'completed' } }),
    JSON.stringify({ schemaVersion: 1, cleanup: { ...cleanup, runRoot: 'deleted' } }),
    JSON.stringify({ schemaVersion: 1, cleanup: { ...cleanup, artifacts: undefined } }),
    `{"schemaVersion":1,"schemaVersion":1,"cleanup":${JSON.stringify(cleanup)}}`,
    Buffer.from([0xff]),
  ];
  for (const body of bodies) {
    const f = fixture(t); const sink = f.make();
    await rejection(() => sink.attach('service-fixture-cleanup', { body, contentType: 'application/json' }));
    assert.deepEqual(fs.readFileSync(f.output(1)), Buffer.from(body));
    assert.throws(() => sink.readServiceCleanup(), { message: errorCode });
    await rejection(() => sink.attach('service-fixture-cleanup', cleanupOptions()));
  }
});

test('options require exactly one bounded body or path and do not invoke getters or proxies', async t => {
  const invalid = [{}, { body: 'x', path: 'x' }, { body: undefined }, { body: {} }, { path: 12 },
    { body: 'x', extra: true }, { body: 'x', contentType: 'x'.repeat(129) }, { body: 'x', contentType: 1 }];
  let invoked = false;
  invalid.push({ get body() { invoked = true; throw new Error('PRIVATE getter'); } },
    new Proxy({}, { ownKeys() { invoked = true; throw new Error('PRIVATE proxy'); } }));
  for (const options of invalid) {
    const f = fixture(t); const sink = f.make();
    await rejection(() => sink.attach('synthetic', options)); assert.deepEqual(fs.readdirSync(f.root), []);
  }
  assert.equal(invoked, false);
  const f = fixture(t); const sink = f.make();
  for (const name of ['', 'x'.repeat(257), null, {}]) await rejection(() => sink.attach(name, { body: '' }));
  await rejection(() => sink.attach('service-fixture-cleanup', { path: f.source, contentType: 'application/json' }));
  assert.throws(() => sink.readServiceCleanup(), { message: errorCode });
});

test('attachment count is capped at 32, including failed attempts', async t => {
  const f = fixture(t); const sink = f.make();
  await rejection(() => sink.attach('bad', {}));
  for (let index = 1; index < 32; index++) await sink.attach('same-name', { body: '' });
  await rejection(() => sink.attach('over-count', { body: '' }));
  assert.equal(fs.readdirSync(f.root).length, 31); assert.equal(fs.existsSync(f.output(33)), false);
});

test('the exact per-file byte boundary applies to Buffer, UTF-8 string and path attachments', async t => {
  for (const kind of ['buffer', 'string', 'path']) {
    const f = fixture(t); const sink = f.make();
    const bytes = Buffer.alloc(4 * mib, 65);
    const options = size => {
      if (kind === 'buffer') return { body: Buffer.alloc(size, 65) };
      if (kind === 'string') return { body: '\u00e4'.repeat(size / 2) };
      fs.writeFileSync(f.source, Buffer.alloc(size, 65)); return { path: f.source };
    };
    await sink.attach('exact', options(bytes.length));
    assert.equal(fs.statSync(f.output(1)).size, bytes.length);
    await rejection(() => sink.attach('over', options(bytes.length + 2)));
    assert.equal(fs.existsSync(f.output(2)), false);
  }
});

test('total persisted bytes stop at 16 MiB without discarding earlier evidence', async t => {
  const f = fixture(t); const sink = f.make(); const body = Buffer.alloc(4 * mib, 65);
  for (let index = 0; index < 4; index++) await sink.attach('chunk', { body });
  await sink.attach('empty', { body: '' });
  await rejection(() => sink.attach('over-total', { body: 'x' }));
  assert.equal(fs.readdirSync(f.root).length, 5);
  assert.equal(fs.readFileSync(f.output(4)).length, 4 * mib);
});

test('relative, outside-root, directory and overlapping evidence sources are refused before copying', async t => {
  const f = fixture(t); const sink = f.make();
  const outside = join(f.evidence, 'outside.txt'); fs.writeFileSync(outside, 'synthetic outside');
  for (const path of ['relative.txt', outside, f.artifacts, join(f.artifacts, '..', '..', 'outside.txt')]) {
    await rejection(() => sink.attach('path', { path }));
  }
  assert.deepEqual(fs.readdirSync(f.root), []);
  const overlapping = createLinuxConsumerAttachments({ root: f.artifacts, readTestRoot: () => f.testRoot });
  await rejection(() => overlapping.attach('path', { path: f.source }));
  assert.equal(fs.readFileSync(f.source, 'utf8'), 'synthetic source');
});

test('actual directory links are refused for the evidence root and source ancestors', async t => {
  const f = fixture(t); const link = join(f.evidence, 'alias');
  fs.symlinkSync(f.root, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => createLinuxConsumerAttachments({ root: link, readTestRoot: () => f.testRoot }), { message: errorCode });
  const alias = join(f.testRoot, 'alias');
  fs.symlinkSync(f.artifacts, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await rejection(() => f.make().attach('path', { path: join(alias, 'synthetic.txt') }));
  assert.deepEqual(fs.readdirSync(f.root), []);
});

test('evidence roots must be existing descendants of OS temp and keep their captured identity', async t => {
  const f = fixture(t);
  for (const root of [tmpdir(), process.cwd(), join(f.evidence, 'missing'), 'relative']) {
    assert.throws(() => createLinuxConsumerAttachments({ root, readTestRoot: () => f.testRoot }), { message: errorCode });
  }
  const sink = f.make(); fs.renameSync(f.root, join(f.evidence, 'old')); fs.mkdirSync(f.root, { mode: 0o700 });
  await rejection(() => sink.attach('body', { body: 'synthetic' }));
  assert.deepEqual(fs.readdirSync(f.root), []);
});

test('the source callback cannot switch to another fixture root after the first copy', async t => {
  const f = fixture(t); const other = fixture(t); let current = f.testRoot;
  const sink = f.make({}, () => current);
  await sink.attach('first', { path: f.source }); current = other.testRoot;
  await rejection(() => sink.attach('other', { path: other.source }));
  assert.equal(fs.readdirSync(f.root).length, 1);
});

test('source replacement between inspection and open is rejected and the real descriptor closes', async t => {
  const f = fixture(t); let closes = 0;
  const sink = f.make({
    openSync(path, flags, mode) {
      if (path === f.source) {
        fs.renameSync(path, join(f.artifacts, 'previous.txt')); fs.writeFileSync(path, 'replacement', { mode: 0o600 });
      }
      return fs.openSync(path, flags, mode);
    }, closeSync(fd) { fs.closeSync(fd); closes++; },
  });
  await rejection(() => sink.attach('path', { path: f.source }));
  assert.equal(closes, 1); assert.deepEqual(fs.readdirSync(f.root), []);
});

test('short reads and writes complete fully; early EOF or changing source metadata cannot pass', async t => {
  const f = fixture(t);
  await f.make({
    readSync(fd, buffer, offset, length, position) { return fs.readSync(fd, buffer, offset, Math.min(3, length), position); },
    writeSync(fd, buffer, offset, length, position) { return fs.writeSync(fd, buffer, offset, Math.min(2, length), position); },
  }).attach('partial', { path: f.source });
  assert.equal(fs.readFileSync(f.output(1), 'utf8'), 'synthetic source');
  for (const mode of ['eof', 'metadata', 'link', 'symlink']) {
    const other = fixture(t); let read = false; let closed = false;
    const sink = other.make({
      readSync(...args) { read = true; return mode === 'eof' ? 0 : fs.readSync(...args); },
      fstatSync(...args) {
        const stat = fs.fstatSync(...args);
        if (mode === 'metadata' && read) return Object.assign(Object.create(stat), { mtimeNs: stat.mtimeNs + 1n });
        if (mode === 'link') return Object.assign(Object.create(stat), { nlink: 2n });
        if (mode === 'symlink') return Object.assign(Object.create(stat), { isSymbolicLink: () => true });
        return stat;
      }, closeSync(fd) { fs.closeSync(fd); closed = true; },
    });
    await rejection(() => sink.attach('bad', { path: other.source }));
    assert.equal(closed, true); assert.deepEqual(fs.readdirSync(other.root), []);
  }
});

test('source-close failure prevents destination creation and exposes no raw filesystem error', async t => {
  const f = fixture(t); const sink = f.make({ closeSync(fd) { fs.closeSync(fd); throw new Error('PRIVATE source close'); } });
  await rejection(() => sink.attach('path', { path: f.source }));
  assert.deepEqual(fs.readdirSync(f.root), []); assert.ok(fs.existsSync(f.source));
});

test('exclusive output refuses existing files and retains partial writes or failed closes without cleanup promotion', async t => {
  for (const mode of ['existing', 'write', 'close']) {
    const f = fixture(t); const overrides = {};
    if (mode === 'existing') fs.writeFileSync(f.output(1), 'prior evidence', { mode: 0o600 });
    if (mode === 'write') overrides.writeSync = () => { throw new Error('PRIVATE write'); };
    if (mode === 'close') overrides.closeSync = fd => { fs.closeSync(fd); throw new Error('PRIVATE close'); };
    const sink = f.make(overrides);
    await rejection(() => sink.attach('service-fixture-cleanup', cleanupOptions()));
    assert.ok(fs.existsSync(f.output(1)));
    assert.throws(() => sink.readServiceCleanup(), { message: errorCode });
    if (mode === 'existing') assert.equal(fs.readFileSync(f.output(1), 'utf8'), 'prior evidence');
  }
});

// Exercise Linux metadata/flag guards over real Windows files without a Linux process.
function linuxFilesystem(patch = () => ({})) {
  const handles = new Map();
  const metadata = (stat, path) => Object.assign(Object.create(stat), {
    uid: 1001n, gid: 1002n, mode: stat.isDirectory() ? 0o40700n : 0o100600n, ...patch(path, stat),
  });
  const constants = { ...fs.constants, O_NOFOLLOW: fs.constants.O_NOFOLLOW || 0x20000,
    O_NONBLOCK: fs.constants.O_NONBLOCK || 0x800 };
  return { ...fs, constants,
    lstatSync(path, options) { return metadata(fs.lstatSync(path, options), path); },
    fstatSync(fd, options) { return metadata(fs.fstatSync(fd, options), handles.get(fd)); },
    openSync(path, flags, mode) {
      if (typeof flags === 'number') assert.equal(flags, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const fd = fs.openSync(path, typeof flags === 'number' ? fs.constants.O_RDONLY : flags, mode);
      handles.set(fd, path); return fd;
    }, closeSync(fd) { fs.closeSync(fd); handles.delete(fd); },
  };
}
const linuxRuntime = { platform: 'linux', getuid: () => 1001, getgid: () => 1002 };

test('Linux requires owned private directories, private output and no-follow/nonblocking source opens', async t => {
  const good = fixture(t);
  const sink = createLinuxConsumerAttachments({ root: good.root, readTestRoot: () => good.testRoot }, {
    fs: linuxFilesystem(path => path === good.source ? { mode: 0o100644n } : {}), runtime: linuxRuntime,
  });
  await sink.attach('private-parent', { path: good.source });
  assert.equal(fs.readFileSync(good.output(1), 'utf8'), 'synthetic source');
  for (const change of [{ uid: 0n }, { gid: 0n }, { mode: 0o40755n }]) {
    const f = fixture(t);
    assert.throws(() => createLinuxConsumerAttachments({ root: f.root, readTestRoot: () => f.testRoot }, {
      fs: linuxFilesystem(path => path === f.root ? change : {}), runtime: linuxRuntime,
    }), { message: errorCode });
  }
  for (const flag of ['O_NOFOLLOW', 'O_NONBLOCK']) {
    const f = fixture(t); const filesystem = linuxFilesystem(); filesystem.constants[flag] = 0;
    assert.throws(() => createLinuxConsumerAttachments({ root: f.root, readTestRoot: () => f.testRoot }, {
      fs: filesystem, runtime: linuxRuntime,
    }), { message: errorCode });
  }
});

test('Linux refuses unowned or writable sources and non-private destinations without deleting evidence', async t => {
  for (const mode of ['source-owner', 'source-mode', 'directory-owner', 'output-mode']) {
    const f = fixture(t);
    const filesystem = linuxFilesystem(path => {
      if (mode === 'source-owner' && path === f.source) return { uid: 1003n };
      if (mode === 'source-mode' && path === f.source) return { mode: 0o100666n };
      if (mode === 'directory-owner' && path === f.artifacts) return { gid: 1003n };
      if (mode === 'output-mode' && path === f.output(1)) return { mode: 0o100644n };
      return {};
    });
    const sink = createLinuxConsumerAttachments({ root: f.root, readTestRoot: () => f.testRoot }, { fs: filesystem, runtime: linuxRuntime });
    await rejection(() => sink.attach('bad', { path: f.source }));
    assert.equal(fs.readFileSync(f.source, 'utf8'), 'synthetic source');
    assert.equal(fs.existsSync(f.output(1)), mode === 'output-mode');
  }
});
