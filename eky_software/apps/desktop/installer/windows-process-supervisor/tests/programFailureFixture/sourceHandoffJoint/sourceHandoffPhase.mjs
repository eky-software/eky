import assert from 'node:assert/strict';
import { lstat, mkdir, open, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readPublishedResult, waitForPublishedResult } from './resultPublicationReader.mjs';
import { readPublicationReady } from './publicationReadyReader.mjs';

import { readWorkspaceCommandPhase, executeWorkspaceCommandPhase }
  from '../../../../windows-acceptance-harness/workspaceCommandPhase.mjs';
import { workspaceCommandFixture }
  from '../../../../windows-acceptance-harness/workspaceCommandFixture.mjs';
import { workspaceSuccessErrorCode, validateWorkspaceSuccessRequest, writeJsonAtomicExclusive }
  from '../../../../windows-acceptance-harness/workspaceSuccessContracts.mjs';
import { workspaceFaultErrorCode, validateWorkspaceFaultRequest }
  from '../../../../windows-acceptance-harness/workspaceFaultContracts.mjs';
import { workspaceSuccessApplicationEnvironment }
  from '../../../../windows-acceptance-harness/workspaceSuccessWindowsRuntime.mjs';
import { parseStrictJsonObjectBytes }
  from '../../../../windows-acceptance-harness/strictJsonObject.mjs';
import { createNativeFailureEvidence }
  from '../../../../windows-acceptance-harness/nativeFailureEvidence.mjs';
import { createW6b2PackagedProofBootstrapConfiguration, W6B2_PACKAGED_PROOF_DIRECTORY_NAME,
  W6B2_PACKAGED_PROOF_PATH_TOKEN_LENGTH, W6B2_PACKAGED_PROOF_SWITCH }
  from '../../../../../src/main/w6b2PackagedProof.ts';

// Private synthetic phase worker. The existing native Job owns source creation,
// NUL handles, admission, deadline and cleanup; this worker never launches a process.
const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const CASE_ENV = 'EKY_M51_ADMITTED_TRANSPORT_CASE';
const CASES = ['exit0', 'fault0', 'exit7', 'wrongBinding', 'replay', 'sourceHold', 'heldRead', 'heldCreation',
  'birthRejected', 'exit7CleanupFailure', 'exit0CleanupFailure'];
const BINDING_KEYS = ['runNonce', 'scenario', 'artifactDescriptorSha256', 'buildRevision', 'scenarioRoot'];
const REPORT_MAX_BYTES = 64 * 1024;
const invalid = () => { throw new Error('requestInvalid'); };
const samePath = (left, right) => process.platform === 'win32'
  ? left.toLowerCase() === right.toLowerCase() : left === right;

function exactKeys(value, keys) {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
}

async function requirePrivateEnvironment() {
  for (const name of ['TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'npm_node_execpath']) {
    if (!process.env[name] || !isAbsolute(process.env[name])) invalid();
  }
  const root = await realpath(tmpdir());
  if (!samePath(await realpath(process.env.TEMP), root) ||
    !samePath(await realpath(process.env.TMP), root)) invalid();
  for (const name of ['APPDATA', 'LOCALAPPDATA']) {
    const child = relative(root, resolve(process.env[name]));
    if (!child || child === '..' || child.startsWith('../') || child.startsWith('..\\') || isAbsolute(child)) invalid();
  }
}

async function prepareFixture(runtime) {
  await mkdir(runtime.temporaryRoot);
  const proofRoot = resolve(runtime.temporaryRoot, W6B2_PACKAGED_PROOF_DIRECTORY_NAME,
    runtime.request.runNonce.slice(0, W6B2_PACKAGED_PROOF_PATH_TOKEN_LENGTH));
  if (!samePath(proofRoot, runtime.proofRoot)) invalid();
  await mkdir(proofRoot, { recursive: true });
  const bootstrap = createW6b2PackagedProofBootstrapConfiguration({ hasProofSwitch: true,
    tempPath: runtime.temporaryRoot, tokenValue: runtime.request.runNonce });
  if (!bootstrap.enabled || !bootstrap.root || !bootstrap.userDataPath ||
    !samePath(bootstrap.root, runtime.proofRoot)) invalid();
  await mkdir(bootstrap.userDataPath);
  if (!samePath(await realpath(bootstrap.userDataPath), bootstrap.userDataPath)) invalid();
}

// Retain bytes as well as strict JSON so replay checks the original result bytes.
// This is a bounded private reader, not the native parent's admission authority.
async function readBounded(path, maximum) {
  const before = await lstat(path, { bigint: true });
  assert(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n);
  assert(before.size >= 2n && before.size <= BigInt(maximum));
  assert(samePath(await realpath(path), path));
  const same = value => ['dev', 'ino', 'size', 'nlink', 'mtimeNs', 'ctimeNs']
    .every(key => value[key] === before[key]);
  const file = await open(path, 'r');
  let failure;
  let result;
  try {
    assert(same(await file.stat({ bigint: true })));
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, size);
      if (bytesRead === 0) break;
      size += bytesRead;
    }
    assert.equal(BigInt(size), before.size);
    assert(same(await file.stat({ bigint: true })) && same(await lstat(path, { bigint: true })));
    assert(samePath(await realpath(path), path));
    const bytes = buffer.subarray(0, size);
    result = { bytes, value: parseStrictJsonObjectBytes(bytes, { maximumBytes: maximum, errorCode: 'requestInvalid' }) };
  } catch (error) { failure = { error }; }
  try { await file.close(); }
  catch (error) {
    if (failure) throw new AggregateError([failure.error, error], 'requestInvalid', { cause: failure.error });
    throw error;
  }
  if (failure) throw failure.error;
  return result;
}

async function readProtocol() {
  const { value: protocol } = await readBounded(resolve(DIRECTORY, 'sourceBridgeProtocol.json'), REPORT_MAX_BYTES);
  assert.equal(protocol.schemaVersion, 1);
  assert.equal(protocol.operation, 'sourceHandoff');
  assert.equal(protocol.requestFile, 'source-launch-request.private.json');
  assert.equal(protocol.resultFile, 'source-launch-result.private.json');
  assert.equal(protocol.controlAckFile, 'bridge-control-ack.private.json');
  assert.deepEqual(protocol.bindingKeys, BINDING_KEYS);
  assert.deepEqual(protocol.cases, CASES);
  for (const size of [protocol.requestMaxBytes, protocol.resultMaxBytes])
    assert(Number.isSafeInteger(size) && size >= 2 && size <= REPORT_MAX_BYTES);
  return protocol;
}

export async function publicationOptions(root, operation) {
  const inspect = async () => {
    operation.assertActive();
    const info = await lstat(root, { bigint: true });
    operation.assertActive();
    assert(info.isDirectory() && !info.isSymbolicLink());
    assert(samePath(await realpath(root), root));
    operation.assertActive();
    return info;
  };
  const original = await inspect();
  return { ...operation, verifyRoot: async () => {
    const current = await inspect();
    assert(current.dev === original.dev && current.ino === original.ino);
  } };
}

async function waitForObject(path, maximum, options, terminalPath, terminalMaximum, terminalOptions, readyPath) {
  const read = async () => {
    if (readyPath) {
      const ready = await readPublicationReady(readyPath, options);
      if (ready.status !== 'ready') return ready;
    }
    return readPublishedResult(path, maximum, options);
  };
  return waitForPublishedResult(async () => {
    const found = await read();
    if (found.status === 'ready') return found;
    if (terminalPath) {
      const terminal = await readPublishedResult(terminalPath, terminalMaximum, terminalOptions);
      if (terminal.status === 'ready') {
        const report = await read();
        if (report.status === 'ready') return report;
        const code = Number.isInteger(terminal.value.exitCode) ? terminal.value.exitCode : 'unknown';
        const reason = ['ownedProcessStartFailed', 'ownedProcessExitInvalid', 'sourceLaunchRequestInvalid']
          .includes(terminal.value.errorCode) ? terminal.value.errorCode : 'unknown';
        throw new Error('NATIVE_SOURCE_ENDED_WITHOUT_REPORT', { cause: new Error(`SOURCE_EXIT_${code}_${reason}`) });
      }
    }
    return found;
  }, options);
}

async function publishRequest(mailbox, protocol, request, options, stagedOnly = false) {
  // .next is retained only as the old replay-control sentinel, never renamed.
  const path = resolve(mailbox, protocol.requestFile) + (stagedOnly ? '.next' : '');
  const bytes = Buffer.from(JSON.stringify(request) + '\n');
  assert(bytes.length <= protocol.requestMaxBytes);
  options.assertActive();
  await options.verifyRoot();
  options.assertActive();
  const file = await open(path, 'wx');
  let primary;
  try {
    options.assertActive();
    const held = await file.stat({ bigint: true });
    options.assertActive();
    assert(held.isFile() && !held.isSymbolicLink() && held.nlink === 1n);
    assert(samePath(await realpath(path), path));
    options.assertActive();
    await file.writeFile(bytes);
    options.assertActive();
    await file.sync();
    options.assertActive();
    const written = await file.stat({ bigint: true });
    const published = await lstat(path, { bigint: true });
    options.assertActive();
    assert(written.isFile() && published.isFile() && !published.isSymbolicLink() && written.nlink === 1n);
    assert.equal(written.size, BigInt(bytes.length));
    assert(['dev', 'ino', 'size', 'nlink', 'mtimeNs', 'ctimeNs'].every(key => written[key] === published[key]));
    await options.verifyRoot();
    options.assertActive();
  } catch (error) { primary = error; }
  try { await file.close(); }
  catch (error) {
    if (primary) throw new AggregateError([primary, error], 'SOURCE_REQUEST_WRITE_AND_CLOSE_FAILED', { cause: primary });
    throw error;
  }
  if (primary) throw primary;
  options.assertActive();
  await options.verifyRoot();
  options.assertActive();
}

async function requireAbsent(path) {
  await lstat(path).then(invalid, error => { if (error.code !== 'ENOENT') throw error; });
}

function verifySource(source, expectedArguments, environment, root) {
  exactKeys(source, ['schemaVersion', 'arguments', 'cwd', 'environment', 'stdinEof', 'stdoutWritable', 'stderrWritable']);
  assert.equal(source.schemaVersion, 1);
  assert.deepEqual(source.arguments, expectedArguments);
  assert.equal(source.cwd, root);
  assert.equal(source.stdinEof, true);
  assert.equal(source.stdoutWritable, true);
  assert.equal(source.stderrWritable, true);
  const keys = ['TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'UNCHANGED', 'UNICODE_VALUE',
    'EMPTY_VALUE', 'EKY_W6B2_PROOF_TOKEN'];
  exactKeys(source.environment, [...keys, 'excludedEkyOverridePresent', 'excludedNodeOverridePresent']);
  for (const key of keys) assert.equal(source.environment[key], environment[key] ?? null);
  assert.equal(source.environment.excludedEkyOverridePresent, false);
  assert.equal(source.environment.excludedNodeOverridePresent, false);
}

export async function readEmptyMarker(path, options) {
  options.assertActive();
  await options.verifyRoot();
  options.assertActive();
  let file;
  try { file = await (options.openFile ?? open)(path, 'r'); }
  catch (error) {
    if (!['ENOENT', 'EBUSY'].includes(error.code)) throw error;
    options.assertActive();
    return { status: 'notReady', code: error.code };
  }
  let first;
  try {
    options.assertActive();
    const held = await file.stat({ bigint: true });
    options.assertActive();
    const selected = await lstat(path, { bigint: true });
    options.assertActive();
    assert(held.isFile() && selected.isFile() && !selected.isSymbolicLink() && held.nlink === 1n);
    assert.equal(held.size, 0n);
    assert(['dev', 'ino', 'size', 'nlink', 'mtimeNs', 'ctimeNs'].every(key => held[key] === selected[key]));
    assert(samePath(await realpath(path), path));
    await options.verifyRoot();
    options.assertActive();
  } catch (error) { first = error; }
  try { await file.close(); }
  catch (error) {
    if (first) throw new AggregateError([first, error], 'RESERVATION_MARKER_READ_AND_CLOSE_FAILED', { cause: first });
    throw error;
  }
  if (first) throw first;
  options.assertActive();
  return { status: 'ready' };
}

export async function waitEmptyMarker(path, options) {
  await waitForPublishedResult(() => readEmptyMarker(path, options), options);
}

export async function publishEmptyMarker(path, options) {
  options.assertActive();
  await options.verifyRoot();
  options.assertActive();
  const file = await (options.openFile ?? open)(path, 'wx');
  let first;
  try {
    options.assertActive();
    const held = await file.stat({ bigint: true });
    options.assertActive();
    assert(held.isFile() && held.nlink === 1n && held.size === 0n);
    assert(samePath(await realpath(path), path));
    options.assertActive();
    await file.sync();
    options.assertActive();
    await options.verifyRoot();
    options.assertActive();
  } catch (error) { first = error; }
  try { await file.close(); }
  catch (error) {
    if (first) throw new AggregateError([first, error], 'RESERVATION_MARKER_WRITE_AND_CLOSE_FAILED', { cause: first });
    throw error;
  }
  if (first) throw first;
  options.assertActive();
  await options.verifyRoot();
  options.assertActive();
}

async function runTransport(context, inputPath, testCase, args, dependencies) {
  const controller = new AbortController();
  const operation = { signal: controller.signal, assertActive: () => controller.signal.throwIfAborted() };
  try { return await runActiveTransport(context, inputPath, testCase, args, dependencies, operation); }
  finally { controller.abort(new Error('SOURCE_TRANSPORT_RETIRED')); }
}

async function runActiveTransport(context, inputPath, testCase, args, dependencies, lifetime) {
  const [scenarioArguments] = args;
  const [, requestPath] = scenarioArguments;
  const mailbox = dirname(inputPath);
  const scenarioRoot = resolve(context.state.runRoot, 'scenario');
  assert.equal(context.phase, 'scenario');
  assert.equal(mailbox, context.phaseRoot);
  assert.notEqual(mailbox, scenarioRoot);
  assert.equal(scenarioArguments.length, 2);
  assert.equal(scenarioArguments[0], '--request');
  assert.equal(requestPath, resolve(scenarioRoot, 'worker-request.json'));
  const { value: rawRequest } = await readBounded(requestPath, REPORT_MAX_BYTES);
  const request = (context.commandKind === 'workspaceFault' ? validateWorkspaceFaultRequest : validateWorkspaceSuccessRequest)(rawRequest);
  assert.equal(request.runNonce, context.scenarioRunNonce);
  assert.equal(request.scenario, context.callerBinding.scenario);
  assert.equal(request.artifactDescriptorSha256, context.callerBinding.artifactDescriptorSha256);
  assert.equal(request.buildRevision, context.callerBinding.buildRevision);
  assert.equal(request.fixtureRoot, context.state.artifact.artifactRoot);
  if (testCase === 'fault0') assert.equal(context.commandKind, 'workspaceFault');
  if (testCase === 'exit0') assert.equal(context.commandKind, 'workspaceSuccess');
  const protocol = await readProtocol();
  const binding = { runNonce: context.scenarioRunNonce, scenario: request.scenario,
    artifactDescriptorSha256: request.artifactDescriptorSha256, buildRevision: request.buildRevision, scenarioRoot };
  exactKeys(binding, protocol.bindingKeys);
  const operation = { schemaVersion: protocol.schemaVersion, binding, operation: protocol.operation };
  const submitted = testCase === 'wrongBinding' ? { ...operation, binding: { ...binding,
    runNonce: binding.runNonce === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64) } } : operation;
  const resultPath = resolve(mailbox, protocol.resultFile);
  const reportPath = resolve(scenarioRoot, 'native-primary.private.json');
  const releasePath = resolve(scenarioRoot, 'native-primary.release');
  const mailboxOptions = await publicationOptions(mailbox, lifetime);
  const sourceOptions = await publicationOptions(scenarioRoot, lifetime);
  const controlsRoot = resolve(mailbox, binding.runNonce);
  const controlOptions = await publicationOptions(controlsRoot, lifetime);
  await requireAbsent(resultPath);
  await requireAbsent(reportPath);
  await requireAbsent(reportPath + '.ready');
  await requireAbsent(releasePath);
  const bootstrap = createW6b2PackagedProofBootstrapConfiguration({ hasProofSwitch: true,
    tempPath: resolve(scenarioRoot, 'p'), tokenValue: request.runNonce });
  assert(bootstrap.enabled && bootstrap.root && bootstrap.userDataPath);
  assert(samePath(await realpath(bootstrap.userDataPath), bootstrap.userDataPath));
  const expectedArguments = [`--${W6B2_PACKAGED_PROOF_SWITCH}`, `--user-data-dir=${bootstrap.userDataPath}`];
  const expectedEnvironment = workspaceSuccessApplicationEnvironment(process.env, {
    temporaryRoot: resolve(scenarioRoot, 'p'), token: request.runNonce });
  // This is test sequencing, not a source-launch or retirement authority receipt.
  await waitEmptyMarker(resolve(controlsRoot, 'reservation-entered.ready'), controlOptions);
  await publishRequest(mailbox, protocol, submitted, mailboxOptions);
  let source;
  if (testCase !== 'wrongBinding') {
    const report = await waitForObject(reportPath, REPORT_MAX_BYTES, sourceOptions,
      resultPath, protocol.resultMaxBytes, mailboxOptions, reportPath + '.ready');
    if (testCase === 'heldRead') throw new Error('HELD_READ_UNEXPECTED_SOURCE_REPORT');
    if (testCase === 'heldCreation') throw new Error('HELD_CREATION_UNEXPECTED_SOURCE_REPORT');
    source = report.value;
    verifySource(source, expectedArguments, expectedEnvironment, scenarioRoot);
    if (testCase !== 'sourceHold') await writeFile(releasePath, '', { flag: 'wx' });
  }
  const firstResult = await waitForObject(resultPath, protocol.resultMaxBytes, mailboxOptions);
  const response = firstResult.value;
  exactKeys(response, ['schemaVersion', 'binding', 'operation', 'status', 'exitCode', 'errorCode']);
  assert.equal(response.schemaVersion, protocol.schemaVersion);
  exactKeys(response.binding, protocol.bindingKeys);
  assert.deepEqual(response.binding, binding);
  assert.equal(response.operation, protocol.operation);
  if (testCase === 'sourceHold') throw new Error('HELD_SOURCE_UNEXPECTED_RESULT');
  if (testCase === 'wrongBinding') {
    assert.equal(response.status, 'failed');
    assert.equal(response.exitCode, null);
    assert.equal(response.errorCode, 'sourceLaunchRequestInvalid');
    await requireAbsent(reportPath);
    await requireAbsent(releasePath);
  } else {
    assert.equal(response.status, 'completed');
    assert.equal(response.exitCode, ['exit7', 'exit7CleanupFailure'].includes(testCase) ? 7 : 0);
    assert.equal(response.errorCode, null);
  }
  let replay;
  if (testCase === 'replay') {
    await publishRequest(mailbox, protocol, operation, mailboxOptions, true);
    replay = (await waitForObject(resolve(mailbox, protocol.controlAckFile), protocol.resultMaxBytes, mailboxOptions)).value;
    assert.deepEqual(replay, { schemaVersion: 1, replayRejected: true });
    const repeatedResult = await readPublishedResult(resultPath, protocol.resultMaxBytes, mailboxOptions);
    assert.equal(repeatedResult.status, 'ready');
    assert.deepEqual(repeatedResult.value, response);
    assert(repeatedResult.bytes.equals(firstResult.bytes));
  }
  await publishEmptyMarker(resolve(controlsRoot, 'exchange-completed.release'), controlOptions);
  await waitEmptyMarker(resolve(controlsRoot, 'reservation-returned.ready'), controlOptions);
  await writeJsonAtomicExclusive(resolve(mailbox, 'bridge-worker-proof.private.json'), { schemaVersion: 1,
    case: testCase, binding, response, source: source ?? null, replay: replay ?? null,
    originalResultPreserved: true, nativeSourceResultReceivedBeforeWorkerExit: true });
  if (testCase === 'wrongBinding') return 1;
  if (['exit7', 'exit7CleanupFailure'].includes(testCase)) return response.exitCode;
  // Preserve the original synthetic business result and application worker result.
  // A replay may finish this worker successfully; only its native owner rejects it.
  await publishEmptyMarker(resolve(controlsRoot, 'worker-continuation.ready'), controlOptions);
  return dependencies.runScenario(...args);
}

function phaseErrorCode(error, context) {
  if (['productStateVerificationFailed', 'semanticCleanupFailed', 'fixtureCleanupFailed'].includes(error?.message))
    return error.message;
  return (context.commandKind === 'workspaceFault' ? workspaceFaultErrorCode : workspaceSuccessErrorCode)(error);
}

export async function runAdmittedTransportPhaseFixture(args) {
  let context;
  let evidence;
  let firstFailureObserved = false;
  const observeFailure = (error, phase) => {
    if (firstFailureObserved) return;
    firstFailureObserved = true;
    evidence ??= createNativeFailureEvidence(import.meta.url, context?.binding ?? { scenario: 'workspaceCommandPhase' });
    evidence(error, phase);
  };
  try {
    if (args.length !== 2 || args[0] !== '--phase-request' || !isAbsolute(args[1]) || args[1] !== resolve(args[1])) invalid();
    await requirePrivateEnvironment();
    context = await readWorkspaceCommandPhase(args[1]);
    const testCase = process.env[CASE_ENV];
    if (!['exit0', 'sourceHold'].includes(testCase)) invalid();
    const dependencies = workspaceCommandFixture(context, 'normal', invalid);
    const runScenario = (...scenarioArgs) => runTransport(context, args[1], testCase, scenarioArgs, dependencies);
    const code = await executeWorkspaceCommandPhase(context, { ...dependencies, prepareFixture, runScenario, observeFailure });
    if (context.phase !== 'scenario') {
      await writeJsonAtomicExclusive(resolve(context.phaseRoot, 'phase-state.json'),
        { binding: context.binding, state: context.state });
    }
    await writeJsonAtomicExclusive(resolve(context.phaseRoot, 'worker-result.json'), { ...context.binding,
      status: code === 0 ? 'completed' : 'failed', resultCode: code === 0 ? 'phaseCompleted' : 'phaseFailed',
      errorCode: code === 0 ? null : 'phaseFailed' });
    return code;
  } catch (error) {
    observeFailure(error, context?.phase ?? 'phaseRequest');
    if (context) {
      try {
        await writeJsonAtomicExclusive(resolve(context.phaseRoot, 'phase-error.json'),
          { binding: context.binding, errorCode: phaseErrorCode(error, context) });
      } catch { /* Missing required evidence remains failure; never replace the first cause. */ }
    }
    return 1;
  } finally {
    await evidence?.finish();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await runAdmittedTransportPhaseFixture(process.argv.slice(2));
}
