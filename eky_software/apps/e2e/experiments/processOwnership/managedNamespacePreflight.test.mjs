import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectManagedHost } from './managedNamespacePreflight.mjs';
import { budgets, createDeadline } from './pidNamespaceContract.mjs';
import { managedSystemTools } from './managedNamespaceLaunchContract.mjs';

function fixture() {
  let elapsed = 0;
  let sequence = 0;
  const timers = new Map();
  const records = new Map();
  const calls = [];
  const pending = new Map();
  const errors = new Map();
  const aliases = new Map();
  let filesystemType = 0x63677270;
  function record(path, kind, mode) {
    records.set(path, { uid: 0, gid: 0, mode, dev: 7, ino: records.size + 1,
      isSymbolicLink: () => false, isFile: () => kind === 'file',
      isDirectory: () => kind === 'directory', isSocket: () => kind === 'socket' });
  }
  for (const path of ['/', '/usr', '/usr/bin', '/run', '/run/systemd', '/run/systemd/system',
    '/sys', '/sys/fs', '/sys/fs/cgroup']) record(path, 'directory', 0o40755);
  for (const [name, path] of Object.entries(managedSystemTools)) {
    record(path, 'file', name === 'sudo' ? 0o104755 : 0o100755);
  }
  record('/run/systemd/private', 'socket', 0o140700);
  for (const name of ['cgroup.controllers', 'cgroup.subtree_control']) record(`/sys/fs/cgroup/${name}`, 'file', 0o100644);
  async function operation(name, path, value) {
    assert.ok(records.has(path), 'host access must remain inside the fixed allowlist');
    calls.push([name, path]);
    const key = `${name}:${path}`;
    if (errors.has(key)) throw errors.get(key);
    if (pending.has(key)) await pending.get(key);
    return value();
  }
  const fs = {
    lstat: path => operation('lstat', path, () => records.get(path)),
    realpath: path => operation('realpath', path, () => aliases.get(path) ?? path),
    statfs: path => operation('statfs', path, () => ({ type: filesystemType })),
  };
  const time = {
    setTimeout(fn, delay) { timers.set(++sequence, { fn, at: elapsed + delay }); return sequence; },
    clearTimeout(id) { timers.delete(id); },
  };
  const input = { fs, time,
    deadline: createDeadline('1000000', () => 1000000n + BigInt(elapsed) * 1000000n),
    runtime: { platform: 'linux', env: { CI: 'true', GITHUB_ACTIONS: 'true', EKY_E2E: '1',
      PATH: '/PRIVATE', SYSTEMD_BUS_ADDRESS: 'PRIVATE', XDG_RUNTIME_DIR: '/PRIVATE' },
    getuid: () => 1001, geteuid: () => 1001, getgid: () => 1002, getegid: () => 1002 },
  };
  return { input, records, calls, errors, aliases, timers,
    setType(value) { filesystemType = value; },
    set(ms) { elapsed = ms; },
    advance(ms) {
      elapsed = ms;
      for (const [id, timer] of [...timers]) if (timer.at <= ms && timers.delete(id)) timer.fn();
    },
    hold(name, path) {
      let release;
      pending.set(`${name}:${path}`, new Promise(resolve => { release = resolve; }));
      return release;
    },
  };
}

async function rejects(promise, reason, stage) {
  await assert.rejects(promise, error => {
    assert.equal(error.message, 'Managed namespace host metadata unverified');
    assert.equal(error.reason, reason);
    assert.equal(error.stage, stage);
    assert.equal(error.cause, undefined);
    assert.ok(!JSON.stringify(error).includes('PRIVATE'));
    return true;
  });
}

test('metadata-only preflight uses fixed host paths, never opens data or invokes a process', async () => {
  const f = fixture();
  const receipt = await inspectManagedHost(f.input);
  assert.deepEqual(receipt, { kind: 'managedHostMetadata', uid: 1001, gid: 1002 });
  assert.ok(Object.isFrozen(receipt));
  assert.equal(f.timers.size, 0);
  assert.deepEqual(new Set(f.calls.filter(([name]) => name === 'lstat').map(([, path]) => path)), new Set(f.records.keys()));
  assert.equal(f.calls.filter(([name]) => name === 'statfs').length, 1);
  assert.ok(f.calls.every(([name]) => ['lstat', 'realpath', 'statfs'].includes(name)));
  assert.ok(!JSON.stringify(f.calls).includes('PRIVATE'));
  assert.ok(!Object.hasOwn(receipt, 'authorized') && !Object.hasOwn(receipt, 'cleanup'));
});

test('context and identity fail before every host read or timer', async () => {
  for (const mutate of [f => { f.input.runtime.platform = 'win32'; },
    ...['CI', 'GITHUB_ACTIONS', 'EKY_E2E'].map(key => f => { delete f.input.runtime.env[key]; })]) {
    const f = fixture(); mutate(f);
    await rejects(inspectManagedHost(f.input), 'invalidContext', 'context');
    assert.deepEqual(f.calls, []); assert.equal(f.timers.size, 0);
  }
  for (const key of ['getuid', 'geteuid', 'getgid', 'getegid']) {
    for (const value of [0, -1, 1.5, NaN, 4294967295]) {
      const f = fixture(); f.input.runtime[key] = () => value;
      await rejects(inspectManagedHost(f.input), 'invalidIdentity', 'context');
      assert.deepEqual(f.calls, []); assert.equal(f.timers.size, 0);
    }
  }
});

test('an expired original readiness budget prevents all host reads', async () => {
  const f = fixture(); f.set(budgets.ready);
  await rejects(inspectManagedHost(f.input), 'deadlineExceeded', 'context');
  assert.deepEqual(f.calls, []); assert.equal(f.timers.size, 0);
});

test('every tool and ancestor must be protected, root-owned and canonical', async () => {
  for (const path of ['/', '/usr', '/usr/bin', ...Object.values(managedSystemTools)]) {
    for (const mutate of [s => { s.uid = 1001; }, s => { s.mode |= 0o020; }, s => { s.mode |= 0o002; },
      s => { s.isSymbolicLink = () => true; }]) {
      const f = fixture(); mutate(f.records.get(path));
      await rejects(inspectManagedHost(f.input), 'metadataInvalid', 'tools');
      assert.ok(!f.calls.some(([, value]) => value.startsWith('/run')));
    }
    const f = fixture(); f.aliases.set(path, '/PRIVATE/replacement');
    await rejects(inspectManagedHost(f.input), 'metadataInvalid', 'tools');
  }
});

test('tools must be regular executable files, with setuid permitted only for sudo', async () => {
  for (const [name, path] of Object.entries(managedSystemTools)) {
    for (const mutate of [s => { s.isFile = () => false; }, s => { s.mode &= ~0o111; },
      s => { s.mode |= 0o2000; }, s => { s.mode |= 0o1000; }]) {
      const f = fixture(); mutate(f.records.get(path));
      await rejects(inspectManagedHost(f.input), 'metadataInvalid', 'tools');
    }
    const f = fixture();
    if (name === 'sudo') f.records.get(path).mode &= ~0o4000;
    else f.records.get(path).mode |= 0o4000;
    await rejects(inspectManagedHost(f.input), 'metadataInvalid', 'tools');
  }
});

test('filesystem identities and mode values cannot be missing, rounded or malformed', async () => {
  for (const [key, values] of [['dev', [-1, NaN, Number.MAX_SAFE_INTEGER + 1, '7']],
    ['ino', [0, -1, NaN, Number.MAX_SAFE_INTEGER + 1, '8']], ['mode', [-1, NaN, 0x10000, '0755']]]) {
    for (const value of values) {
      const f = fixture(); f.records.get(managedSystemTools.manager)[key] = value;
      await rejects(inspectManagedHost(f.input), 'metadataInvalid', 'tools');
    }
  }
});

test('systemd metadata requires protected directories and an actual root-owned socket', async () => {
  for (const path of ['/run', '/run/systemd', '/run/systemd/system', '/run/systemd/private']) {
    for (const mutate of [s => { s.uid = 1001; }, s => { s.mode |= 0o022; },
      s => { s.isSymbolicLink = () => true; }, s => { s.isDirectory = () => false; s.isSocket = () => false; }]) {
      const f = fixture(); mutate(f.records.get(path));
      await rejects(inspectManagedHost(f.input), 'metadataInvalid', 'manager');
      assert.ok(!f.calls.some(([, value]) => value.startsWith('/sys')));
    }
  }
});

test('a cgroup-looking directory is insufficient without the actual v2 filesystem type', async () => {
  for (const type of [0x27e0eb, 0x01021994, null, '0x63677270', undefined]) {
    const f = fixture(); f.setType(type);
    await rejects(inspectManagedHost(f.input), 'cgroupV2Unverified', 'cgroup');
    assert.ok(!f.calls.some(([, value]) => value.endsWith('/cgroup.subtree_control')));
  }
});

test('the cgroup mount, ancestors and interface entries must be protected without symlinks', async () => {
  for (const path of ['/sys', '/sys/fs', '/sys/fs/cgroup', '/sys/fs/cgroup/cgroup.controllers', '/sys/fs/cgroup/cgroup.subtree_control']) {
    for (const mutate of [s => { s.uid = 1001; }, s => { s.mode |= 0o022; },
      s => { s.isSymbolicLink = () => true; }, s => { s.isDirectory = () => false; s.isFile = () => false; }]) {
      const f = fixture(); mutate(f.records.get(path));
      await rejects(inspectManagedHost(f.input), 'metadataInvalid', 'cgroup');
    }
  }
});

test('missing, unreadable and failed metadata never expose raw host information or retry', async () => {
  for (const [operation, path, stage] of [['lstat', managedSystemTools.sudo, 'tools'],
    ['realpath', '/run/systemd/system', 'manager'], ['statfs', '/sys/fs/cgroup', 'cgroup']]) {
    for (const code of ['ENOENT', 'EACCES', 'EIO']) {
      const f = fixture();
      f.errors.set(`${operation}:${path}`, Object.assign(Error('PRIVATE host information'), { code, path: '/PRIVATE' }));
      await rejects(inspectManagedHost(f.input), 'metadataReadFailed', stage);
      assert.equal(f.calls.filter(([name, value]) => name === operation && value === path).length, 1);
      assert.equal(f.timers.size, 0);
    }
  }
});

test('hung metadata is bounded by the original deadline and late completion performs no further IO', async () => {
  const f = fixture(); f.set(budgets.ready - 7);
  const release = f.hold('lstat', '/');
  const promise = inspectManagedHost(f.input);
  assert.equal([...f.timers.values()][0].at, budgets.ready);
  assert.deepEqual(f.calls, [['lstat', '/']]);
  f.advance(budgets.ready);
  await rejects(promise, 'deadlineExceeded', 'tools');
  const calls = structuredClone(f.calls);
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.calls, calls); assert.equal(f.timers.size, 0);
});

test('late successful metadata cannot grant a receipt when the timer callback has not run', async () => {
  const f = fixture();
  const original = f.input.fs.statfs;
  f.input.fs.statfs = async path => { const value = await original(path); f.set(budgets.ready); return value; };
  await rejects(inspectManagedHost(f.input), 'deadlineExceeded', 'cgroup');
  assert.equal(f.timers.size, 0);
  assert.ok(!f.calls.some(([, path]) => path.endsWith('/cgroup.subtree_control')));
});

test('the final promise continuation rechecks the original deadline before returning metadata', async () => {
  const f = fixture(); const deadline = f.input.deadline;
  let finalChecks = 0;
  f.input.deadline = { ...deadline, check(phase) {
    if (f.calls.at(-1)?.[0] === 'realpath' && f.calls.at(-1)?.[1].endsWith('/cgroup.subtree_control')) {
      if (++finalChecks === 3) f.set(budgets.ready);
    }
    deadline.check(phase);
  } };
  await rejects(inspectManagedHost(f.input), 'deadlineExceeded', 'cgroup');
  assert.equal(finalChecks, 3); assert.equal(f.timers.size, 0);
});
