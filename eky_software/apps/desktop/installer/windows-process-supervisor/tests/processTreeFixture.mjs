import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SHA_256_PATTERN = /^[0-9a-f]{64}$/;
const MODES = new Set([
  'exitNonZero',
  'exitZero',
  'exitZeroStaleResult',
  'exitZeroWithoutResult',
  'hold',
  'recordArguments',
  'spawnGrandchildAndExit',
  'spawnGrandchildAndHold',
  'spawnGrandchildOnReleaseAndHold',
  'spawnGrandchildThenExitOnRelease',
  'workspaceReservationRelease',
  'workspaceReservationFailure',
  'workspaceReservationDeadline',
  'packagedPreparationFailure',
]);
const ROLES = new Set(['grandchild', 'root', 'sentinel']);

function readArguments(arguments_) {
  const controlArguments = arguments_.slice(0, 7);
  const commandLineProbe = arguments_.slice(7);
  const values = new Map();
  for (const argument of controlArguments) {
    const separator = argument.indexOf('=');
    if (!argument.startsWith('--') || separator <= 2) {
      throw new Error('FIXTURE_ARGUMENT_INVALID');
    }
    const key = argument.slice(2, separator);
    if (values.has(key)) {
      throw new Error('FIXTURE_ARGUMENT_INVALID');
    }
    values.set(key, argument.slice(separator + 1));
  }

  const expectedKeys = [
    'artifactDescriptorSha256',
    'mode',
    'role',
    'runNonce',
    'runRoot',
    'scenario',
    'workerResultPath',
  ];
  if (
    values.size !== expectedKeys.length ||
    expectedKeys.some((key) => !values.has(key)) ||
    (values.get('mode') !== 'recordArguments' && commandLineProbe.length > 0) ||
    commandLineProbe.length > 32
  ) {
    throw new Error('FIXTURE_ARGUMENT_INVALID');
  }

  const mode = values.get('mode');
  const role = values.get('role');
  const runNonce = values.get('runNonce');
  const runRoot = resolve(values.get('runRoot'));
  const scenario = values.get('scenario');
  const artifactDescriptorSha256 = values.get('artifactDescriptorSha256');
  const workerResultPath = resolve(values.get('workerResultPath'));
  if (
    !MODES.has(mode) ||
    !ROLES.has(role) ||
    !SHA_256_PATTERN.test(runNonce) ||
    basename(runRoot) !== runNonce ||
    !/^[a-z][A-Za-z0-9]{0,63}$/.test(scenario) ||
    !SHA_256_PATTERN.test(artifactDescriptorSha256) ||
    dirname(workerResultPath) !== dirname(runRoot) ||
    basename(workerResultPath) !== 'worker-result.json'
  ) {
    throw new Error('FIXTURE_ARGUMENT_INVALID');
  }
  return {
    artifactDescriptorSha256,
    commandLineProbe,
    mode,
    role,
    runNonce,
    runRoot,
    scenario,
    workerResultPath,
  };
}

async function writeJsonAtomic(path, value) {
  const temporaryPath = path + '.' + process.pid + '.tmp';
  await writeFile(temporaryPath, JSON.stringify(value) + '\n', {
    encoding: 'utf8',
    flag: 'wx',
  });
  await rename(temporaryPath, path);
}

async function pathExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function waitForRelease(runRoot, role) {
  const releasePath = join(runRoot, role + '.release');
  while (!(await pathExists(releasePath))) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
}

async function waitForMarker(path) {
  while (!(await pathExists(path))) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  await readFile(path, 'utf8');
}

async function startGrandchild({
  artifactDescriptorSha256,
  runNonce,
  runRoot,
  scenario,
  workerResultPath,
}) {
  const fixturePath = fileURLToPath(import.meta.url);
  const child = spawn(
    process.execPath,
    [
      fixturePath,
      '--mode=hold',
      '--role=grandchild',
      '--scenario=' + scenario,
      '--artifactDescriptorSha256=' + artifactDescriptorSha256,
      '--runNonce=' + runNonce,
      '--runRoot=' + runRoot,
      '--workerResultPath=' + workerResultPath,
    ],
    {
      cwd: dirname(fixturePath),
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    },
  );
  child.unref();
  await waitForMarker(join(runRoot, 'grandchild.ready.json'));
}

async function writeWorkerResult(input, status, resultCode, errorCode, runNonce) {
  if (input.role !== 'root') {
    return;
  }
  await writeJsonAtomic(input.workerResultPath, {
    schemaVersion: 1,
    runNonce: runNonce ?? input.runNonce,
    scenario: input.scenario,
    artifactDescriptorSha256: input.artifactDescriptorSha256,
    status,
    resultCode,
    errorCode,
  });
}

async function main() {
  const input = readArguments(process.argv.slice(2));
  await mkdir(input.runRoot, { recursive: false }).catch((error) => {
    if (error?.code !== 'EEXIST') {
      throw error;
    }
  });
  let workspaceReservation;
  if (input.mode === 'packagedPreparationFailure') {
    if (input.role !== 'root' || process.env.EKY_E2E !== '1') throw new Error('FIXTURE_ARGUMENT_INVALID');
    const { tmpdir } = await import('node:os');
    const { resolvePackagedSmokeTempPath } = await import('../../../dist/main/packagedSmoke.js');
    const { createPackagedWorkspaceDeletionPreparation } = await import('../../../scripts/packagedWorkspaceDeletionPreparation.mjs');
    const { createRunnerFailureSink } = await import('../../../../../test-reporters/runnerFailureEvidence.mjs');
    const smokeToken = input.runNonce.slice(0, 32);
    const context = Object.freeze({ smokeToken,
      smokeRootDirectory: join(resolvePackagedSmokeTempPath(tmpdir()), 'eky-desktop-smoke', smokeToken) });
    const preparation = createPackagedWorkspaceDeletionPreparation({ signal: new AbortController().signal,
      async assertPreviousPhaseStopped(selected, phase) {
        if (selected !== context || phase !== 'new') throw new Error('FIXTURE_ARGUMENT_INVALID');
        if (process.env.EKY_PREPARATION_FIXTURE_GUARD_FAILURE === '1') {
          throw new Error('SYNTHETIC_PREPARATION_GUARD_FIRST', { cause: new Error('SYNTHETIC_PREPARATION_GUARD_CAUSE') });
        }
      } });
    let failure;
    try { await preparation.prepareAfterRestoredExit(context); } catch (error) { failure = { error }; }
    const sink = createRunnerFailureSink({ tempRoot: process.env.RUNNER_TEMP });
    if (failure !== undefined) sink.record({ runner: 'node', phase: 'packagedPreparationOriginal', attempt: 0,
      testId: input.scenario, error: failure.error });
    await sink.flush();
    if (!(failure?.error instanceof Error) || failure.error.message !== 'PACKAGED_DELETION_PREPARATION_INVALID') {
      throw new Error('FIXTURE_EXPECTED_PREPARATION_FAILURE_MISSING', { cause: failure?.error });
    }
    await writeJsonAtomic(join(input.runRoot, 'preparation-failure.private.json'), {
      schemaVersion: 1, runNonce: input.runNonce, errorCode: failure.error.message,
    });
    // The existing failure branch exits without releasing the real preparation's exclusion.
    workspaceReservation = preparation;
  } else if (input.mode.startsWith('workspaceReservation')) {
    if (input.role !== 'root') throw new Error('FIXTURE_ARGUMENT_INVALID');
    const { acquireWorkspaceProcessReservation } = await import(pathToFileURL(
      join(dirname(input.runRoot), 'reservation-runtime', 'workspaceProcessReservation.js')).href);
    workspaceReservation = await acquireWorkspaceProcessReservation({
      userDataRoot: input.runRoot, signal: new AbortController().signal,
    });
    await workspaceReservation.assertOwned();
  }
  await writeJsonAtomic(join(input.runRoot, input.role + '.ready.json'), {
    schemaVersion: 1,
    runNonce: input.runNonce,
    role: input.role,
    processId: process.pid,
  });

  if (workspaceReservation !== undefined) {
    await waitForRelease(input.runRoot, input.role);
    if (input.mode === 'workspaceReservationRelease') {
      await workspaceReservation.release();
      await writeWorkerResult(input, 'completed', 'fixtureCompleted', null);
      return;
    }
    await writeWorkerResult(input, 'failed', 'fixtureFailed', 'fixtureNonZero');
    // Deliberate worker failure, not graceful release or successful profile cleanup.
    process.exit(23);
  }

  if (input.mode === 'exitZero') {
    await writeWorkerResult(
      input,
      'completed',
      'fixtureCompleted',
      null,
    );
    return;
  }
  if (input.mode === 'recordArguments') {
    await writeJsonAtomic(join(input.runRoot, 'command-line-probe.json'), {
      schemaVersion: 1,
      arguments: input.commandLineProbe,
    });
    await writeWorkerResult(
      input,
      'completed',
      'fixtureCompleted',
      null,
    );
    return;
  }
  if (input.mode === 'exitZeroWithoutResult') {
    return;
  }
  if (input.mode === 'exitZeroStaleResult') {
    await writeWorkerResult(
      input,
      'completed',
      'fixtureCompleted',
      null,
      '0'.repeat(64),
    );
    return;
  }
  if (input.mode === 'exitNonZero') {
    await writeWorkerResult(
      input,
      'failed',
      'fixtureFailed',
      'fixtureNonZero',
    );
    process.exitCode = 23;
    return;
  }
  if (input.mode === 'hold') {
    await waitForRelease(input.runRoot, input.role);
    await writeWorkerResult(
      input,
      'completed',
      'fixtureCompleted',
      null,
    );
    return;
  }

  if (input.mode === 'spawnGrandchildOnReleaseAndHold') {
    await writeJsonAtomic(join(input.runRoot, 'grandchild.gate.json'), {
      schemaVersion: 1,
      runNonce: input.runNonce,
      rootProcessId: process.pid,
    });
    await waitForRelease(input.runRoot, 'grandchild-create');
  }
  await startGrandchild(input);
  if (input.mode === 'spawnGrandchildAndExit') {
    await writeWorkerResult(
      input,
      'completed',
      'fixtureCompleted',
      null,
    );
    return;
  }
  await waitForRelease(input.runRoot, input.role);
  if (input.mode === 'spawnGrandchildThenExitOnRelease') {
    await writeWorkerResult(
      input,
      'completed',
      'fixtureCompleted',
      null,
    );
    return;
  }
  await writeFile(join(input.runRoot, 'grandchild.release'), '', {
    flag: 'wx',
  });
  await writeWorkerResult(
    input,
    'completed',
    'fixtureCompleted',
    null,
  );
}

await main();
