import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { access, link, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import test from 'node:test';

import {
  createWorkspaceSuccessWindowsRuntime, runWorkspaceSuccessOwnedCommand,
  workspaceSuccessApplicationEnvironment, removeWorkspaceSuccessPreviousResult,
} from './workspaceSuccessWindowsRuntime.mjs';

async function fixture(context, changes = {}) {
  const root = await mkdtemp(resolve(await realpath(tmpdir()), 'eky-v26-runtime-contract-'));
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
    artifactDescriptorSha256: 'c'.repeat(64), fixtureRoot: resolve(root, 'artifact') },
  artifact, temporaryRoot: root, scenarioRoot: root, runFixture: { proofRoot: root, token },
  profileRuntime: { executablePath: resolve(root, 'electron.exe'), applicationPath: resolve(root, 'profile') },
  proofProtocol: {
    W6B2_PACKAGED_PROOF_SWITCH: 'w6b2-packaged-proof',
    createW6b2PackagedProofBootstrapConfiguration: () => ({ root, userDataPath: resolve(root, 'user-data') }),
    parseW6b2PackagedProofResult: (value) => value,
  },
  profileProtocol: {
    W6B2_PACKAGED_PROFILE_RESULT_FILE: 'profile-result.json',
    W6B2_PACKAGED_PROFILE_OPERATION_ENV: 'EKY_W6B2_PROFILE_OPERATION',
    parseW6b2PackagedProfileCommandResult: (value) => value,
  },
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
      return changes.exitCode ?? 0;
    },
    async readObject(path) {
      if (path.endsWith('w6b2-proof-result.json')) return changes.proofResult ?? { formatVersion: 1, phase, status: 'completed' };
      if (path.endsWith('profile-result.json')) return changes.profileResult ?? { formatVersion: 1, operation, status: 'completed' };
      if (activityQuery) return changes.activity?.shift() ?? { schemaVersion: 1, msiClientCount: 0 };
      const installed = changes.noTarget !== true && inspectionRole === 'target';
      return { schemaVersion: 1, productState: installed ? 5 : -1,
        productName: installed ? 'Eky' : null, productVersion: installed ? '0.2.8' : null,
        localPackagePresent: installed, ownedRegistryExists: true, ekyProcessCount: 0 };
    },
    async inspectPayload() { return changes.payload ?? { identity: 'target' }; },
    async inspectFootprint() { return { installRootExists: true, executableExists: true, shortcutExists: true }; },
    async verifyArtifact(value) { calls.push({ artifact: value }); },
    async verifyRunFixture(value) { calls.push({ fixture: value }); },
    async writePhase(_, value) { phase = value; calls.push({ phase }); },
    async nextObservation() { calls.push({ observation: true }); },
  };
  return { root, calls, inputs, dependencies,
    runtime: await createWorkspaceSuccessWindowsRuntime(inputs, dependencies) };
}

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

test('profile preparation uses the existing named profile entrypoint and environment', async (context) => {
  const value = await fixture(context);
  await value.runtime.prepareProfile();
  const call = value.calls[0];
  assert.equal(call.command, value.inputs.profileRuntime.executablePath);
  assert.deepEqual(call.args, [value.inputs.profileRuntime.applicationPath]);
  assert.equal(call.options.env.EKY_W6B2_PROFILE_OPERATION, 'prepare');
  assert.equal(call.options.env.TEMP, value.root);
});

test('profile result from a different operation cannot be reused', async (context) => {
  const value = await fixture(context, { profileResult: { formatVersion: 1, operation: 'prepare', status: 'completed' } });
  await assert.rejects(() => value.runtime.verifyProfile('rejectC'), { message: 'profileResultInvalid' });
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
