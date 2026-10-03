import assert from 'node:assert/strict';
import test from 'node:test';
import { exerciseMsiFileVersionPolicy, msiPolicyErrorCode, validateMsiPolicyResult, verifyMsiPolicyUiLog } from './msiFileVersionPolicyLifecycle.mjs';

function runtime(failure, cleanupFailure) {
  const calls = [];
  let absenceCalls = 0;
  const visit = (name) => {
    calls.push(name);
    if (name === failure || name === cleanupFailure) throw new Error('private path and secret');
  };
  return {
    calls,
    verifyAbsent: async () => visit(++absenceCalls === 1 ? 'preflight' : 'absence'),
    install: async role => visit(role + 'Install'),
    verifySource: async () => visit('sourceVerification'),
    verifyPolicy: async () => visit('policyVerification'),
    removeIfOwned: async role => visit(role + 'Removal'),
  };
}

for (const variant of ['uiDefault', 'uiOverride']) {
  test(`MSI policy ${variant} requires actual comparison and both cleanup postconditions`, async () => {
    const fixture = runtime();
    const result = await exerciseMsiFileVersionPolicy(variant, fixture);
    assert.equal(result.status, 'completed');
    assert.equal(result.sourceVerified, true);
    assert.equal(result.policyVerified, true);
    assert.equal(result.cleanupStatus, 'completed');
    assert.equal(validateMsiPolicyResult(variant, result), result);
    assert.deepEqual(fixture.calls, ['preflight', 'sourceInstall', 'sourceVerification', 'targetInstall',
      'policyVerification', 'targetRemoval', 'sourceRemoval', 'absence']);
  });
}

for (const phase of ['preflight', 'sourceInstall', 'sourceVerification', 'targetInstall', 'policyVerification']) {
  test(`MSI policy preserves ${phase} failure separately from cleanup`, async () => {
    const fixture = runtime(phase, 'targetRemoval');
    const result = await exerciseMsiFileVersionPolicy('uiDefault', fixture);
    assert.equal(result.status, 'failed');
    assert.equal(result.phase, phase);
    assert.equal(result.errorCode, phase + 'Failed');
    assert.equal(result.causeCode, 'unknown');
    assert.equal(validateMsiPolicyResult('uiDefault', result), result);
    assert.equal(JSON.stringify(result).includes('private'), false);
    if (phase === 'preflight') assert.deepEqual(fixture.calls, ['preflight']);
    else {
      assert.deepEqual(fixture.calls.slice(-3), ['targetRemoval', 'sourceRemoval', 'absence']);
      assert.equal(result.cleanupStatus, 'failed');
      assert.equal(result.cleanupErrorCode, 'productRemovalFailed');
    }
  });
}

test('MSI policy cleanup failure cannot turn a verified policy into success', async () => {
  const result = await exerciseMsiFileVersionPolicy('uiDefault', runtime(null, 'absence'));
  assert.equal(result.policyVerified, true);
  assert.equal(result.errorCode, null);
  assert.equal(result.status, 'failed');
  assert.equal(result.cleanupErrorCode, 'absenceVerificationFailed');
  assert.equal(validateMsiPolicyResult('uiDefault', result), result);
});

test('MSI policy preserves a known original cause independently from a cleanup cause', async () => {
  const fixture = runtime();
  fixture.verifySource = async () => { throw new Error('msiPolicyInstalledFileMismatch'); };
  fixture.removeIfOwned = async () => { throw new Error('productCommandFailed'); };
  const result = await exerciseMsiFileVersionPolicy('uiDefault', fixture);
  assert.equal(result.errorCode, 'sourceVerificationFailed');
  assert.equal(result.causeCode, 'msiPolicyInstalledFileMismatch');
  assert.equal(result.cleanupCauseCode, 'productCommandFailed');
  assert.equal(validateMsiPolicyResult('uiDefault', result), result);
  fixture.verifySource = async () => { throw new Error('installerStateInspectionFailed'); };
  fixture.removeIfOwned = fixture.verifySource;
  const inspectionFailure = await exerciseMsiFileVersionPolicy('uiDefault', fixture);
  assert.equal(inspectionFailure.causeCode, 'installerStateInspectionFailed');
  assert.equal(inspectionFailure.cleanupCauseCode, 'installerStateInspectionFailed');
  for (const error of [null, new Error('private secret'), { message: 'msiPolicyInstalledFileMismatch extra' }]) {
    assert.equal(msiPolicyErrorCode(error), 'unknown');
  }
});

test('MSI policy result rejects forged completion, unknown detail fields and unsafe causes', async () => {
  const valid = await exerciseMsiFileVersionPolicy('uiDefault', runtime());
  for (const change of [{ raw: 'private' }, { variant: 'uiOverride' }, { sourceVerified: false },
    { policyVerified: false }, { cleanupStatus: 'notAttempted' }, { causeCode: 'private' },
    { errorCode: 'targetInstallFailed', causeCode: 'unknown' }, { status: 'failed' }, { phase: 'preflight' }]) {
    assert.throws(() => validateMsiPolicyResult('uiDefault', { ...valid, ...change }), /msiPolicyResultInvalid/);
  }
  const prepared = { ...valid, variant: 'prepare', phase: 'preparation', sourceVerified: false,
    policyVerified: false, cleanupStatus: 'notAttempted' };
  assert.equal(validateMsiPolicyResult('prepare', prepared), prepared);
  const failure = { ...prepared, status: 'failed', phase: 'metadata', errorCode: 'metadataFailed',
    causeCode: 'INSTALLER_CUSTOM_ACTION_FORBIDDEN' };
  assert.equal(validateMsiPolicyResult('prepare', failure), failure);
});

const line = value => `MSI (c) (00:00) [00:00:00:000]: ${value}`;
const productCode = '{00000000-0000-4000-8000-000000000001}';
const uiLog = mode => [
  ...(mode === 'emus' ? [line('Doing action: EkySetReinstallMode')] : []),
  line(`PROPERTY CHANGE: Adding REINSTALLMODE property. Its value is '${mode}'.`),
  line('Doing action: CostInitialize'),
  `Property(S): ProductCode = ${productCode}`,
  `Property(S): REINSTALLMODE = ${mode}`,
  `Property(C): ProductCode = ${productCode}`,
  `Property(C): REINSTALLMODE = ${mode}`,
].join('\r\n');

test('UI proof requires client action before costing and both final properties', () => {
  assert.equal(verifyMsiPolicyUiLog(uiLog('emus'), 'uiDefault', productCode), true);
  assert.equal(verifyMsiPolicyUiLog(uiLog('omus'), 'uiOverride', productCode), true);
});

test('UI proof rejects silence, duplicates, wrong ordering and altered caller choice', () => {
  for (const text of ['', uiLog('emus').replaceAll('(c)', '(s)'),
    uiLog('emus').replace('Property(C)', 'Property(X)'),
    uiLog('emus') + '\nProperty(C): REINSTALLMODE = emus',
    line('Doing action: CostInitialize') + '\n' + uiLog('emus')]) {
    assert.throws(() => verifyMsiPolicyUiLog(text, 'uiDefault', productCode), /msiPolicyLogInvalid/);
  }
  assert.throws(() => verifyMsiPolicyUiLog(uiLog('emus'), 'uiOverride', productCode), /msiPolicyLogInvalid/);
  assert.throws(() => verifyMsiPolicyUiLog(uiLog('omus') + '\n' +
    line("PROPERTY CHANGE: Modifying REINSTALLMODE property. Its current value is 'omus'. Its new value: 'emus'."),
  'uiOverride', productCode), /msiPolicyLogInvalid/);
});

test('UI policy proof binds property dumps to the target, not nested source removal', () => {
  const other = productCode.replace(/1\}$/, '2}');
  const nested = `Property(S): ProductCode = ${other}\nProperty(S): REINSTALLMODE = omus\nEnd nested uninstall\n`;
  assert.equal(verifyMsiPolicyUiLog(nested + uiLog('emus'), 'uiDefault', productCode), true);
  assert.throws(() => verifyMsiPolicyUiLog(uiLog('emus').replaceAll(productCode, other), 'uiDefault', productCode), /msiPolicyLogInvalid/);
});

test('UI proof rejects missing or truncated client records even with correct final properties', () => {
  const valid = uiLog('emus');
  for (const record of valid.split('\r\n').filter(value => value.startsWith('MSI (c)'))) {
    for (const replacement of ['', record.slice(1), record.slice(0, -1)]) {
      assert.throws(() => verifyMsiPolicyUiLog(valid.replace(record, replacement),
        'uiDefault', productCode), /msiPolicyLogInvalid/);
    }
  }
});
