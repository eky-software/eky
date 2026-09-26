import assert from 'node:assert/strict';
import test from 'node:test';
import { validateManagedInitStatus } from './managedNamespaceIdentity.mjs';
import {
  managedLaunchCommand, managedObservationCommand, managedStopCommand,
  managedSystemTools, managerContainment,
} from './managedNamespaceLaunchContract.mjs';
import {
  captureRunningUnit, managedUnitName, managedUnitProperties, parseUnitObservation,
  unitObservationArguments, unitObservationLimit, verifyWaitingWrapperExit,
} from './managedNamespaceUnitContract.mjs';

const generation = 'a'.repeat(32);
const invocation = 'b'.repeat(32);
const unit = managedUnitName(generation);
const identity = { uid: 1001, gid: 1002 };
const status = 'Name:\tnode\nPid:\t1\nUid:\t1001\t1001\t1001\t1001\nGid:\t1002\t1002\t1002\t1002\n' +
  'Groups:\t\nNoNewPrivs:\t1\n' +
  ['CapEff', 'CapPrm', 'CapInh', 'CapAmb', 'CapBnd'].map(name => `${name}:\t0000000000000000\n`).join('');
const running = {
  Id: unit, InvocationID: invocation, LoadState: 'loaded', Transient: 'yes',
  ActiveState: 'active', SubState: 'running', Result: 'success', MainPID: '123', ControlPID: '0',
  ControlGroup: `/system.slice/${unit}`, ExecMainCode: '0', ExecMainStatus: '0',
  ExecMainStartTimestampMonotonic: '1000000', ExecMainExitTimestampMonotonic: '0', ...managedUnitProperties,
};
const exited = { ...running, MainPID: '0', ActiveState: 'failed', SubState: 'failed', Result: 'exit-code', ExecMainCode: '1',
  ExecMainStatus: '41', ExecMainExitTimestampMonotonic: '2000000' };
const wire = value => Object.entries(value).map(([key, item]) => `${key}=${item}\n`).join('');
const receipt = captureRunningUnit(running, generation);

test('managed PID one must have four nonroot IDs, no groups, NNP and all five empty capability sets', () => {
  validateManagedInitStatus(status, identity);
  for (const field of ['Uid', 'Gid']) {
    const id = identity[field === 'Uid' ? 'uid' : 'gid'];
    for (let index = 0; index < 4; index += 1) {
      const ids = [id, id, id, id];
      ids[index] = 0;
      assert.throws(() => validateManagedInitStatus(status.replace(`${field}:\t${[id, id, id, id].join('\t')}`,
        `${field}:\t${ids.join('\t')}`), identity));
    }
  }
  for (const name of ['CapEff', 'CapPrm', 'CapInh', 'CapAmb', 'CapBnd']) {
    assert.throws(() => validateManagedInitStatus(status.replace(`${name}:\t0000000000000000`, `${name}:\t0000000000000001`), identity));
  }
  for (const [before, after] of [['Pid:\t1', 'Pid:\t2'], ['Groups:\t\n', 'Groups:\t1002\n'],
    ['NoNewPrivs:\t1', 'NoNewPrivs:\t0']]) {
    assert.throws(() => validateManagedInitStatus(status.replace(before, after), identity));
  }
  for (const name of ['Groups', 'NoNewPrivs', 'CapBnd']) {
    assert.throws(() => validateManagedInitStatus(status.replace(new RegExp(`^${name}:.*\\n`, 'mu'), ''), identity));
    assert.throws(() => validateManagedInitStatus(`${status}${name}:\t\n`, identity));
  }
  for (const bad of [{ uid: 0, gid: 1002 }, { uid: 1001, gid: 0 }, { uid: '1001', gid: 1002 }]) {
    assert.throws(() => validateManagedInitStatus(status, bad));
  }
});

test('unit names cannot select an existing service, glob, template or systemctl option', () => {
  assert.equal(unit, `eky-e2e-${generation}.service`);
  for (const invalid of ['', 'ssh', '*', '--all', `${generation}\n`, generation.toUpperCase(), 'a'.repeat(33)]) {
    assert.throws(() => managedUnitName(invalid));
  }
  assert.ok(Object.isFrozen(managedUnitProperties));
  assert.ok(Object.isFrozen(unitObservationArguments));
  assert.equal(managedUnitProperties.ExitType, 'main');
  assert.equal(managedUnitProperties.KillMode, 'control-group');
});

test('complete closed manager response binds startup to one invocation and normal wrapper exit', () => {
  const observed = parseUnitObservation(wire(running), generation);
  assert.ok(Object.isFrozen(observed));
  assert.deepEqual(captureRunningUnit(observed, generation), receipt);
  assert.ok(Object.isFrozen(receipt));
  assert.deepEqual(verifyWaitingWrapperExit(parseUnitObservation(wire(exited), generation), receipt), {
    generation, waitingWrapper: 'normalExit',
  });
  // systemd may have removed the empty cgroup; normal wrapper wait, not this
  // path's existence or absence, is the separate namespace reaping prerequisite.
  verifyWaitingWrapperExit({ ...exited, ControlGroup: '' }, receipt);
});

test('manager parser rejects partial, duplicate, unknown, huge, malformed or wrong-generation records', () => {
  const text = wire(running);
  for (const invalid of [text.slice(0, -1), `${text}Id=${unit}\n`, `${text}Environment=secret\n`,
    text.replace('Transient=yes\n', ''), text.replace('Id=', 'Unknown='), text.replace('\n', '\r\n'),
    text.replace('success', 'success\0'), text.replace('success', '\uFFFD'),
    'x'.repeat(unitObservationLimit), text.replace('MainPID=123', 'MainPID=18446744073709551616'),
    text.replace('MainPID=123', 'MainPID=0123'), text.replace('MainPID=123', 'MainPID=-1')]) {
    assert.throws(() => parseUnitObservation(invalid, generation), /observation unverified/u);
  }
  assert.throws(() => parseUnitObservation(text, invocation));
  for (const key of Object.keys(managedUnitProperties)) {
    assert.throws(() => parseUnitObservation(wire({ ...running, [key]: 'wrong' }), generation));
  }
});

test('GO prerequisite rejects a finished, starting, failed, foreign or unbound wrapper', () => {
  for (const mutation of [exited, { ActiveState: 'activating' }, { SubState: 'start' }, { Result: 'timeout' },
    { MainPID: '0' }, { ControlPID: '55' }, { ControlGroup: '' }, { ControlGroup: '/system.slice/foreign.service' },
    { ExecMainCode: '1' }, { ExecMainStatus: '1' }, { ExecMainStartTimestampMonotonic: '0' },
    { ExecMainExitTimestampMonotonic: '2000000' }, { InvocationID: '' }, { Transient: 'no' }]) {
    assert.throws(() => captureRunningUnit({ ...running, ...mutation }, generation));
  }
});

test('normal wrapper gate rejects early collection, forced exit, changed invocation or start timestamp', () => {
  for (const mutation of [running, { LoadState: 'not-found' }, { ActiveState: 'inactive' }, { SubState: 'dead' },
    { Result: 'signal' }, { Result: 'timeout' }, { MainPID: '55' }, { ControlPID: '55' },
    { ExecMainCode: '2' }, { ExecMainStatus: '9' }, { ExecMainStatus: '0' },
    { InvocationID: 'c'.repeat(32) }, { ExecMainStartTimestampMonotonic: '1000001' },
    { ExecMainExitTimestampMonotonic: '0' }, { ExecMainExitTimestampMonotonic: '999999' }]) {
    assert.throws(() => verifyWaitingWrapperExit({ ...exited, ...mutation }, receipt));
  }
  for (const stale of [{ ...receipt, generation: invocation }, { ...receipt, unit: 'ssh.service' },
    { ...receipt, invocation: generation }, { ...receipt, started: '999999' }, { ...receipt, extra: true }]) {
    assert.throws(() => verifyWaitingWrapperExit(exited, stale));
  }
});

test('object inputs cannot smuggle accessor, inherited, symbol or non-string observations', () => {
  const accessor = { ...exited };
  Object.defineProperty(accessor, 'Result', { enumerable: true, get() { assert.fail('accessor executed'); } });
  for (const invalid of [accessor, Object.create(exited), { ...exited, [Symbol('extra')]: true },
    { ...exited, ExecMainStatus: 41 }, { ...exited, Result: { toString() { assert.fail('coercion executed'); } } }]) {
    assert.throws(() => verifyWaitingWrapperExit(invalid, receipt), /observation unverified/u);
  }
  const accessorReceipt = { ...receipt };
  Object.defineProperty(accessorReceipt, 'unit', { enumerable: true, get() { assert.fail('accessor executed'); } });
  assert.throws(() => verifyWaitingWrapperExit(exited, accessorReceipt), /observation unverified/u);
});

const launchConfig = { generation, started: '1000000', ...identity,
  root: '/tmp/eky-managed-ns-fixture', node: '/opt/node/bin/node',
  init: '/source/experiments/managedNamespaceInit.mjs' };

test('fixed manager command starts only trusted OS tools before an irreversible nonroot Node exec', () => {
  const value = managedLaunchCommand(launchConfig);
  assert.equal(value.file, '/usr/bin/sudo');
  assert.deepEqual(value.env, { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' });
  assert.deepEqual(value.args.slice(0, 3), ['-n', '--', '/usr/bin/systemd-run']);
  assert.ok(value.args.includes('--expand-environment=no'));
  assert.ok(value.args.includes(`--unit=${unit}`));
  for (const [name, setting] of Object.entries(managedUnitProperties)) {
    assert.ok(value.args.includes(`--property=${name}=${setting}`));
  }
  const namespaceIndex = value.args.indexOf(managedSystemTools.namespace);
  assert.deepEqual(value.args.slice(namespaceIndex, namespaceIndex + 8), [
    '/usr/bin/unshare', '--mount', '--propagation=private', '--mount-proc=/proc',
    '--pid', '--fork', '--kill-child=SIGKILL', '--',
  ]);
  const privilegeIndex = value.args.indexOf(managedSystemTools.credentials);
  const nodeIndex = value.args.indexOf(launchConfig.node);
  assert.deepEqual(value.args.slice(privilegeIndex, nodeIndex), [
    '/usr/bin/setpriv', '--reuid=1001', '--regid=1002', '--clear-groups', '--no-new-privs',
    '--bounding-set=-all', '--inh-caps=-all', '--ambient-caps=-all', '--',
  ]);
  assert.ok(privilegeIndex > namespaceIndex);
  assert.equal(value.args[nodeIndex + 1], launchConfig.init);
  assert.ok(value.args.includes('--property=Delegate=no'));
  assert.ok(value.args.includes('--property=InaccessiblePaths=-/run/dbus -/run/systemd/private -/run/user'));
  assert.ok(value.args.includes('--property=SuccessExitStatus='));
  assert.ok(!value.args.includes('--property=SuccessExitStatus=41'));
  assert.ok(value.args.includes('--property=RemainAfterExit=no'));
  assert.ok(value.args.includes('--property=CollectMode=inactive'));
  assert.deepEqual(managerContainment, { start: 5000, runtime: 10000, stop: 1000 });
  assert.ok(value.args.includes('--property=TimeoutStartSec=5000ms'));
  assert.ok(value.args.includes('--property=RuntimeMaxSec=10000ms'));
  assert.ok(value.args.includes('--property=TimeoutStopSec=1000ms'));
  for (const forbidden of ['--user', '--map-current-user', '--collect', '--scope', '--wait', '--shell', '/bin/sh']) {
    assert.ok(!value.args.includes(forbidden));
  }
  assert.ok(Object.isFrozen(value) && Object.isFrozen(value.args) && Object.isFrozen(value.env));
});

test('launch grammar rejects execution hooks, shell/specifier paths, root identity and arbitrary properties', () => {
  for (const key of ['node', 'root', 'init']) {
    for (const replacement of ['/tmp/a%u', '/tmp/a$USER', '/tmp/a b', '/tmp/a\nb', '/tmp/a/../b',
      '/tmp//b', '/tmp/b/', 'relative', '--property=User=root', '/tmp/$(id)', '/tmp/`id`']) {
      assert.throws(() => managedLaunchCommand({ ...launchConfig, [key]: replacement }));
    }
  }
  for (const extra of [{ env: { LD_PRELOAD: 'hook' } }, { properties: ['ExecStart=/bin/sh'] },
    { args: ['--user'] }, { uid: 0 }, { gid: 0 }, { root: '/tmp/foreign' },
    { uid: '1001' }, { gid: '1002' }, { started: 1000000 },
    { node: '/bin/sh' }, { init: '/tmp/other.mjs' }, { [Symbol('hidden')]: true }]) {
    assert.throws(() => managedLaunchCommand({ ...launchConfig, ...extra }));
  }
  const accessor = { ...launchConfig };
  Object.defineProperty(accessor, 'node', { enumerable: true, get() { assert.fail('accessor executed'); } });
  assert.throws(() => managedLaunchCommand(accessor), /configuration invalid/u);
  for (const key of ['generation', 'started', 'uid', 'gid', 'node', 'root', 'init']) {
    assert.throws(() => managedLaunchCommand({ ...launchConfig,
      [key]: { toString() { assert.fail('coercion executed'); } } }), /configuration invalid/u);
  }
});

test('manager operations have no caller-controlled verb, wildcard, global kill or shell', () => {
  const observation = managedObservationCommand(generation);
  const stop = managedStopCommand(generation);
  assert.deepEqual(observation.args, ['-n', '--', '/usr/bin/systemctl', '--system', '--no-ask-password',
    ...unitObservationArguments, '--', unit]);
  assert.deepEqual(stop.args, ['-n', '--', '/usr/bin/systemctl', '--system', '--no-ask-password', '--no-block', 'stop', '--', unit]);
  for (const invalid of ['', '*', '--all', 'ssh.service', generation + '\n']) {
    assert.throws(() => managedObservationCommand(invalid));
    assert.throws(() => managedStopCommand(invalid));
  }
});

test('fixed profile forbids retained active/exited state and rejects clean signal receipts', () => {
  assert.equal(managedUnitProperties.RemainAfterExit, 'no');
  assert.equal(managedUnitProperties.CollectMode, 'inactive');
  for (const signal of ['1', '2', '13', '15']) {
    for (const state of [{ ActiveState: 'active', SubState: 'exited' },
      { ActiveState: 'inactive', SubState: 'dead' }]) {
      assert.throws(() => verifyWaitingWrapperExit({ ...exited, ...state, Result: 'success',
        ExecMainCode: '2', ExecMainStatus: signal }, receipt));
    }
  }
  assert.throws(() => verifyWaitingWrapperExit({ ...exited, Result: 'success' }, receipt));
  assert.throws(() => verifyWaitingWrapperExit({ ...exited, RemainAfterExit: 'yes' }, receipt));
  assert.throws(() => verifyWaitingWrapperExit({ ...exited, CollectMode: 'inactive-or-failed' }, receipt));
});
