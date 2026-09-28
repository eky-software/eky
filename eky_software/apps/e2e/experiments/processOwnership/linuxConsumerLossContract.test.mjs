import assert from 'node:assert/strict';
import test from 'node:test';
import { linuxConsumerLossCases, ownerLossExit, consumerLossCase, validateConsumerLossArm,
  observeConsumerLossExit } from './linuxConsumerLossContract.mjs';
import { captureRunningUnit, managedUnitName, managedUnitProperties,
  verifyWaitingWrapperExit } from './managedNamespaceUnitContract.mjs';

const generation = 'a'.repeat(32);
const running = Object.freeze({
  Id: managedUnitName(generation), InvocationID: 'b'.repeat(32), LoadState: 'loaded', Transient: 'yes',
  ActiveState: 'active', SubState: 'running', Result: 'success', MainPID: '123', ControlPID: '0',
  ControlGroup: `/system.slice/${managedUnitName(generation)}`, ExecMainCode: '0', ExecMainStatus: '0',
  ExecMainStartTimestampMonotonic: '1000000', ExecMainExitTimestampMonotonic: '0', ...managedUnitProperties,
});
const receipt = captureRunningUnit(running, generation);
const terminal = Object.freeze({ ...running, ActiveState: 'failed', SubState: 'failed', Result: 'exit-code',
  MainPID: '0', ControlPID: '0', ExecMainCode: '1', ExecMainStatus: String(ownerLossExit),
  ExecMainExitTimestampMonotonic: '2000000' });
const arm = Object.freeze({ caseId: 'backend-owner', profile: 'backend', generation, cause: 'owner' });

test('seven consumer cases remain fixed with backend-only or real web service sets', () => {
  assert.deepEqual(linuxConsumerLossCases.map(value => value.id), [
    'backend-owner', 'backend-control', 'vite-owner', 'vite-control',
    'chromium-owner', 'chromium-control', 'caller',
  ]);
  assert.ok(Object.isFrozen(linuxConsumerLossCases));
  for (const value of linuxConsumerLossCases) {
    assert.equal(consumerLossCase(value.id), value);
    assert.ok(Object.isFrozen(value) && Object.isFrozen(value.profiles));
    assert.deepEqual(value.profiles, value.profile === 'backend' ? ['backend'] : ['chromium', 'backend', 'vite']);
  }
  for (const invalid of [undefined, null, '', 'retry', {}, 'backend-owner\n']) {
    assert.throws(() => consumerLossCase(invalid), /LOSS_UNVERIFIED/u);
  }
});

test('each armed cause binds the exact case, target and service generation', () => {
  for (const selected of linuxConsumerLossCases) {
    const profiles = selected.profile === null ? selected.profiles : [selected.profile];
    for (const profile of profiles) {
      const value = { caseId: selected.id, profile, generation, cause: selected.cause };
      assert.equal(validateConsumerLossArm(value, selected.id, profile, generation), value);
      assert.equal(observeConsumerLossExit({ ...terminal,
        ExecMainStatus: selected.cause === 'owner' ? String(ownerLossExit) : '42' }, receipt, value).waitingWrapper,
      'armedFailureExit');
    }
  }
});

test('missing, foreign, extra or accessor-bearing armed records cannot grant proof', () => {
  for (const invalid of [null, undefined, {}, { ...arm, generation: 'c'.repeat(32) },
    { ...arm, cause: 'control' }, { ...arm, profile: 'vite' }, { ...arm, caseId: 'caller' },
    { ...arm, extra: true }, Object.defineProperty({ ...arm }, 'cause', {
      enumerable: true, get() { throw new Error('getter must not run'); },
    })]) {
    assert.throws(() => validateConsumerLossArm(invalid, 'backend-owner', 'backend', generation),
      /LOSS_UNVERIFIED/u);
  }
});

test('active and deactivating are pending, never a terminal cleanup receipt', () => {
  assert.deepEqual(observeConsumerLossExit(running, receipt, arm), { waitingWrapper: 'pending' });
  assert.deepEqual(observeConsumerLossExit({ ...running, ActiveState: 'deactivating' }, receipt, arm),
    { waitingWrapper: 'pending' });
  assert.throws(() => observeConsumerLossExit({ ...running, MainPID: '0' }, receipt, arm));
});

test('fault acceptance does not alter normal exit-41 verification', () => {
  assert.deepEqual(observeConsumerLossExit(terminal, receipt, arm),
    { generation, waitingWrapper: 'armedFailureExit' });
  assert.throws(() => verifyWaitingWrapperExit(terminal, receipt));
  const normal = { ...terminal, ExecMainStatus: '41' };
  assert.deepEqual(verifyWaitingWrapperExit(normal, receipt), { generation, waitingWrapper: 'normalExit' });
  assert.throws(() => observeConsumerLossExit(normal, receipt, arm));
});

test('an armed owner read failure or deadline exit 42 cannot impersonate deliberate owner exit', () => {
  assert.throws(() => observeConsumerLossExit({ ...terminal, ExecMainStatus: '42' }, receipt, arm));
  for (const value of [
    { ...arm, caseId: 'backend-control', cause: 'control' },
    { ...arm, caseId: 'caller', cause: 'caller' },
  ]) {
    assert.throws(() => observeConsumerLossExit(terminal, receipt, value));
    assert.equal(observeConsumerLossExit({ ...terminal, ExecMainStatus: '42' }, receipt, value).waitingWrapper,
      'armedFailureExit');
  }
});

for (const [name, replacement] of Object.entries({
  InvocationID: 'c'.repeat(32), ExecMainStartTimestampMonotonic: '1000001',
  Id: managedUnitName('c'.repeat(32)), LoadState: 'not-found', Transient: 'no',
  ActiveState: 'inactive', SubState: 'dead', Result: 'signal', MainPID: '123', ControlPID: '321',
  ExecMainCode: '2', ExecMainStatus: '0', ExecMainExitTimestampMonotonic: '999999',
  KillMode: 'process', ExitType: 'cgroup', Restart: 'always', NoNewPrivileges: 'no',
})) {
  test(`armed exit rejects changed ${name}`, () => {
    assert.throws(() => observeConsumerLossExit({ ...terminal, [name]: replacement }, receipt, arm));
  });
}

test('missing, zero, oversized or malformed terminal timestamps fail closed', () => {
  for (const value of ['0', '', '1\n', '-1', '2.0', '18446744073709551616']) {
    assert.throws(() => observeConsumerLossExit({ ...terminal, ExecMainExitTimestampMonotonic: value }, receipt, arm));
  }
  assert.throws(() => observeConsumerLossExit({ ...terminal, unexpected: 'private' }, receipt, arm));
  assert.throws(() => observeConsumerLossExit(terminal, { ...receipt, extra: true }, arm));
});
