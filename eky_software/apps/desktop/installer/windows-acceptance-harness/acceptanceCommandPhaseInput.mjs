import { lstat, open, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { parseStrictJsonObjectBytes } from './strictJsonObject.mjs';
import { validateWindowsAcceptanceSupervisorResult } from '../windows-process-supervisor/windowsAcceptanceSupervisorResult.mjs';

const MAX_BYTES = 16 * 1024 * 1024;
const invalid = () => { throw new Error('commandPhaseInputInvalid'); };
export const hasExactPhaseKeys = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');

// This reader owns only private delivery. It cannot select a command, grant
// cleanup permission, start a process, or interpret business evidence.
export async function readCommandPhaseJson(path) {
  const before = await lstat(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n ||
    before.size < 2n || before.size > BigInt(MAX_BYTES)) invalid();
  const same = (value) => ['dev', 'ino', 'size', 'nlink', 'mtimeNs', 'ctimeNs'].every((key) => value[key] === before[key]);
  const file = await open(path, 'r');
  try {
    if (!same(await file.stat({ bigint: true }))) invalid();
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let size = 0;
    while (size < bytes.length) {
      const result = await file.read(bytes, size, bytes.length - size, size);
      if (result.bytesRead === 0) break;
      size += result.bytesRead;
    }
    if (BigInt(size) !== before.size || !same(await file.stat({ bigint: true })) ||
      !same(await lstat(path, { bigint: true }))) invalid();
    return parseStrictJsonObjectBytes(bytes.subarray(0, size), { maximumBytes: MAX_BYTES, errorCode: 'commandPhaseInputInvalid' });
  } finally { await file.close(); }
}

async function requireDirectory(path) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== resolve(path)) invalid();
}

export async function readAcceptanceCommandPhase(inputPath, { commandKind, phases, parseArguments, createState, validateState }) {
  if (inputPath !== resolve(inputPath) || basename(inputPath) !== 'phase-input.json') invalid();
  const phaseRoot = dirname(inputPath), commandRoot = dirname(phaseRoot);
  if (!/^eky-acceptance-command-[0-9a-f]{32}$/.test(basename(commandRoot)) ||
    dirname(commandRoot) !== await realpath(tmpdir())) invalid();
  await requireDirectory(commandRoot);
  await requireDirectory(phaseRoot);
  const input = await readCommandPhaseJson(inputPath);
  if (!hasExactPhaseKeys(input, ['schemaVersion', 'phase', 'commandKind', 'scenarioRunNonce', 'commandArguments', 'history']) ||
    input.schemaVersion !== 1 || input.commandKind !== commandKind || !/^[0-9a-f]{64}$/.test(input.scenarioRunNonce) ||
    basename(phaseRoot) !== input.phase || !Array.isArray(input.history) ||
    !Array.isArray(input.commandArguments) || input.commandArguments.some((value) => typeof value !== 'string')) invalid();
  const parsed = parseArguments(input.commandArguments);
  const index = input.phase === 'publishFailure' ? input.history.length : phases.indexOf(input.phase);
  if (index < 0 || index !== input.history.length || index > phases.length) invalid();
  const reports = {};
  for (const [offset, item] of input.history.entries()) {
    if (!hasExactPhaseKeys(item, ['phase', 'runNonce', 'exitCode', 'resultWritten', 'processBoundaryVerified', 'requestErrorCode']) ||
      item.phase !== phases[offset] || !/^[0-9a-f]{64}$/.test(item.runNonce) ||
      ![0, 1].includes(item.exitCode) || item.resultWritten !== true ||
      item.processBoundaryVerified !== true || item.requestErrorCode !== null ||
      (item.phase === 'scenario' && item.runNonce !== input.scenarioRunNonce)) invalid();
    await requireDirectory(resolve(commandRoot, item.phase));
    reports[item.phase] = validateWindowsAcceptanceSupervisorResult(await readCommandPhaseJson(resolve(commandRoot, item.phase, 'result.json')), {
      runNonce: item.runNonce, scenario: item.phase === 'scenario' ? parsed.binding.scenario : 'acceptanceCommandPhase',
      artifactDescriptorSha256: parsed.binding.artifactDescriptorSha256, supervisorExitCode: item.exitCode,
    });
    if (!reports[item.phase].processTreeAbsent) invalid();
    if (item.exitCode !== 0 && item.phase !== 'scenario' && input.phase !== 'publishFailure') invalid();
  }
  const request = await readCommandPhaseJson(resolve(phaseRoot, 'request.json'));
  if (request.artifactDescriptorSha256 !== parsed.binding.artifactDescriptorSha256 ||
    request.workingDirectory !== phaseRoot || !/^[0-9a-f]{64}$/.test(request.runNonce) ||
    request.scenario !== (input.phase === 'scenario' ? parsed.binding.scenario : 'acceptanceCommandPhase') ||
    (input.phase === 'scenario' && request.runNonce !== input.scenarioRunNonce)) invalid();
  const binding = { schemaVersion: 1, runNonce: request.runNonce, scenario: request.scenario,
    artifactDescriptorSha256: request.artifactDescriptorSha256 };
  let state = createState();
  for (const item of [...input.history].reverse()) {
    if (item.phase === 'scenario') continue;
    const failedPublication = input.phase === 'publishFailure' && item.exitCode === 1 &&
      reports[item.phase].processResultCode === 'processExitFailed' && reports[item.phase].childExitCode === 1;
    if (item.exitCode !== 0 && !failedPublication) continue;
    let previous;
    try { previous = await readCommandPhaseJson(resolve(commandRoot, item.phase, 'phase-state.json')); }
    catch (error) { if (failedPublication && error.code === 'ENOENT') continue; throw error; }
    if (!hasExactPhaseKeys(previous, ['binding', 'state']) || !hasExactPhaseKeys(previous.binding, Object.keys(binding)) ||
      previous.binding.runNonce !== item.runNonce || previous.binding.schemaVersion !== 1 ||
      previous.binding.scenario !== 'acceptanceCommandPhase' ||
      previous.binding.artifactDescriptorSha256 !== binding.artifactDescriptorSha256) invalid();
    state = previous.state;
    break;
  }
  if (input.history.some((item) => item.phase === 'prepare' && item.exitCode === 0)) {
    const prepared = await readCommandPhaseJson(resolve(commandRoot, 'prepare', 'phase-state.json'));
    if (prepared.binding?.runNonce !== input.history[0].runNonce ||
      prepared.binding?.artifactDescriptorSha256 !== binding.artifactDescriptorSha256 ||
      state.runRoot !== prepared.state?.runRoot) invalid();
  }
  await validateState(state, input);
  return { ...input, ...parsed, callerBinding: parsed.binding, phaseRoot, commandRoot, reports, binding, state };
}
