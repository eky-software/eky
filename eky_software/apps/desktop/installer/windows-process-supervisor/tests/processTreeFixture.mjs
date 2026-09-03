import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA_256_PATTERN = /^[0-9a-f]{64}$/;
const MODES = new Set([
  'exitNonZero',
  'exitZero',
  'exitZeroStaleResult',
  'exitZeroWithoutResult',
  'hold',
  'spawnGrandchildAndExit',
  'spawnGrandchildAndHold',
  'spawnGrandchildThenExitOnRelease',
]);
const ROLES = new Set(['grandchild', 'root', 'sentinel']);

function readArguments(arguments_) {
  const values = new Map();
  for (const argument of arguments_) {
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
    expectedKeys.some((key) => !values.has(key))
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
  await writeJsonAtomic(join(input.runRoot, input.role + '.ready.json'), {
    schemaVersion: 1,
    runNonce: input.runNonce,
    role: input.role,
    processId: process.pid,
  });

  if (input.mode === 'exitZero') {
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
