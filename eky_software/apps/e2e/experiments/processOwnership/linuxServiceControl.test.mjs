import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { listenLinuxServiceControl } from './linuxServiceControl.mjs';
import { runLinuxServiceInit } from './linuxServiceInit.mjs';
import { encodeServiceMessage, serviceMessage, serviceDeadlines } from './linuxServiceContract.mjs';

const generation = 'a'.repeat(32);
const root = '/tmp/eky-managed-ns-abcdef';
const config = { version: 1, profile: 'backend', generation, uid: 1001, gid: 1002, root,
  repositoryRoot: '/source', runRoot: '/tmp/eky-e2e/run-abcdef', node: '/opt/node/bin/node',
  startUntil: '45001000000', workUntil: '90001000000', redactedValues: [],
  runtimeConfigPath: '/tmp/eky-e2e/run-abcdef/CASE/runtime-config.json' };
const initialStatus = 'Pid:\t1\nUid:\t1001\t1001\t1001\t1001\nGid:\t1002\t1002\t1002\t1002\n' +
  'Groups:\t\nNoNewPrivs:\t1\n' + ['CapEff', 'CapPrm', 'CapInh', 'CapAmb', 'CapBnd']
    .map(name => `${name}:\t0000000000000000\n`).join('');
const snapshot = (state = 'running') => ({ state, spawned: true, stdout: '', stderr: '', rssBytes: null });
const turn = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
  let now = 1_000_000n;
  let serial = 0;
  const timers = new Map();
  const time = { setTimeout(callback, delay) { timers.set(++serial, { callback, at: now + BigInt(Math.ceil(delay * 1e6)) }); return serial; },
    clearTimeout(id) { timers.delete(id); } };
  let socketExists = false;
  let status = initialStatus;
  let socketInode = 2;
  const bytes = Buffer.from(JSON.stringify(config));
  const metadata = path => {
    if (path === root + '/control.sock' && !socketExists) throw Object.assign(new Error('synthetic'), { code: 'ENOENT' });
    const socket = path.endsWith('control.sock');
    const file = path.endsWith('.json') || path.endsWith('.js') || path.endsWith('.mjs') || path === config.node;
    return { uid: 1001, gid: 1002, dev: 1, ino: socket ? socketInode : 1, nlink: 1,
      mode: socket || file ? 0o600 | (path.endsWith('/node') ? 0o100 : 0) : 0o700,
      size: bytes.length, mtimeMs: 0, ctimeMs: 0,
      isSocket: () => socket, isFile: () => file, isDirectory: () => !socket && !file, isSymbolicLink: () => false };
  };
  const fs = { lstatSync: metadata, realpathSync: path => path, chmodSync() {},
    readFileSync: () => status, openSync: path => path, fstatSync: path => metadata(path), closeSync() {},
    readSync(path, target) { bytes.copy(target); return bytes.length; } };
  class Channel extends EventEmitter {
    writes = [];
    destroyed = false;
    write(value, callback) { this.writes.push(JSON.parse(value.toString('utf8'))); queueMicrotask(() => callback?.()); return true; }
    resume() {}
    connect() { this.connected = true; }
    end(callback) { this.ended = true; callback?.(); }
    destroy() { if (this.destroyed) return; this.destroyed = true; this.emit('close'); }
  }
  const channel = new Channel();
  const server = new EventEmitter();
  server.listen = () => { socketExists = true; server.emit('listening'); };
  server.close = () => { socketExists = false; server.emit('close'); };
  const exits = [];
  const runtime = { platform: 'linux', pid: 1, env: { EKY_E2E: '1', CI: 'true', GITHUB_ACTIONS: 'true' },
    getuid: () => 1001, geteuid: () => 1001, getgid: () => 1002, getegid: () => 1002,
    exit(code) { exits.push(code); } };
  const received = []; let lost = 0; let launches = 0;
  const deadline = serviceDeadlines(config, () => now);
  return { channel, server, exits, timers, received, runtime,
    get launches() { return launches; }, get lost() { return lost; },
    replaceSocket() { socketInode++; },
    advance(ms) {
      now += BigInt(ms) * 1_000_000n;
      for (const [id, timer] of [...timers]) if (timer.at <= now && timers.delete(id)) timer.callback();
    },
    receive(type, sequence, state) { channel.emit('data', encodeServiceMessage(serviceMessage(generation, type, sequence, state))); },
    startControl() {
      return listenLinuxServiceControl({ config, rootIdentity: { dev: 1, ino: 1 } }, deadline,
        value => received.push(value), () => { lost++; },
        { runtime, fs, tempDirectory: () => '/tmp', createListener: () => server, time });
    },
    startInit(changeStatus) {
      status = changeStatus ?? initialStatus; socketExists = true;
      runLinuxServiceInit(root, { runtime, fs, tempDirectory: () => '/tmp', socket: () => channel,
        now: () => now, time, spawnWorkload() {
          launches++;
          return { started: Promise.resolve(snapshot()), snapshot: () => snapshot(),
            rss: () => ({ ...snapshot(), rssBytes: 4096 }) };
        } });
    },
  };
}

async function connected(f) {
  const control = f.startControl(); await control.opened;
  f.server.emit('connection', f.channel);
  f.receive('ready', 0); await control.ready;
  return control;
}

test('control requires generation-correlated ready and response sequence before accepting a workload', async () => {
  const f = fixture(); const control = await connected(f);
  const go = control.request('go');
  assert.equal(f.channel.writes[0].type, 'go');
  f.receive('started', 1, snapshot());
  assert.equal((await go).state, 'running');
  const query = control.request('status');
  f.receive('snapshot', 1, snapshot());
  await assert.rejects(query); assert.equal(f.lost, 1);
  await control.dispose(); assert.throws(() => control.verifyClosed());
});

test('unsolicited ready replay and stale generation fail closed', async () => {
  for (const stale of [false, true]) {
    const f = fixture(); const control = await connected(f);
    const value = serviceMessage(stale ? 'b'.repeat(32) : generation, 'ready', 0);
    f.channel.emit('data', encodeServiceMessage(value));
    assert.equal(f.lost, 1); await assert.rejects(control.request('go'));
    await control.dispose();
  }
});

test('real EOF and actual socket/listener close remain separate from stop acknowledgment', async () => {
  const f = fixture(); const control = await connected(f);
  const stop = control.request('stop'); f.receive('stopping', 1, snapshot()); await stop;
  assert.throws(() => control.verifyClosed());
  f.channel.emit('end'); assert.throws(() => control.verifyClosed());
  f.channel.emit('close'); await control.closed;
  control.verifyClosed(); assert.equal(f.lost, 0);
});

test('owner EOF without requested stop and a replaced socket cannot produce successful closure', async () => {
  for (const replace of [false, true]) {
    const f = fixture(); const control = await connected(f);
    if (replace) { f.replaceSocket(); await assert.rejects(control.request('go')); }
    else f.channel.emit('end');
    await control.dispose(); assert.throws(() => control.verifyClosed());
  }
});

test('second connection poisons ownership and never replaces the retained first channel', async () => {
  const f = fixture(); const control = await connected(f);
  const second = new EventEmitter(); second.destroy = () => {};
  f.server.emit('connection', second);
  assert.equal(f.lost, 1); assert.equal(f.channel.destroyed, true);
  await assert.rejects(control.request('go')); await control.dispose();
});

test('pending response expires at its original deadline and late success cannot revive it', async () => {
  const f = fixture(); const control = await connected(f);
  const query = control.request('go'); f.advance(45_000);
  await assert.rejects(query);
  f.receive('started', 1, snapshot());
  assert.equal(f.received.length, 0); assert.equal(f.lost, 1);
  await control.dispose();
});

test('disposal rejects a pending response without leaving a work-lifetime timer alive', async () => {
  const f = fixture(); const control = await connected(f);
  const go = control.request('go'); f.receive('started', 1, snapshot()); await go;
  const query = control.request('status');
  await control.dispose(); await assert.rejects(query);
  assert.equal(f.timers.size, 0);
});

test('a status response cannot regress a live workload to pending or revive an exited instance', async () => {
  for (const exit of [false, true]) {
    const f = fixture(); const control = await connected(f);
    const go = control.request('go'); f.receive('started', 1, snapshot()); await go;
    if (exit) f.receive('exit', 0, snapshot('exited'));
    const query = control.request('status');
    f.receive('snapshot', 2, snapshot(exit ? 'running' : 'pending'));
    await assert.rejects(query); assert.equal(f.lost, 1); await control.dispose();
  }
});

test('namespace init drops no checks: PID 1, groups, NNP and capabilities precede connection', () => {
  for (const mutate of [text => text.replace('Pid:\t1', 'Pid:\t2'),
    text => text.replace('Groups:\t\n', 'Groups:\t1002\n'),
    text => text.replace('NoNewPrivs:\t1', 'NoNewPrivs:\t0'),
    text => text.replace('CapBnd:\t0000000000000000', 'CapBnd:\t0000000000000001')]) {
    const f = fixture(); f.startInit(mutate(initialStatus));
    assert.deepEqual(f.exits, [42]); assert.equal(f.channel.connected, undefined); assert.equal(f.launches, 0);
  }
});

test('init verifies GO before the real launch seam and responds before deliberate namespace exit', async () => {
  const f = fixture(); f.startInit(); f.channel.emit('connect'); await turn();
  assert.equal(f.channel.writes[0].type, 'ready'); assert.equal(f.launches, 0);
  f.receive('go', 1); await turn();
  assert.equal(f.launches, 1); assert.equal(f.channel.writes[1].type, 'started');
  f.receive('rss', 2); await turn(); assert.equal(f.channel.writes[2].rssBytes, 4096);
  f.receive('stop', 3); await turn();
  assert.equal(f.channel.writes[3].type, 'stopping'); assert.deepEqual(f.exits, [41]);
  assert.equal(f.timers.size, 0);
});

test('init rejects GO plus trailing bytes before workload spawn', async () => {
  const f = fixture(); f.startInit(); f.channel.emit('connect'); await turn();
  assert.deepEqual(f.exits, []); assert.equal(f.channel.writes[0].type, 'ready');
  f.channel.emit('data', Buffer.concat([encodeServiceMessage(serviceMessage(generation, 'go', 1)), Buffer.from('{')]));
  await turn(); assert.equal(f.launches, 0); assert.deepEqual(f.exits, [42]);
});

test('init caller loss and original ready expiry are failures, never normal stop receipts', async () => {
  const f = fixture(); f.startInit(); f.channel.emit('connect'); await turn();
  assert.deepEqual(f.exits, []);
  f.receive('go', 1); await turn(); assert.equal(f.launches, 1); f.channel.emit('end');
  assert.deepEqual(f.exits, [42]);
  const late = fixture(); late.startInit(); late.advance(45_000); late.channel.emit('connect'); await turn();
  assert.deepEqual(late.exits, [42]); assert.equal(late.launches, 0); assert.deepEqual(late.channel.writes, []);
});
