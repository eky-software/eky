import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { sandboxProbeProfile, parseNamespaceProbe, confirmsAppArmorRestriction, safeProfileFailure,
  parseProfileCreated, readProfileFailure, sandboxProfileCommand, probeCancellation,
  finishSandboxProbe, sandboxInspectionEnvironment } from './linuxSandboxProbe.mjs';

const token = 'a'.repeat(32);
const executable = '/home/runner/work/project/project/eky_software/node_modules/.pnpm/electron@43.7.6/node_modules/electron/dist/electron';
test('profile attaches to one exact Electron path and grants only userns', () => {
  const profile = sandboxProbeProfile(executable, token);
  assert.equal(profile.path, `/etc/apparmor.d/eky-k-inspection-${token}`);
  assert.equal(profile.bytes, `abi <abi/4.0>,\nprofile eky-k-inspection-${token} "${executable}" flags=(unconfined) {\n  userns,\n}\n`);
});
for (const path of [executable + '\nuserns,', executable.replace('project/', '*/'),
  executable.replace('project/', 'project/../'), executable.replace('electron@43.7.6', 'electron@latest'),
  executable + '-other', executable.replace('project/', 'project"/')]) {
  test('rejects unsafe or different attachment: ' + JSON.stringify(path), () => {
    assert.throws(() => sandboxProbeProfile(path, token));
  });
}
test('profile names cannot carry syntax or change global policy', () => {
  for (const value of ['', 'x'.repeat(32), token + '\n', token + '*']) {
    assert.throws(() => sandboxProbeProfile(executable, value));
  }
});
test('namespace result requires dropped privileges and a closed outcome', () => {
  for (const outcome of ['allowed', 'denied', 'restricted', 'unverified']) {
    assert.equal(parseNamespaceProbe(JSON.stringify({ identityVerified: true, pid: 34, outcome })).outcome, outcome);
  }
  for (const value of [{ identityVerified: false, pid: 34, outcome: 'denied' },
    { identityVerified: true, pid: 0, outcome: 'denied' },
    { identityVerified: true, pid: 34, outcome: 'expected' },
    { identityVerified: true, pid: 34, outcome: 'denied', raw: 'unexpected' }]) {
    assert.throws(() => parseNamespaceProbe(JSON.stringify(value)));
  }
  assert.throws(() => parseNamespaceProbe(' '.repeat(513)));
});
test('restriction attribution binds one kernel record to the actual control PID', () => {
  const denied = 'audit: apparmor="DENIED" operation="userns_create" profile="unconfined" pid=34 comm="namespace-probe"';
  const transition = 'audit: apparmor="AUDIT" operation="userns_create" profile="unconfined" pid=34 target="unprivileged_userns"';
  assert.equal(confirmsAppArmorRestriction(denied, 34), true);
  assert.equal(confirmsAppArmorRestriction(transition, 34), true);
  for (const line of [denied.replace('pid=34', 'pid=345'), denied.replace('profile="unconfined"', 'profile="other"'),
    denied.replace('operation="userns_create"', 'operation="mount"'), transition.replace('target="unprivileged_userns"', 'target="other"'),
    denied.replace('apparmor="DENIED"', 'apparmor="ALLOWED"'),
    'apparmor="DENIED" operation="userns_create"\nprofile="unconfined" pid=34']) {
    assert.equal(confirmsAppArmorRestriction(line, 34), false);
  }
});
test('experiment leaves the normal Linux service launch unchanged', async () => {
  const source = await readFile(new URL('./linuxSandboxProbe.mjs', import.meta.url), 'utf8');
  assert.ok(source.includes("O_EXCL | constants.O_NOFOLLOW"));
  assert.ok(source.includes("--no-new-privs"));
  assert.ok(source.includes("--bounding-set=-all"));
  assert.ok(source.includes("--skip-cache"));
  assert.ok(source.includes("--remove"));
  assert.ok(source.includes("runLinuxProfileInspectionProof.mjs"));
  assert.ok(source.includes('cancellation.signal, sandboxInspectionEnvironment(process.execPath)'));
  assert.doesNotMatch(source, /--no-sandbox|4755|sysctl.*(?:-w|write)/u);
});

test('privileged-helper projection omits raw error, path, stack and unknown codes', () => {
  for (const code of ['ENOENT', 'EACCES', 'EPERM', 'EEXIST', 'ELOOP', 1, 'private-path']) {
    const value = safeProfileFailure({ code, message: 'private-message', stack: 'private-stack', stderr: 'private-output' });
    assert.deepEqual(value, { operation: 'linuxSandboxProfile', status: 'failed', phase: 'preflight',
      causeCode: typeof code === 'number' ? 'commandExitFailed' : code === 'private-path' ? 'unverified' : code });
    assert.doesNotMatch(JSON.stringify(value), /private-/u);
  }
});

test('creation receipt binds cleanup to the actual file and this install token', () => {
  const receipt = { operation: 'linuxSandboxProfile', status: 'created', token, dev: 2, ino: 3 };
  assert.deepEqual(parseProfileCreated(JSON.stringify(receipt), token), receipt);
  for (const value of [{ ...receipt, token: 'b'.repeat(32) }, { ...receipt, status: 'existing' },
    { ...receipt, dev: -1 }, { ...receipt, ino: 0 }, { ...receipt, ino: 1.5 },
    { ...receipt, ino: Number.MAX_SAFE_INTEGER + 1 }, { ...receipt, other: 'unexpected' }]) {
    assert.throws(() => parseProfileCreated(JSON.stringify(value), token));
  }
  assert.throws(() => parseProfileCreated('', token));
});

test('helper failure reader accepts only the reviewed projection', () => {
  const failure = { operation: 'linuxSandboxProfile', status: 'failed', phase: 'profileLoad', causeCode: 'commandExitFailed' };
  const output = value => 'LINUX_SANDBOX_PROBE_FAILED\n' + JSON.stringify(value) + '\n';
  assert.deepEqual(readProfileFailure(output(failure)), failure);
  for (const value of [{ ...failure, phase: 'private-path' }, { ...failure, causeCode: 'private-message' },
    { ...failure, raw: 'private-message' }, { ...failure, status: 'passed' }]) {
    assert.equal(readProfileFailure(output(value)), null);
  }
  assert.equal(readProfileFailure('unexpected-output\n' + output(failure)), null);
  assert.equal(readProfileFailure('x'.repeat(1025)), null);
});

test('root helper receives only fixed CI guards across sudo env_reset', () => {
  for (const mode of ['--install-profile', '--remove-profile']) {
    const args = sandboxProfileCommand('/approved/node', '/approved/probe.mjs', mode, token, { dev: 1, ino: 2 });
    assert.deepEqual(args.slice(0, 10), ['-n', '--', '/usr/bin/env', '--ignore-environment',
      'EKY_E2E=1', 'CI=true', 'GITHUB_ACTIONS=true', 'PATH=/usr/bin:/bin', 'LANG=C', 'LC_ALL=C']);
    assert.equal(args[10], '/approved/node');
    assert.equal(args[12], mode);
    assert.equal(args[13], token);
    assert.deepEqual(args.slice(14), mode === '--remove-profile' ? ['1', '2'] : []);
    assert.doesNotMatch(args.join(' '), /--preserve-env|sudoers/u);
  }
});

test('inspection preparation resolves the selected Node without inherited environment hooks', () => {
  const node = '/opt/hostedtoolcache/node/24.19.0/x64/bin/node';
  assert.deepEqual(sandboxInspectionEnvironment(node), { EKY_E2E: '1', CI: 'true',
    GITHUB_ACTIONS: 'true', PATH: '/opt/hostedtoolcache/node/24.19.0/x64/bin:/usr/bin:/bin',
    LANG: 'C', LC_ALL: 'C', EKY_INSPECTION_BUILD_FAILURE_EVIDENCE: 'sandboxProbe' });
  for (const invalid of ['node', '/approved/../node', '/approved//node', '/approved/node\n',
    '/approved:other/node', '/approved/node.exe', '/approved/node\0', '/approved path/node']) {
    assert.throws(() => sandboxInspectionEnvironment(invalid));
  }
});

test('Linux preparation launches the same actual Node through its restricted PATH', {
  skip: process.platform !== 'linux',
}, () => {
  const version = execFileSync('node', ['--version'], { env: sandboxInspectionEnvironment(process.execPath),
    timeout: 2000, maxBuffer: 512, encoding: 'utf8', shell: false });
  assert.equal(version.trim(), process.version);
});

test('handled cancellation aborts workload but can drain receipt-bound profile cleanup', () => {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const runtime = new EventEmitter();
    const current = probeCancellation(runtime);
    assert.equal(current.signal.aborted, false);
    runtime.emit(signal);
    assert.equal(current.signal.aborted, true);
    assert.throws(() => current.signal.throwIfAborted());
    current.dispose();
    assert.equal(runtime.listenerCount('SIGINT'), 0);
    assert.equal(runtime.listenerCount('SIGTERM'), 0);
  }
});

for (const phase of ['isolationControl', 'profileCleanup']) {
  test(`cancellation during ${phase} cannot publish success after completed cleanup`, async () => {
    const runtime = new EventEmitter();
    let failurePhase = null;
    const current = probeCancellation(runtime, () => { failurePhase ??= phase; });
    const cleanup = await Promise.resolve().then(() => { runtime.emit('SIGTERM'); return 'completed'; });
    const result = finishSandboxProbe({ inspectionPassed: true }, {
      phase: 'profileCleanup', failurePhase, cleanup, cancelled: current.signal.aborted,
    });
    assert.deepEqual(result, { inspectionPassed: true, cleanup: 'completed', cancelled: true,
      phase, status: 'failed' });
    current.dispose();
  });
}

test('terminal result preserves first failure and cleanup failure independently', () => {
  assert.deepEqual(finishSandboxProbe({ inspectionPassed: false }, {
    phase: 'profileCleanup', failurePhase: 'inspection', cleanup: 'unverified', cancelled: true,
  }), { inspectionPassed: false, phase: 'inspection', cleanup: 'unverified', cancelled: true, status: 'failed' });
  assert.equal(finishSandboxProbe({}, {
    phase: 'profileCleanup', failurePhase: null, cleanup: 'completed', cancelled: false,
  }).status, 'passed');
});
