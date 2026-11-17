import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  buildWindowsAcceptanceSupervisor,
  createSourceBootstrapProjection,
  assertSourceHandoffBuildBinding,
} from '../buildWindowsAcceptanceSupervisor.mjs';

function recorder(version = '10.0.302\n') {
  const calls = [];
  return {
    calls,
    run: (args, options) => {
      calls.push({ args, options });
      return args[0] === '--version' ? { stdout: version } : { status: 0 };
    },
  };
}

test('ordinary supervisor build retains exactly its two original build selections', async () => {
  const capture = recorder();
  await buildWindowsAcceptanceSupervisor([], {
    run: capture.run,
    prepareJoint: () => assert.fail('ordinary build must not prepare joint resources'),
  });
  assert.equal(capture.calls.length, 3);
  assert.deepEqual(capture.calls[0].args, ['--version']);
  for (const call of capture.calls.slice(1)) {
    assert.deepEqual(call.args.slice(2), ['--configuration', 'Release', '--nologo']);
    assert.equal(call.options.stdio, 'inherit');
  }
  assert.match(capture.calls[1].args[1], /[\\/]windows-process-supervisor[\\/]Eky.WindowsProcessSupervisor\.csproj$/);
  assert.match(capture.calls[2].args[1], /[\\/]programFailureFixture[\\/]Eky.WindowsProcessSupervisor\.ContractFixture\.csproj$/);
});

test('joint build uses a fixed early property owner and flat selector after original builds', async () => {
  const capture = recorder();
  let prepared = 0;
  await buildWindowsAcceptanceSupervisor(['--source-handoff-joint'], {
    run: (args, options) => {
      if (args.some(arg => arg === '-p:EkyJointReservationProof=true')) assert.equal(prepared, 1);
      return capture.run(args, options);
    },
    prepareJoint: () => { prepared++; },
    verifyJoint: () => { assert.equal(capture.calls.length, 4); },
  });
  assert.equal(prepared, 1);
  assert.equal(capture.calls.length, 4);
  assert.deepEqual(capture.calls[1].args.slice(2), ['--configuration', 'Release', '--nologo']);
  assert.deepEqual(capture.calls[2].args.slice(2), ['--configuration', 'Release', '--nologo']);
  const args = capture.calls[3].args;
  assert.equal(args[1], capture.calls[2].args[1]);
  assert(args.includes('-p:EkyJointReservationProof=true'));
  assert.equal(args.filter(arg => arg.startsWith('-p:DirectoryBuildPropsPath=')).length, 1);
  assert.equal(args.filter(arg => arg.startsWith('-p:CustomAfterMicrosoftCommonTargets=')).length, 1);
  assert(args.some(arg => /[\\/]sourceHandoffJoint[\\/]JointProof\.props$/.test(arg)));
  assert(args.some(arg => /[\\/]sourceHandoffJoint[\\/]JointProof\.targets$/.test(arg)));
  assert(args.includes('-p:UseSharedCompilation=false'));
  assert(args.includes('-maxcpucount:1'));
  assert(args.includes('-nodeReuse:false'));
});

test('unsupported build selection is rejected before starting any tool', async () => {
  const capture = recorder();
  for (const args of [['--other'], ['--source-handoff-joint', '--extra'], ['--source-handoff-joint=1']]) {
    await assert.rejects(buildWindowsAcceptanceSupervisor(args, { run: capture.run }),
      /WINDOWS_ACCEPTANCE_SUPERVISOR_BUILD_SELECTION_INVALID/);
  }
  assert.equal(capture.calls.length, 0);
});

test('SDK mismatch stops ordinary and joint builds before resource preparation', async () => {
  for (const args of [[], ['--source-handoff-joint']]) {
    const capture = recorder('10.0.301');
    await assert.rejects(buildWindowsAcceptanceSupervisor(args, {
      run: capture.run,
      prepareJoint: () => assert.fail('mismatched SDK cannot prepare resources'),
    }), /WINDOWS_ACCEPTANCE_SUPERVISOR_DOTNET_SDK_INVALID/);
    assert.equal(capture.calls.length, 1);
  }
});

test('resource preparation failure cannot start the joint build or replace its cause', async () => {
  const capture = recorder();
  const original = new Error('synthetic source projection failure');
  await assert.rejects(buildWindowsAcceptanceSupervisor(['--source-handoff-joint'], {
    run: capture.run,
    prepareJoint: () => { throw original; },
  }), error => error === original);
  assert.equal(capture.calls.length, 3);
});

test('joint verification receives the original preparation and cannot turn failure into acceptance', async () => {
  const capture = recorder();
  const prepared = { synthetic: true };
  const original = new Error('synthetic embedded resource mismatch');
  await assert.rejects(buildWindowsAcceptanceSupervisor(['--source-handoff-joint'], {
    run: capture.run,
    prepareJoint: () => prepared,
    verifyJoint: (actual, run) => {
      assert.equal(actual, prepared);
      assert.equal(run, capture.run);
      assert.equal(capture.calls.length, 4);
      throw original;
    },
  }), error => error === original);
});

test('source and artifact hashes must both still match and paths cannot leave the project', async () => {
  const path = 'apps/desktop/installer/windows-process-supervisor/buildWindowsAcceptanceSupervisor.mjs';
  const bytes = await readFile(new URL('../buildWindowsAcceptanceSupervisor.mjs', import.meta.url));
  const record = { path, sha256: createHash('sha256').update(bytes).digest('hex') };
  const valid = { schemaVersion: 1, sources: [record], artifacts: [record] };
  assertSourceHandoffBuildBinding(valid);
  for (const name of ['sources', 'artifacts']) {
    const changed = structuredClone(valid);
    changed[name][0].sha256 = '0'.repeat(64);
    assert.throws(() => assertSourceHandoffBuildBinding(changed), /BUILD_BINDING_CHANGED/);
    const outside = structuredClone(valid);
    outside[name][0].path = '../outside.txt';
    assert.throws(() => assertSourceHandoffBuildBinding(outside), /INPUT_OUTSIDE_PROJECT/);
    assert.throws(() => assertSourceHandoffBuildBinding({ ...valid, [name]: [] }), /BUILD_BINDING_INVALID/);
  }
  assert.throws(() => assertSourceHandoffBuildBinding({ ...valid, schemaVersion: 2 }), /BUILD_BINDING_INVALID/);
});

test('bootstrap resource is derived from current TS owners without private paths or data', async () => {
  const projection = await createSourceBootstrapProjection();
  const app = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
  const proof = await import('../../../src/main/w6b2PackagedProof.ts');
  assert.equal(projection.schemaVersion, 1);
  assert.equal(projection.proofSwitch, proof.W6B2_PACKAGED_PROOF_SWITCH);
  assert.equal(projection.tokenEnvironment, proof.W6B2_PACKAGED_PROOF_TOKEN_ENV);
  assert.equal(projection.markerFilename, proof.W6B2_PACKAGED_PROOF_MARKER_FILE);
  assert.equal(projection.directoryName, proof.W6B2_PACKAGED_PROOF_DIRECTORY_NAME);
  assert.equal(projection.pathTokenLength, proof.W6B2_PACKAGED_PROOF_PATH_TOKEN_LENGTH);
  assert.deepEqual(projection.faultScenarios, [...proof.w6b2PackagedFaultScenarios]);
  assert.equal(projection.userDataRelative, 'user-data');
  assert.equal(projection.workspaceRunRootPrefix, 'v26-');
  for (const owner of projection.sourceOwners) {
    assert(owner.path.startsWith('apps/desktop/'));
    assert(!owner.path.includes('\\') && !owner.path.includes('.eky-local'));
    assert.equal(owner.sha256, createHash('sha256').update(await readFile(resolve(app, owner.path))).digest('hex'));
  }
  assert(!JSON.stringify(projection).includes('C:\\'));
  assert(!JSON.stringify(projection).includes('D:\\'));
});
