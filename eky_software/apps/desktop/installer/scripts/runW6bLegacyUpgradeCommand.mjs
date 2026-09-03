import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { runW6bLegacyUpgradeAcceptance } from './runW6bLegacyUpgradeAcceptance.mjs';
import {
  runW6bLegacyAcceptanceProcess,
  W6B_LEGACY_ACCEPTANCE_CLEANUP_TIMEOUT_MILLISECONDS,
  W6B_LEGACY_ACCEPTANCE_HEARTBEAT_MILLISECONDS,
} from './w6bLegacyAcceptanceProcess.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const scriptDirectory = dirname(scriptPath);
const repositoryRoot = resolve(scriptDirectory, '..', '..', '..', '..');
const proofTokenPattern = /^[0-9a-f]{64}$/u;

export const W6B_LEGACY_COMMAND_TIMEOUT_MILLISECONDS = 25 * 60 * 1000;

const defaultDependencies = Object.freeze({
  createProcessProofToken: () => randomBytes(32).toString('hex'),
  runAcceptance: runW6bLegacyUpgradeAcceptance,
  runProcess,
});

export async function runW6bLegacyUpgradeCommand(
  arguments_ = [],
  options = {},
) {
  if (!Array.isArray(arguments_) || arguments_.length !== 0) {
    throw new Error('W6B_LEGACY_COMMAND_ARGUMENTS_INVALID');
  }
  const dependencies = {
    ...defaultDependencies,
    ...(options.dependencies ?? {}),
  };
  const processProofToken = dependencies.createProcessProofToken();
  if (!proofTokenPattern.test(processProofToken)) {
    throw new Error('W6B_LEGACY_COMMAND_PROOF_TOKEN_INVALID');
  }
  return dependencies.runProcess(
    process.execPath,
    [scriptPath, '--worker', `--process-proof-token=${processProofToken}`],
    { processProofToken },
  );
}

export async function runW6bLegacyUpgradeCommandWorker(
  arguments_,
  options = {},
) {
  parseWorkerArguments(arguments_);
  const dependencies = {
    ...defaultDependencies,
    ...(options.dependencies ?? {}),
  };
  return dependencies.runAcceptance();
}

export function parseW6bLegacyUpgradeCommandWorkerArguments(arguments_) {
  return parseWorkerArguments(arguments_);
}

function parseWorkerArguments(arguments_) {
  if (
    !Array.isArray(arguments_) ||
    arguments_.length !== 2 ||
    arguments_[0] !== '--worker' ||
    !arguments_[1]?.startsWith('--process-proof-token=')
  ) {
    throw new Error('W6B_LEGACY_COMMAND_WORKER_ARGUMENTS_INVALID');
  }
  const processProofToken = arguments_[1].slice(
    '--process-proof-token='.length,
  );
  if (!proofTokenPattern.test(processProofToken)) {
    throw new Error('W6B_LEGACY_COMMAND_WORKER_ARGUMENTS_INVALID');
  }
  return Object.freeze({ processProofToken });
}

function runProcess(command, arguments_, context) {
  return runW6bLegacyAcceptanceProcess({
    arguments: arguments_,
    cleanupTimeoutMilliseconds:
      W6B_LEGACY_ACCEPTANCE_CLEANUP_TIMEOUT_MILLISECONDS,
    command,
    cwd: repositoryRoot,
    environment: process.env,
    heartbeatMilliseconds: W6B_LEGACY_ACCEPTANCE_HEARTBEAT_MILLISECONDS,
    processKind: 'command',
    proofToken: context.processProofToken,
    timeoutMilliseconds: W6B_LEGACY_COMMAND_TIMEOUT_MILLISECONDS,
  });
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    const arguments_ = process.argv.slice(2);
    const result =
      arguments_[0] === '--worker'
        ? await runW6bLegacyUpgradeCommandWorker(arguments_)
        : await runW6bLegacyUpgradeCommand(arguments_);
    console.log(JSON.stringify(result));
  } catch {
    process.exitCode = 1;
  }
}
