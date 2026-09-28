import assert from 'node:assert/strict';

export const experimentCases = Object.freeze([
  'nodeStop', 'nodeRootFirst', 'nodeRootFailure', 'electronNormal', 'electronLaunchFailure',
]);
export const maximumEvidenceBytes = 64 * 1024;

export function validateTerminal(value, scenario, nonce) {
  assert.deepEqual(Object.keys(value).sort(), [
    'schemaVersion', 'nonce', 'scenario', 'reason', 'cleanup', 'processTreeAbsent',
    'creationCompleted', 'rootExitObserved', 'descendantsAfterRoot', 'childExitCode',
  ].sort());
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.nonce, nonce);
  assert.equal(value.scenario, scenario);
  assert.equal(value.creationCompleted, true);
  assert.equal(value.processTreeAbsent, true);
  assert.equal(value.cleanup, 'processTreeAbsent');
  for (const field of ['rootExitObserved', 'descendantsAfterRoot']) assert.equal(typeof value[field], 'boolean');
  assert.ok(['naturalExit', 'stopRequested'].includes(value.reason));
  if (scenario === 'nodeStop') {
    assert.equal(value.reason, 'stopRequested');
    assert.equal(value.childExitCode, 1);
  } else {
    assert.equal(value.rootExitObserved, true);
    assert.equal(value.childExitCode, scenario === 'nodeRootFailure' ? 23 : 0);
    if (scenario !== 'electronNormal') assert.equal(value.descendantsAfterRoot, true);
    assert.equal(value.reason, scenario === 'electronNormal' ? 'naturalExit' : 'stopRequested');
  }
  return value;
}

export function experimentEnvironment(source, { root, scenario, node, electron, e2ePackage, profile }) {
  const result = {};
  for (const key of ['SystemRoot', 'WINDIR', 'ComSpec', 'SystemDrive', 'TEMP', 'TMP']) {
    const found = Object.keys(source).find(name => name.toLowerCase() === key.toLowerCase());
    if (found && source[found]) result[key] = source[found];
  }
  return {
    ...result,
    APPDATA: profile, LOCALAPPDATA: profile, USERPROFILE: profile,
    EKY_E2E: '1', EKY_T3A_ROOT: root, EKY_T3A_CASE: scenario,
    EKY_T3A_NODE: node, EKY_T3A_ELECTRON: electron,
    EKY_T3A_E2E_PACKAGE: e2ePackage, EKY_T3A_MARKER: 'synthetic-marker',
    DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1',
  };
}
