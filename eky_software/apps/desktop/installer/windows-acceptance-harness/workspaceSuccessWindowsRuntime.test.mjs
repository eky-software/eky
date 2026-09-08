import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { access, link, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { WORKSPACE_SUCCESS_PROFILE_ERRORS, WORKSPACE_SUCCESS_PROOF_ERRORS, workspaceSuccessErrorCode } from './workspaceSuccessContracts.mjs';
import { WORKSPACE_SUCCESS_RUN_ROOT_PREFIX, workspaceSuccessRunContext } from './workspaceSuccessRunFixture.mjs';
import { WORKSPACE_FAULT_SCENARIO, workspaceFaultErrorCode } from './workspaceFaultContracts.mjs';
import { writeW6b2PackagedSuccessPhase } from '../scripts/w6b2PackagedSuccessRunFixture.mjs';

const profileProtocol = await import(new URL('../../e2e-dist/e2e/w6b2PackagedWorkspaceProfileCommand.js', import.meta.url));
const proofProtocol = await import(new URL('../../e2e-dist/src/main/w6b2PackagedProof.js', import.meta.url));
const { createDesktopProfilePaths } = await import(new URL('../../e2e-dist/src/runtime/desktopProfilePaths.js', import.meta.url));
const { deriveWorkspaceRoot } = await import(new URL('../../e2e-dist/src/workspaces/registry/deriveWorkspaceRoot.js', import.meta.url));
const { createProfileSnapshotRuntimePaths } = await import(new URL('../../e2e-dist/src/profileBackup/profileSnapshotRuntimePaths.js', import.meta.url));

function workspaceSnapshotFixturePaths(root) {
  const artifact = { source: { manifest: { packageFilename: 'source.msi' } },
    target: { manifest: { packageFilename: 'target.msi' } } };
  const context = workspaceSuccessRunContext(resolve(root, 'scenario/worker-request.json'), {
    fixtureRoot: resolve(root, 'fixture'), runNonce: 'a'.repeat(64),
  }, artifact);
  const id = '11111111-1111-4111-8111-111111111111';
  const workspace = deriveWorkspaceRoot(resolve(context.proofRoot, 'user-data'), id, 1);
  const profile = createDesktopProfilePaths(workspace.workspaceRoot);
  const snapshot = resolve(createProfileSnapshotRuntimePaths(profile.runtimeRoot).stagingRoot, id, 'profile.sqlite');
  return { context, snapshot };
}

test('consumer layout leaves room for workspace snapshots and their SQLite journal in a user-scoped Windows temp root', {
  skip: process.platform !== 'win32',
}, () => {
  const root = resolve('C:/Users/synthetic-user/AppData/Local/Temp', `${WORKSPACE_SUCCESS_RUN_ROOT_PREFIX}ABCDEF`);
  const { context, snapshot } = workspaceSnapshotFixturePaths(root);
  assert.ok(Buffer.byteLength(`${snapshot}-journal`) < 260,
    'consumer layout exceeds the SQLite snapshot and journal budget');
  assert.equal(context.proofRoot.startsWith(`${root}\\`), true);
  assert.equal(context.temporaryRoot.startsWith(`${root}\\`), true);
});

test('the consumer snapshot path supports a real SQLite backup and integrity check', {
  skip: process.platform !== 'win32',
}, async (context) => {
  const root = await mkdtemp(resolve(await realpath(tmpdir()), WORKSPACE_SUCCESS_RUN_ROOT_PREFIX));
  context.after(() => rm(root, { recursive: true, force: true }));
  const { snapshot } = workspaceSnapshotFixturePaths(root);
  const Database = createRequire(new URL('../../../backend/package.json', import.meta.url))('better-sqlite3');
  const source = new Database(':memory:');
  try {
    source.pragma('user_version = 1');
    await mkdir(dirname(snapshot), { recursive: true });
    await source.backup(snapshot);
    const copied = new Database(snapshot, { readonly: true, fileMustExist: true });
    try {
      assert.equal(copied.pragma('integrity_check', { simple: true }), 'ok');
      assert.equal(copied.pragma('user_version', { simple: true }), 1);
    } finally { copied.close(); }

    // A database filename alone may fit while SQLite cannot open its journal.
    const oldSuffix = '/profile.sqlite';
    const oldSnapshot = resolve(root, 'x'.repeat(255 - Buffer.byteLength(root) - oldSuffix.length - 1), 'profile.sqlite');
    assert.equal(Buffer.byteLength(oldSnapshot), 255);
    await mkdir(dirname(oldSnapshot), { recursive: true });
    await assert.rejects(() => source.backup(oldSnapshot), { code: 'SQLITE_CANTOPEN' });
  } finally { source.close(); }
});

import {
  createWorkspaceSuccessWindowsRuntime, runWorkspaceSuccessOwnedCommand,
  createWorkspaceFaultWindowsRuntime,
  workspaceSuccessApplicationEnvironment, removeWorkspaceSuccessPreviousResult,
} from './workspaceSuccessWindowsRuntime.mjs';

async function fixture(context, changes = {}) {
  const root = await mkdtemp(resolve(await realpath(tmpdir()), 'eky-v26-runtime-contract-'));
  await mkdir(resolve(root, 'control'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const calls = [];
  let phase = 'sourceHandoff';
  let operation = 'prepare';
  const token = 'a'.repeat(64);
  const revision = 'b'.repeat(40);
  const environment = { APPDATA: resolve(root, 'roaming'), LOCALAPPDATA: resolve(root, 'local'),
    SystemRoot: resolve(root, 'system'), TEMP: root, EKY_PRIVATE: 'not forwarded' };
  const artifact = { source: { productCode: 'SOURCE', installerPath: resolve(root, 'source.msi'),
    msiProductVersion: '0.2.7', payloadInventory: { identity: 'source' } },
    target: { productCode: 'TARGET', msiProductVersion: '0.2.8', payloadInventory: { identity: 'target' } } };
  const inputs = { request: { runNonce: token, buildRevision: revision,
    ...(changes.faultScenario ? { scenario: WORKSPACE_FAULT_SCENARIO, faultScenario: changes.faultScenario } : {}),
    artifactDescriptorSha256: 'c'.repeat(64), fixtureRoot: resolve(root, 'artifact') },
  artifact, temporaryRoot: root, scenarioRoot: root, runFixture: { proofRoot: root, token },
  profileRuntime: { executablePath: resolve(root, 'electron.exe'), applicationPath: resolve(root, 'profile') },
  sessionProof: { async start(value) { calls.push({ sessionStarted: value }); return { nonce: 'd'.repeat(64), async finish(value) {
    calls.push({ sessionFinished: value });
    if (changes.sessionFailure) throw new Error('sessionProofInvalid');
  } }; } },
  proofProtocol: {
    W6B2_PACKAGED_PROOF_SWITCH: 'w6b2-packaged-proof',
    createW6b2PackagedProofBootstrapConfiguration: () => ({ root, userDataPath: resolve(root, 'user-data') }),
    parseW6b2PackagedProofResult: proofProtocol.parseW6b2PackagedProofResult,
    getW6b2PackagedFaultSessionPhases: proofProtocol.getW6b2PackagedFaultSessionPhases,
  },
  profileProtocol,
  captureCheckpoint: async (checkpoint) => { calls.push({ checkpoint }); } };
  let inspectionRole = 'source';
  let activityQuery = false;
  const dependencies = {
    environment,
    async runCommand(command, args, options) {
      calls.push({ command, args, options });
      if (basename(command) === 'powershell.exe') {
        activityQuery = args.some((arg) => arg.endsWith('inspectWorkspaceSuccessMsiActivity.ps1'));
        inspectionRole = args.includes('{SOURCE}') ? 'source' : 'target';
      }
      if (options.env.EKY_W6B2_PROFILE_OPERATION) operation = options.env.EKY_W6B2_PROFILE_OPERATION;
      if (changes.faultScenario && basename(command) === 'Eky.exe') {
        const control = JSON.parse(await readFile(resolve(root, 'control/phase.json'), 'utf8'));
        phase = control.phase;
        calls.push({ control });
      }
      return changes.exitCode ?? 0;
    },
    async readObject(path, errorCode) {
      if (path.endsWith('w6b2-proof-result.json')) {
        if (changes.proofUnreadable) throw new Error(errorCode);
        return changes.proofResult ?? { ...(changes.faultScenario
          ? { formatVersion: 2, faultScenario: changes.faultScenario } : { formatVersion: 1 }),
          phase, status: changes.proofStatus?.(phase) ?? 'completed' };
      }
      if (path.endsWith(profileProtocol.W6B2_PACKAGED_PROFILE_RESULT_FILE)) {
        if (changes.profileUnreadable) throw new Error(errorCode);
        return changes.profileResult ?? { formatVersion: 1, operation, status: 'completed' };
      }
      if (activityQuery) return changes.activity?.shift() ?? { schemaVersion: 1, msiClientCount: 0 };
      const installedRole = changes.installedRole ?? 'target';
      const installed = changes.noTarget !== true && inspectionRole === installedRole;
      return { schemaVersion: 1, productState: installed ? 5 : -1,
        productName: installed ? 'Eky' : null, productVersion: installed ? artifact[installedRole].msiProductVersion : null,
        localPackagePresent: installed, ownedRegistryExists: true, ekyProcessCount: 0 };
    },
    async inspectPayload() { return changes.payload ?? { identity: 'target' }; },
    async inspectFootprint() { return { installRootExists: true, executableExists: true, shortcutExists: true }; },
    async verifyArtifact(value) { calls.push({ artifact: value }); },
    async verifyRunFixture(value) { calls.push({ fixture: value }); },
    async writePhase(root, value) {
      phase = value; calls.push({ phase });
      if (changes.faultScenario) await writeW6b2PackagedSuccessPhase(root, value);
    },
    async nextObservation() { calls.push({ observation: true }); },
  };
  return { root, calls, inputs, dependencies,
    runtime: await (changes.faultScenario ? createWorkspaceFaultWindowsRuntime : createWorkspaceSuccessWindowsRuntime)(inputs, dependencies) };
}

const faultProofPlans = {
  preUpdateRecoveryPointFailure: [['sourceHandoff', 'completed']],
  activeWorkspaceFirstStartFailure: [['sourceHandoff', 'completed'], ['targetFirstStartFailure', 'relaunching'],
    ['businessRollback', 'relaunching'], ['rollbackFirstStart', 'completed']],
  acceptanceInterruption: [['sourceHandoff', 'completed'], ['targetAcceptanceInterruption', 'interrupted'],
    ['targetAcceptanceRecovery', 'relaunching'], ['targetAcceptanceRestart', 'completed']],
  passiveWorkspaceMigrationFailure: [['sourceHandoff', 'completed'], ['targetFirstStart', 'completed'],
    ['switchToB', 'relaunching'], ['passiveWorkspaceMigrationFailure', 'relaunching'], ['passiveWorkspaceRecovery', 'completed']],
  binaryRollbackFailure: [['sourceHandoff', 'completed'], ['targetFirstStartFailure', 'relaunching'],
    ['binaryRollbackFailure', 'completed'], ['failedSafeVerification', 'completed']],
};

for (const [faultScenario, phases] of Object.entries(faultProofPlans)) {
  test(`fault adapter binds ${faultScenario} to existing application controls and only healthy session phases`, async (context) => {
    const value = await fixture(context, { faultScenario, proofStatus: (phase) => phases.find(([p]) => p === phase)[1] });
    await value.runtime.prepareProfile();
    assert.deepEqual(JSON.parse(await readFile(resolve(value.root, 'control/phase.json'), 'utf8')),
      { formatVersion: 1, phase: 'sourceHandoff' });
    const healthy = proofProtocol.getW6b2PackagedFaultSessionPhases(faultScenario);
    for (const [phase, status] of phases) {
      assert.deepEqual(await value.runtime.runProofPhase(phase), { formatVersion: 2, faultScenario, phase, status });
      assert.deepEqual(value.calls.findLast((call) => call.control).control, {
        formatVersion: 2, faultScenario, phase, ...(healthy.includes(phase) ? { sessionProbeNonce: 'd'.repeat(64) } : {}),
      });
    }
    assert.deepEqual(value.calls.filter((call) => call.sessionStarted).map((call) => call.sessionStarted), healthy);
    assert.deepEqual(value.calls.filter((call) => call.sessionFinished).map((call) => call.sessionFinished),
      healthy.map(() => ({ allowMissing: false })));
    const applications = value.calls.filter((call) => basename(call.command ?? '') === 'Eky.exe');
    assert.equal(applications.length, phases.length);
    for (const call of applications) {
      assert.deepEqual(call.args, ['--w6b2-packaged-proof', `--user-data-dir=${resolve(value.root, 'user-data')}`]);
      assert.equal(call.options.env.EKY_W6B2_PROOF_TOKEN, value.inputs.request.runNonce);
      assert.equal(call.options.env.EKY_PRIVATE, undefined);
    }
    assert.equal(value.calls.some((call) => basename(call.command ?? '') === 'msiexec.exe'), false);
  });
}

for (const role of ['source', 'target']) {
  test(`fault ${role} handoff observes the existing installation without reinstalling`, async (context) => {
    const value = await fixture(context, { faultScenario: 'activeWorkspaceFirstStartFailure', installedRole: role,
      activity: [{ schemaVersion: 1, msiClientCount: 1 }, { schemaVersion: 1, msiClientCount: 0 }] });
    await value.runtime.waitForInstallation(role);
    assert.equal(value.calls.filter((call) => call.observation).length, 1);
    assert.equal(value.calls.filter((call) => call.command).length, 6);
    assert.ok(value.calls.filter((call) => call.command).every((call) => basename(call.command) === 'powershell.exe'));
    await assert.rejects(() => value.runtime.waitForInstallation('foreign'), /requestInvalid/);
  });
}

test('an absent source after rollback is a terminal failure without a second installer or cleanup owner', async (context) => {
  const value = await fixture(context, { faultScenario: 'activeWorkspaceFirstStartFailure' });
  await assert.rejects(() => value.runtime.waitForInstallation('source'), /sourceRollbackInstallFailed/);
  assert.equal(value.calls.some((call) => call.observation || basename(call.command ?? '') === 'msiexec.exe'), false);
});

for (const change of [
  { proofResult: { formatVersion: 1, phase: 'sourceHandoff', status: 'completed' } },
  { proofResult: { formatVersion: 2, faultScenario: 'binaryRollbackFailure', phase: 'sourceHandoff', status: 'completed' } },
  { proofResult: { formatVersion: 2, faultScenario: 'acceptanceInterruption', phase: 'targetAcceptanceInterruption', status: 'completed', secret: 'private' } },
  { exitCode: 1 },
]) {
  test('fault exit and strict result must independently prove the requested interruption', async (context) => {
    const value = await fixture(context, { faultScenario: 'acceptanceInterruption',
      proofStatus: () => 'interrupted', ...change });
    await assert.rejects(() => value.runtime.runProofPhase('targetAcceptanceInterruption'), /proofResultInvalid/);
    assert.equal(value.calls.some((call) => call.sessionStarted || call.sessionFinished), false);
  });
}

test('fault session cleanup preserves the original safe application error', async (context) => {
  const errorCode = 'W6B2_FAULT_PROOF_HANDOFF_FAILED';
  const value = await fixture(context, { faultScenario: 'binaryRollbackFailure', sessionFailure: true,
    proofResult: { formatVersion: 2, faultScenario: 'binaryRollbackFailure', phase: 'sourceHandoff', status: 'failed', errorCode } });
  await assert.rejects(() => value.runtime.runProofPhase('sourceHandoff'), { message: errorCode });
  assert.deepEqual(value.calls.at(-1), { sessionFinished: { allowMissing: false } });
  assert.equal(workspaceFaultErrorCode(new Error('sessionProofInvalid')), 'sessionProofInvalid');
});

test('fault factory and phase selection reject foreign controls before launching an application', async (context) => {
  const value = await fixture(context, { faultScenario: 'preUpdateRecoveryPointFailure' });
  await assert.rejects(() => value.runtime.runProofPhase('failedSafeVerification'), /W6B2_FAULT_PHASE_INVALID/);
  assert.equal(value.calls.some((call) => call.command), false);
  assert.throws(() => createWorkspaceSuccessWindowsRuntime(value.inputs, value.dependencies), /requestInvalid/);
  assert.throws(() => createWorkspaceFaultWindowsRuntime({ ...value.inputs,
    request: { ...value.inputs.request, scenario: 'packagedWorkspaceSuccess' } }, value.dependencies), /requestInvalid/);
});

test('source install launches exactly the descriptor package with quiet logging', async (context) => {
  const value = await fixture(context);
  assert.equal(await value.runtime.installSource(), 0);
  const call = value.calls[0];
  assert.equal(basename(call.command), 'msiexec.exe');
  assert.deepEqual(call.args.slice(0, 5), ['/i', value.inputs.artifact.source.installerPath, '/qn', '/norestart', '/L*v']);
});

test('stale result is removed only after regular single-link JSON validation', async (context) => {
  const root = await mkdtemp(resolve(await realpath(tmpdir()), 'eky-v26-result-contract-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const path = resolve(root, 'result.json');
  await removeWorkspaceSuccessPreviousResult(path);
  await writeFile(path, '{"schemaVersion":1}');
  await link(path, resolve(root, 'alias.json'));
  await assert.rejects(() => removeWorkspaceSuccessPreviousResult(path), { message: 'proofResultInvalid' });
  assert.equal(await readFile(path, 'utf8'), '{"schemaVersion":1}');
  await rm(resolve(root, 'alias.json'));
  await removeWorkspaceSuccessPreviousResult(path);
  await assert.rejects(() => access(path), { code: 'ENOENT' });
});

test('handoff waits for observed MSI inactivity without starting or killing a process', async (context) => {
  const value = await fixture(context, { activity: [
    { schemaVersion: 1, msiClientCount: 1 }, { schemaVersion: 1, msiClientCount: 0 },
  ] });
  await value.runtime.waitForTargetInstallation();
  assert.equal(value.calls.filter((call) => call.observation).length, 1);
  assert.equal(value.calls.filter((call) => call.command).length, 6);
  assert.ok(value.calls.filter((call) => call.command).every((call) => basename(call.command) === 'powershell.exe'));
});

test('an exited installer with no target is a terminal failure, not another install attempt', async (context) => {
  const value = await fixture(context, { noTarget: true });
  await assert.rejects(value.runtime.waitForTargetInstallation, { message: 'targetInstallFailed' });
  assert.equal(value.calls.some((call) => call.observation || basename(call.command ?? '') === 'msiexec.exe'), false);
});

for (const activity of [
  { schemaVersion: 1, msiClientCount: -1 }, { schemaVersion: 1, msiClientCount: 0, pid: 123 },
  { schemaVersion: 1, msiClientCount: 0.5 }, { schemaVersion: 2, msiClientCount: 0 },
]) {
  test('unknown MSI activity cannot authorize the next startup', async (context) => {
    const value = await fixture(context, { activity: [activity] });
    await assert.rejects(value.runtime.waitForTargetInstallation, { message: 'productInspectionFailed' });
  });
}

test('private proof launches only the isolated profile and consumes the requested phase', async (context) => {
  const value = await fixture(context);
  assert.deepEqual(await value.runtime.runProofPhase('rejectC'), { formatVersion: 1, phase: 'rejectC', status: 'completed' });
  const call = value.calls.find((entry) => entry.command);
  assert.equal(basename(call.command), 'Eky.exe');
  assert.deepEqual(call.args, ['--w6b2-packaged-proof', `--user-data-dir=${resolve(value.root, 'user-data')}`]);
  assert.equal(call.options.env.TEMP, value.root);
  assert.equal(call.options.env.EKY_PRIVATE, undefined);
  assert.equal(call.options.env.EKY_W6B2_PROOF_TOKEN, value.inputs.request.runNonce);
});

for (const changes of [
  { exitCode: 1 }, { proofResult: { formatVersion: 1, phase: 'sourceHandoff', status: 'failed' } },
  { proofResult: { formatVersion: 1, phase: 'rejectC', status: 'completed' } },
]) {
  test('exit and result must both prove the requested application operation', async (context) => {
    const value = await fixture(context, changes);
    await assert.rejects(() => value.runtime.runProofPhase('sourceHandoff'), { message: 'proofResultInvalid' });
  });
}

for (const errorCode of WORKSPACE_SUCCESS_PROOF_ERRORS) {
  test(`proof failure retains the strict protocol code ${errorCode}`, async (context) => {
    const value = await fixture(context, { proofResult: {
      formatVersion: 1, phase: 'sourceHandoff', status: 'failed', errorCode,
    }, sessionFailure: true });
    await assert.rejects(() => value.runtime.runProofPhase('sourceHandoff'), (error) => {
      assert.equal(error.message, errorCode);
      assert.equal(workspaceSuccessErrorCode(error), errorCode);
      return true;
    });
    assert.equal(value.calls.filter((call) => call.command).length, 1);
    assert.deepEqual(value.calls.at(-1), { sessionFinished: { allowMissing: false } });
  });
}

for (const [name, change] of [
  ['unknown code', { errorCode: 'PRIVATE_PATH_OR_SECRET' }],
  ['unknown key', { session: 'PRIVATE_PATH_OR_SECRET' }],
  ['wrong phase', { phase: 'rejectC' }],
  ['wrong version', { formatVersion: 2 }],
  ['contradictory completed result', { status: 'completed' }],
]) {
  test(`proof reader rejects ${name} without exposing untrusted fields`, async (context) => {
    const value = await fixture(context, { proofResult: {
      formatVersion: 1, phase: 'sourceHandoff', status: 'failed',
      errorCode: 'W6B2_PROOF_UNEXPECTED', ...change,
    } });
    await assert.rejects(() => value.runtime.runProofPhase('sourceHandoff'), { message: 'proofResultInvalid' });
  });
}

test('a valid fault protocol result cannot be used for the success matrix', async (context) => {
  const value = await fixture(context, { proofResult: {
    formatVersion: 2, faultScenario: 'preUpdateRecoveryPointFailure',
    phase: 'sourceHandoff', status: 'completed',
  } });
  await assert.rejects(() => value.runtime.runProofPhase('sourceHandoff'), { message: 'proofResultInvalid' });
});

test('unreadable proof result remains distinct while the session channel closes', async (context) => {
  const value = await fixture(context, { proofUnreadable: true, sessionFailure: true });
  await assert.rejects(() => value.runtime.runProofPhase('sourceHandoff'), { message: 'proofResultUnreadable' });
  assert.deepEqual(value.calls.at(-1), { sessionFinished: { allowMissing: false } });
});

test('a failed application exit preserves its valid failed proof result', async (context) => {
  const value = await fixture(context, { exitCode: 1, proofResult: {
    formatVersion: 1, phase: 'sourceHandoff', status: 'failed', errorCode: 'W6B2_PROOF_UNEXPECTED',
  } });
  await assert.rejects(() => value.runtime.runProofPhase('sourceHandoff'), { message: 'W6B2_PROOF_UNEXPECTED' });
});

test('profile preparation uses the existing named profile entrypoint and environment', async (context) => {
  const value = await fixture(context);
  await value.runtime.prepareProfile();
  const call = value.calls[0];
  assert.equal(call.command, value.inputs.profileRuntime.executablePath);
  assert.deepEqual(call.args, [value.inputs.profileRuntime.applicationPath]);
  assert.equal(call.options.env.EKY_W6B2_PROFILE_OPERATION, 'prepare');
  assert.equal(call.options.env.TEMP, value.root);
});

test('profile failure mapping covers exactly the existing strict protocol stages', () => {
  assert.deepEqual(Object.keys(WORKSPACE_SUCCESS_PROFILE_ERRORS), [...profileProtocol.w6b2PackagedProfileFailureStages]);
});

for (const failureStage of profileProtocol.w6b2PackagedProfileFailureStages) {
  test(`profile preparation preserves the safe ${failureStage} failure`, async (context) => {
    const value = await fixture(context, { exitCode: 1, profileResult: {
      formatVersion: 1, operation: 'prepare', status: 'failed',
      errorCode: 'W6B2_PROFILE_PREPARATION_FAILED', failureStage,
    } });
    await assert.rejects(value.runtime.prepareProfile, (error) => {
      assert.equal(error.message, WORKSPACE_SUCCESS_PROFILE_ERRORS[failureStage]);
      assert.equal(workspaceSuccessErrorCode(error), error.message);
      return true;
    });
    assert.equal(value.calls.length, 1);
  });
}

test('missing or unreadable profile evidence remains a distinct safe failure', async (context) => {
  const value = await fixture(context, { exitCode: 1, profileUnreadable: true });
  await assert.rejects(value.runtime.prepareProfile, { message: 'profileResultUnreadable' });
});

for (const [name, change, exitCode] of [
  ['unknown stage', { failureStage: 'PRIVATE_PATH_OR_SECRET' }, 1],
  ['unknown key', { path: 'PRIVATE_PATH_OR_SECRET' }, 1],
  ['wrong operation', { operation: 'rejectC', errorCode: 'W6B2_PROFILE_VERIFICATION_FAILED' }, 1],
  ['wrong error code', { errorCode: 'PRIVATE_PATH_OR_SECRET' }, 1],
  ['wrong version', { formatVersion: 2 }, 1],
  ['contradictory successful exit', {}, 0],
  ['contradictory completed result', { status: 'completed' }, 1],
]) {
  test(`profile result rejects ${name} without leaking raw fields`, async (context) => {
    const value = await fixture(context, { exitCode, profileResult: {
      formatVersion: 1, operation: 'prepare', status: 'failed',
      errorCode: 'W6B2_PROFILE_PREPARATION_FAILED', failureStage: 'profileInput', ...change,
    } });
    await assert.rejects(value.runtime.prepareProfile, { message: 'profileResultInvalid' });
  });
}

test('nonzero exit cannot accept an otherwise valid completed profile result', async (context) => {
  const value = await fixture(context, { exitCode: 1 });
  await assert.rejects(value.runtime.prepareProfile, { message: 'profileResultInvalid' });
});

test('session proof failure rejects an otherwise completed application result', async (context) => {
  const value = await fixture(context, { sessionFailure: true });
  await assert.rejects(() => value.runtime.runProofPhase('sourceHandoff'), { message: 'sessionProofInvalid' });
  const control = JSON.parse(await readFile(resolve(value.root, 'control', 'phase.json'), 'utf8'));
  assert.deepEqual(control, { formatVersion: 1, phase: 'sourceHandoff', sessionProbeNonce: 'd'.repeat(64) });
  assert.deepEqual(value.calls.at(-1), { sessionFinished: { allowMissing: false } });
});

test('session channel cleanup does not erase the original application failure', async (context) => {
  const value = await fixture(context, { exitCode: 1, sessionFailure: true });
  await assert.rejects(() => value.runtime.runProofPhase('sourceHandoff'), { message: 'proofResultInvalid' });
  assert.deepEqual(value.calls.at(-1), { sessionFinished: { allowMissing: false } });
});

test('only the migration relaunch may exit before a backend session exists', async (context) => {
  const value = await fixture(context, { proofResult: { formatVersion: 1, phase: 'verifyBRestart', status: 'relaunching' } });
  await value.runtime.runProofPhase('verifyBRestart');
  assert.deepEqual(value.calls.at(-1), { sessionFinished: { allowMissing: true } });
});

test('profile result from a different operation cannot be reused', async (context) => {
  const value = await fixture(context, { profileResult: { formatVersion: 1, operation: 'rejectC', status: 'completed' } });
  await assert.rejects(() => value.runtime.prepareProfile(), { message: 'profileResultInvalid' });
});

test('payload comparison and byte verification keep both immutable bindings', async (context) => {
  const value = await fixture(context);
  await value.runtime.validatePayload('target');
  await assert.rejects(() => value.runtime.validatePayload('source'), { message: 'sourceStateInvalid' });
  await value.runtime.verifyArtifact();
  assert.deepEqual(value.calls.at(-2).artifact, { artifactRoot: value.inputs.request.fixtureRoot,
    expectedBuildRevision: value.inputs.request.buildRevision,
    expectedDescriptorSha256: value.inputs.request.artifactDescriptorSha256 });
  assert.equal(value.calls.at(-1).fixture.temporaryRoot, value.root);
});

test('process environment removes inherited Eky overrides and Node mode case-insensitively', () => {
  const value = workspaceSuccessApplicationEnvironment({
    Path: 'preserved', Temp: 'old', Tmp: 'old', electron_run_as_node: '1', eky_fake: 'private',
  }, { temporaryRoot: 'owned', token: 'token' });
  assert.deepEqual(value, { Path: 'preserved', TEMP: 'owned', TMP: 'owned', EKY_W6B2_PROOF_TOKEN: 'token' });
});

for (const [name, event, expected] of [
  ['zero', ['close', 0, null], 0], ['non-zero', ['close', 9, null], 9],
  ['signal', ['close', null, 'SIGTERM'], 'ownedProcessExitInvalid'],
  ['spawn failure', ['error', new Error('PRIVATE')], 'ownedProcessStartFailed'],
]) {
  test(`owned command observes ${name} without a second cleanup owner`, async () => {
    const child = new EventEmitter();
    let options;
    const promise = runWorkspaceSuccessOwnedCommand('fixture', [], { cwd: 'owned', env: {} }, (_, __, value) => {
      options = value;
      queueMicrotask(() => child.emit(...event));
      return child;
    });
    assert.equal(options.stdio, 'ignore');
    assert.equal(options.shell, false);
    assert.equal(Object.hasOwn(options, 'timeout'), false);
    if (typeof expected === 'number') assert.equal(await promise, expected);
    else await assert.rejects(promise, { message: expected });
  });
}
