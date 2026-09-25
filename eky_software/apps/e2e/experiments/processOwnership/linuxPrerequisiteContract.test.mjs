import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  maximumReadBytes, maximumResultBytes, parseCgroupEvents, parseCgroupType,
  parseProbeContext, PrerequisiteFailure, resolveOwnCgroup,
  serializePrerequisiteResult, unknownObservation, validatePrerequisiteResult,
} from './linuxPrerequisiteContract.mjs';

const binding = { consumer: 'system-api', checkoutSha: 'a'.repeat(40), runId: '123', runAttempt: '1' };
const environment = { EKY_E2E: '1', GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1' };
const argv = ['--consumer=system-api', `--checkout-sha=${binding.checkoutSha}`];
const mount = '10 1 0:20 / /synthetic/cgroup rw,nosuid - cgroup2 cgroup rw\n';

function mappedResult() {
  return {
    ...unknownObservation(binding), observation: 'complete', reason: 'observed',
    cgroupV2: 'mapped', cgroupType: 'domain', mountMode: 'rw', events: 'observed',
    killAvailability: 'present',
    accessHints: { createChild: 'allowed', writeProcs: 'allowed', writeKill: 'allowed' },
  };
}

test('context requires both approval guards and exact uncoerced evidence binding', () => {
  assert.deepEqual(parseProbeContext(argv, environment), binding);
  assert.deepEqual(parseProbeContext([...argv].reverse(), environment), binding);
  assert.equal(parseProbeContext(['--consumer=web-chromium', argv[1]], environment).consumer, 'web-chromium');
  for (const patch of [
    { EKY_E2E: undefined }, { EKY_E2E: 1 }, { EKY_E2E: 'true' },
    { GITHUB_ACTIONS: undefined }, { GITHUB_ACTIONS: true }, { GITHUB_ACTIONS: 'TRUE' },
    { GITHUB_RUN_ID: '' }, { GITHUB_RUN_ID: 123 }, { GITHUB_RUN_ID: '1\n' },
    { GITHUB_RUN_ID: '1e3' }, { GITHUB_RUN_ID: '9'.repeat(33) },
    { GITHUB_RUN_ATTEMPT: '0' }, { GITHUB_RUN_ATTEMPT: '-1' },
    { GITHUB_RUN_ATTEMPT: '01' }, { GITHUB_RUN_ATTEMPT: '1.5' },
    { GITHUB_RUN_ATTEMPT: undefined },
  ]) assert.equal(parseProbeContext(argv, { ...environment, ...patch }), null);
  for (const args of [
    [], [argv[0]], [...argv, '--extra=secret'], [argv[0], argv[0]],
    ['--consumer=electron', argv[1]], [`${argv[0]}\n`, argv[1]],
    [argv[0], '--checkout-sha='], [argv[0], `--checkout-sha=${'A'.repeat(40)}`],
    [argv[0], `--checkout-sha=${'a'.repeat(41)}`], [argv[0], `${argv[1]}\n`],
  ]) assert.equal(parseProbeContext(args, environment), null);
});

test('only named environment fields are projected; checkout is the supplied SHA, not head env', () => {
  const source = { ...environment, GITHUB_SHA: 'b'.repeat(40), SECRET: 'synthetic-private' };
  assert.deepEqual(parseProbeContext(argv, source), binding);
  assert.equal(serializePrerequisiteResult(unknownObservation(binding), binding).includes('synthetic-private'), false);
});

test('default observation is incomplete and unknown throughout with no invented binding', () => {
  for (const context of [binding, null]) {
    const value = unknownObservation(context);
    assert.equal(validatePrerequisiteResult(value, context), value);
    assert.equal(value.observation, 'incomplete');
    for (const field of ['cgroupV2', 'cgroupType', 'mountMode', 'events', 'killAvailability']) {
      assert.equal(value[field], 'unknown');
    }
    assert.deepEqual(Object.values(value.accessHints), ['unknown', 'unknown', 'unknown']);
  }
  assert.equal(unknownObservation().checkoutSha, null);
});

test('closed schema rejects unknown fields, enums, accessors and claims of ownership', () => {
  const value = mappedResult();
  assert.equal(validatePrerequisiteResult(value, binding), value);
  for (const patch of [
    { path: '/synthetic/private' }, { pid: 123 }, { uid: 123 }, { error: 'synthetic-private' },
    { schemaVersion: 2 }, { evidence: 'supported' }, { ownershipProof: 'supported' },
    { systemd: 'available' }, { cgroupV2: 'supported' }, { cgroupType: 'futureType' },
    { mountMode: 'readable' }, { events: 'populated' }, { killAvailability: 'supported' },
    { accessHints: { ...value.accessHints, root: 'allowed' } },
    { accessHints: { ...value.accessHints, createChild: true } }, { toJSON: () => ({ private: true }) },
  ]) assert.throws(() => serializePrerequisiteResult({ ...value, ...patch }, binding), PrerequisiteFailure);
  const accessor = { ...value };
  Object.defineProperty(accessor, 'events', { enumerable: true, get() { throw new Error('must not run'); } });
  assert.throws(() => serializePrerequisiteResult(accessor, binding), PrerequisiteFailure);
  assert.throws(() => validatePrerequisiteResult({ ...value, [Symbol('hidden')]: 'private' }, binding));
});

test('evidence must match consumer, checkout, run and attempt exactly', () => {
  for (const patch of [
    { consumer: 'web-chromium' }, { checkoutSha: 'b'.repeat(40) }, { runId: '124' },
    { runAttempt: '2' }, { runId: 123 }, { checkoutSha: null },
  ]) assert.throws(() => validatePrerequisiteResult({ ...mappedResult(), ...patch }, binding));
  assert.throws(() => validatePrerequisiteResult(mappedResult(), null));
  assert.throws(() => validatePrerequisiteResult(unknownObservation(), {}));
});

test('unknown or contradictory observations cannot be relabeled as complete', () => {
  assert.throws(() => validatePrerequisiteResult({ ...unknownObservation(binding), observation: 'complete' }, binding));
  assert.throws(() => validatePrerequisiteResult({ ...mappedResult(), observation: 'incomplete' }, binding));
  assert.throws(() => validatePrerequisiteResult({ ...mappedResult(), mountMode: 'ro' }, binding));
  assert.throws(() => validatePrerequisiteResult({ ...mappedResult(), killAvailability: 'absent' }, binding));
  const absent = { ...unknownObservation(binding), observation: 'complete', reason: 'v2Absent', cgroupV2: 'absent' };
  assert.equal(validatePrerequisiteResult(absent, binding), absent);
});

test('result is one bounded JSON line even at maximum evidence ID lengths', () => {
  const context = { ...binding, runId: '9'.repeat(32), runAttempt: '9'.repeat(32) };
  const value = { ...mappedResult(), ...context };
  const line = serializePrerequisiteResult(value, context);
  assert.equal(line.split('\n').length, 2);
  assert.ok(Buffer.byteLength(line) <= maximumResultBytes);
  assert.deepEqual(JSON.parse(line), value);
});

test('maps only the own unified membership with an aligned mount root', () => {
  assert.deepEqual(resolveOwnCgroup('0::/job\n', mount), {
    cgroupV2: 'mapped', target: '/synthetic/cgroup/job', mountMode: 'rw',
  });
  assert.equal(resolveOwnCgroup('0::/parent/job\n', mount.replace(' / /', ' /parent /')).target, '/synthetic/cgroup/job');
  assert.equal(resolveOwnCgroup('0::/\n', mount).target, '/synthetic/cgroup');
  assert.equal(resolveOwnCgroup('1:cpu:/legacy\n0::/job\n', mount).target, '/synthetic/cgroup/job');
});

test('mountinfo escapes are decoded once while proc cgroup paths remain literal', () => {
  const escaped = '10 1 0:20 /parent\\040name /synthetic/cgroup\\040space\\134011 rw shared:2 - cgroup2 cgroup rw\n';
  assert.equal(resolveOwnCgroup('0::/parent name/job\n', escaped).target, '/synthetic/cgroup space\\011/job');
  assert.equal(resolveOwnCgroup('0::/tab\tname/job\n', mount.replace(' / /', ' /tab\\011name /')).target, '/synthetic/cgroup/job');
  assert.throws(() => resolveOwnCgroup('0::/job\n', mount.replace('/synthetic/cgroup', '/synthetic/line\\012break')));
  assert.throws(() => resolveOwnCgroup('0::/job\n', mount.replace('/synthetic/cgroup', '/synthetic/bad\\999')));
});

test('namespace offsets, traversal, duplicate views and obscuring mounts are unknown', () => {
  const other = '11 1 0:21 / /other rw - cgroup2 cgroup rw\n';
  const over = point => `11 1 0:21 / ${point} rw - tmpfs tmpfs rw\n`;
  for (const [group, mounts] of [
    ['0::/job\n', mount.replace(' / /', ' /different /')],
    ['0::/parentish/job\n', mount.replace(' / /', ' /parent /')],
    ['0::/../host\n', mount], ['0::/a/./b\n', mount], ['0::/a//b\n', mount],
    ['0::/a (deleted)\n', mount], ['0::/a\n0::/b\n', mount],
    ['0::/job\n', mount + other], ['0::/job\n', mount + mount],
    ['0::/job\n', mount + over('/synthetic/cgroup/job')],
    ['0::/job\n', mount + over('/synthetic/cgroup/job/cgroup.events')],
    ['0::/job\n', mount + over('/synthetic')],
  ]) assert.throws(() => resolveOwnCgroup(group, mounts), error => error.reason === 'ambiguousMapping');
  const parent = '1 1 0:1 / / rw - ext4 synthetic rw\n';
  assert.equal(resolveOwnCgroup('0::/job\n', parent + mount).target, '/synthetic/cgroup/job');
});

test('read-only per-mount or superblock mode is preserved, ambiguous modes rejected', () => {
  assert.equal(resolveOwnCgroup('0::/job\n', mount.replace('rw,nosuid', 'ro,nosuid')).mountMode, 'ro');
  assert.equal(resolveOwnCgroup('0::/job\n', mount.replace('cgroup rw', 'cgroup ro')).mountMode, 'ro');
  for (const mode of ['rw,ro', 'nosuid', 'rw,rw']) {
    assert.throws(() => resolveOwnCgroup('0::/job\n', mount.replace('rw,nosuid', mode)));
  }
});

test('valid v1-only absence is negative evidence; missing or inconsistent views are not', () => {
  const legacyMount = mount.replace('cgroup2', 'cgroup');
  assert.deepEqual(resolveOwnCgroup('1:cpu:/job\n', legacyMount), { cgroupV2: 'absent' });
  for (const [group, mounts] of [
    ['', mount], ['0::/job\n', ''], ['1:cpu:/job\n', mount],
    ['0::/job\n', legacyMount], ['not proc data\n', mount],
    ['0:cpu:/job\n', mount], ['0::/job\n', 'not mount data'],
  ]) assert.throws(() => resolveOwnCgroup(group, mounts), PrerequisiteFailure);
});

test('bounded parsers reject saturated input and multibyte oversize without raw errors', () => {
  for (const value of ['x'.repeat(maximumReadBytes), '\u00e4'.repeat(maximumReadBytes / 2)]) {
    assert.throws(() => resolveOwnCgroup(value, mount), error =>
      error.reason === 'readLimitExceeded' && !error.message.includes(value.slice(0, 20)));
  }
  assert.throws(() => resolveOwnCgroup('0::/synthetic-private\0\n', mount), error =>
    error.reason === 'invalidProcData' && !error.message.includes('synthetic-private'));
});

test('cgroup types and events are closed projections, never ownership proof', () => {
  for (const [input, expected] of [
    ['domain', 'domain'], ['threaded', 'threaded'],
    ['domain threaded', 'domainThreaded'], ['domain invalid', 'domainInvalid'],
  ]) assert.equal(parseCgroupType(`${input}\n`), expected);
  assert.equal(parseCgroupEvents('populated 0\nfrozen 0\n'), 'observed');
  assert.equal(parseCgroupEvents('populated 1\n'), 'observed');
  for (const value of ['future', '', 'domain\nthreaded\n']) assert.throws(() => parseCgroupType(value));
  for (const value of ['', 'populated 2\n', 'frozen 0\n', 'populated 0\npopulated 1\n', 'populated 1\nprivate 7\n']) {
    assert.throws(() => parseCgroupEvents(value));
  }
});
