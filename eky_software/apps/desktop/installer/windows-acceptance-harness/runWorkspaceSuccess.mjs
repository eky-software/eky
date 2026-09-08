import { spawn } from 'node:child_process';
import { lstat, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { WORKSPACE_SUCCESS_DESCRIPTOR_FILENAME } from './workspaceSuccessArtifactDescriptor.mjs';
import { verifyWorkspaceSuccessArtifact } from './workspaceSuccessArtifact.mjs';
import { createWorkspaceSuccessRequest, readWorkspaceSuccessResult, workspaceSuccessResultPath,
  workspaceSuccessErrorCode, writeJsonAtomicExclusive } from './workspaceSuccessContracts.mjs';
import { requireWorkspaceSuccessProductPrecondition, resolveWorkspaceSuccessTerminalOutcome,
  resolveWorkspaceFaultTerminalOutcome, workspaceSuccessRunRootRemovable } from './workspaceSuccessFailureBoundary.mjs';
import { WORKSPACE_FAULT_SCENARIO, createWorkspaceFaultRequest, readWorkspaceFaultResult, workspaceFaultResultPath,
  workspaceFaultErrorCode, workspaceFaultPlan } from './workspaceFaultContracts.mjs';
import { loadWorkspaceFaultProfileSupport } from './workspaceFaultProfileEvidence.mjs';
import { verifyWorkspaceFaultSemanticPostcondition } from './workspaceFaultPostcondition.mjs';
import { verifyWorkspaceFaultSessionEvidence } from './workspaceFaultSessionEvidence.mjs';
import { materializeWorkspaceSuccessArtifactFixture, prepareWorkspaceSuccessRunFixture,
  WORKSPACE_SUCCESS_RUN_ROOT_PREFIX, workspaceSuccessRunContext } from './workspaceSuccessRunFixture.mjs';
import { loadWorkspaceSuccessProfileSupport } from './workspaceSuccessProfileEvidence.mjs';
import { verifyWorkspaceSuccessSemanticPostcondition } from './workspaceSuccessPostcondition.mjs';
import { createUpgradeRollbackPostSupervisorWindowsRuntime } from './upgradeRollbackPostSupervisorWindowsRuntime.mjs';
import { inspectLegacyInstallerFootprint } from './legacyUpgradeWindowsRuntime.mjs';
import { createClosedDirectoryInventory, inventoriesMatch } from './closedDirectoryInventory.mjs';
import { parseAbsoluteWindowsAcceptancePath } from './windowsAcceptancePathArgument.mjs';
import { readWindowsAcceptanceSupervisorResult } from '../windows-process-supervisor/windowsAcceptanceSupervisorResult.mjs';

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const SUPERVISOR_DLL = resolve(DIRECTORY, '../bin/windows-process-supervisor/Release/net10.0/Eky.WindowsProcessSupervisor.dll');
// Preserve the existing W6B.2A scenario budget; builds are outside this Job.
export const WORKSPACE_SUCCESS_TIMEOUT_MILLISECONDS = 720_000;
export const WORKSPACE_SUCCESS_CLEANUP_RESERVE_MILLISECONDS = 30_000;
const failures = new WeakMap();
class WorkspaceSuccessCommandFailure extends Error {
  constructor(result) { super('WINDOWS_ACCEPTANCE_WORKSPACE_FAILED'); failures.set(this, Object.freeze(result)); }
}
export const workspaceSuccessCommandFailureDetails = (error) => failures.get(error) ?? null;

export function parseWorkspaceSuccessArguments(args) {
  if (args.length !== 6 || args[0] !== '--artifact-descriptor' || args[2] !== '--expected-descriptor-sha256' ||
    args[4] !== '--expected-build-revision' || !/^[0-9a-f]{64}$/.test(args[3]) || !/^[0-9a-f]{40}$/.test(args[5])) {
    throw new Error('requestInvalid');
  }
  const descriptor = parseAbsoluteWindowsAcceptancePath(args[1], 'requestInvalid');
  if (resolve(dirname(descriptor), WORKSPACE_SUCCESS_DESCRIPTOR_FILENAME) !== descriptor) throw new Error('requestInvalid');
  return { artifactRoot: dirname(descriptor), expectedDescriptorSha256: args[3], expectedBuildRevision: args[5] };
}

export function parseWorkspaceFaultArguments(args) {
  if (args.length !== 8 || args[6] !== '--fault-scenario') throw new Error('requestInvalid');
  try { workspaceFaultPlan(args[7]); }
  catch { throw new Error('requestInvalid'); }
  return { ...parseWorkspaceSuccessArguments(args.slice(0, 6)), faultScenario: args[7] };
}

async function requireSupervisor() {
  const metadata = await lstat(SUPERVISOR_DLL);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.size === 0) {
    throw new Error('supervisorBinaryInvalid');
  }
}

async function profileRootExists(path) {
  try { await lstat(path); return true; }
  catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

function launchSupervisor(path, root) {
  const child = spawn(process.env.EKY_DOTNET_EXE || 'dotnet', [SUPERVISOR_DLL, '--request', path], {
    cwd: root, stdio: 'inherit', windowsHide: true, shell: false,
  });
  const completion = new Promise((resolvePromise, rejectPromise) => {
    child.once('error', () => rejectPromise(new Error('supervisorStartFailed')));
    child.once('close', (code, signal) => signal !== null || !Number.isInteger(code)
      ? rejectPromise(new Error('supervisorExitInvalid')) : resolvePromise(code));
  });
  return { child, completion };
}

async function verifyRemoval(environment) {
  const root = resolve(environment.LOCALAPPDATA, 'Programs', 'Eky');
  const footprint = await inspectLegacyInstallerFootprint({ installRoot: root, executablePath: resolve(root, 'Eky.exe'),
    shortcutPath: resolve(environment.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Eky', 'Eky.lnk') });
  if (Object.values(footprint).some((value) => value !== false)) throw new Error('installerFootprintUnverified');
  return { status: 'completed', resultCode: 'installerFootprintAbsent' };
}

export function workspaceCommandErrorCode(error, fault = false) {
  return ['supervisorBinaryInvalid', 'supervisorStartFailed', 'supervisorExitInvalid', 'supervisorResultUnavailable',
    'productStateVerificationFailed', 'productStateVerificationTimedOut', 'productStateVerificationProcessRemains']
    .includes(error?.message) ? error.message : (fault ? workspaceFaultErrorCode : workspaceSuccessErrorCode)(error);
}

export async function runWorkspaceSuccess(args, options) {
  return runWorkspaceAcceptance(parseWorkspaceSuccessArguments(args), options);
}

export async function runWorkspaceFault(args, options) {
  return runWorkspaceAcceptance(parseWorkspaceFaultArguments(args), options);
}

// One caller owns supervisor invocation and post-supervisor cleanup for both
// closed workspace contracts. Workers cannot add another process owner.
async function runWorkspaceAcceptance(artifactInput, {
  platform = process.platform, environment = process.env, checkSupervisor = requireSupervisor,
  materializeFixture = materializeWorkspaceSuccessArtifactFixture, prepareFixture = prepareWorkspaceSuccessRunFixture,
  verifyArtifact = verifyWorkspaceSuccessArtifact, inventoryProfile = createClosedDirectoryInventory,
  createProductRuntime = createUpgradeRollbackPostSupervisorWindowsRuntime, startSupervisor = launchSupervisor,
  readSupervisor = readWindowsAcceptanceSupervisorResult, readScenario,
  verifySemantic, verifySessions = verifyWorkspaceFaultSessionEvidence,
  verifyFootprint = verifyRemoval, removeRunRoot = (root) => rm(root, { recursive: true, force: true }),
} = {}) {
  if (platform !== 'win32' || !environment.APPDATA || !environment.LOCALAPPDATA) throw new Error('requestInvalid');
  const { faultScenario } = artifactInput;
  const fault = faultScenario !== undefined;
  readScenario ??= fault ? readWorkspaceFaultResult : readWorkspaceSuccessResult;
  verifySemantic ??= async (input) => fault
    ? verifyWorkspaceFaultSemanticPostcondition({ ...input, support: await loadWorkspaceFaultProfileSupport() })
    : verifyWorkspaceSuccessSemanticPostcondition({ ...input, support: await loadWorkspaceSuccessProfileSupport() });
  await checkSupervisor();
  const temporaryRoot = await realpath(tmpdir());
  const runRoot = await mkdtemp(resolve(temporaryRoot, WORKSPACE_SUCCESS_RUN_ROOT_PREFIX));
  let context = null;
  let supervisor = null;
  let supervisorAttempted = false;
  let terminal = null;
  let errorCode = null;
  let safetyErrorCode = null;
  let profileBefore = null;
  let profileAfter = null;
  let profilePresentBefore = null;
  let profilePresentAfter = null;
  let fixtureRemoved = false;
  let fixtureCleanupResultCode = 'retainedUnverified';
  const stopSupervisor = () => {
    if (supervisor?.child.exitCode === null && supervisor.child.signalCode === null) supervisor.child.kill();
  };
  process.once('SIGINT', stopSupervisor);
  process.once('SIGTERM', stopSupervisor);
  try {
    profilePresentBefore = await profileRootExists(resolve(environment.APPDATA, 'Eky'));
    profileBefore = await inventoryProfile(resolve(environment.APPDATA, 'Eky'));
    const artifact = await materializeFixture(artifactInput, resolve(runRoot, 'fixture'));
    const scenarioRoot = resolve(runRoot, 'scenario');
    await mkdir(scenarioRoot);
    const workerRequestPath = resolve(scenarioRoot, 'worker-request.json');
    const request = (fault ? createWorkspaceFaultRequest : createWorkspaceSuccessRequest)({ faultScenario, fixtureRoot: artifact.artifactRoot,
      buildRevision: artifact.buildRevision, artifactDescriptorSha256: artifact.descriptorSha256 });
    context = workspaceSuccessRunContext(workerRequestPath, request, artifact);
    const runtime = createProductRuntime({ artifact: { roles: { source: artifact.source, target: artifact.target } }, scenarioRoot });
    const productPrecondition = requireWorkspaceSuccessProductPrecondition(await runtime.verifyExactProductStates());
    await prepareFixture(context);
    await writeJsonAtomicExclusive(workerRequestPath, request);
    const supervisorRequestPath = resolve(scenarioRoot, 'request.json');
    await writeJsonAtomicExclusive(supervisorRequestPath, {
      schemaVersion: 1, scenario: request.scenario, runNonce: request.runNonce,
      artifactDescriptorSha256: request.artifactDescriptorSha256, command: process.execPath,
      arguments: [resolve(DIRECTORY, fault ? 'runWorkspaceFaultWorker.mjs' : 'runWorkspaceSuccessWorker.mjs'), '--request', workerRequestPath],
      workingDirectory: scenarioRoot, timeoutMilliseconds: WORKSPACE_SUCCESS_TIMEOUT_MILLISECONDS,
      cleanupReserveMilliseconds: WORKSPACE_SUCCESS_CLEANUP_RESERVE_MILLISECONDS,
    });
    supervisorAttempted = true;
    supervisor = startSupervisor(supervisorRequestPath, scenarioRoot);
    const supervisorExitCode = await supervisor.completion;
    supervisor = null;
    let supervisorResult = null;
    try {
      supervisorResult = await readSupervisor(resolve(scenarioRoot, 'result.json'), {
        scenario: request.scenario, runNonce: request.runNonce,
        artifactDescriptorSha256: request.artifactDescriptorSha256, supervisorExitCode,
      });
    } catch { errorCode = 'supervisorResultUnavailable'; }
    terminal = await (fault ? resolveWorkspaceFaultTerminalOutcome : resolveWorkspaceSuccessTerminalOutcome)({
      ...runtime, request, productPrecondition, supervisorResult,
      readScenarioResult: () => readScenario((fault ? workspaceFaultResultPath : workspaceSuccessResultPath)(workerRequestPath), request),
      verifySemanticPostcondition: () => verifySemantic(context),
      verifySessionPostcondition: () => verifySessions(context),
      verifyRemovalPostcondition: () => verifyFootprint(environment),
    });
    errorCode ??= terminal.errorCode;
  } catch (error) { errorCode ??= workspaceCommandErrorCode(error, fault); }
  finally {
    process.off('SIGINT', stopSupervisor);
    process.off('SIGTERM', stopSupervisor);
    stopSupervisor();
    if (supervisor) await supervisor.completion.catch(() => undefined);
    if (context) {
      try {
        await verifyArtifact(artifactInput);
        await verifyArtifact({ ...artifactInput, artifactRoot: context.artifact.artifactRoot });
      } catch { safetyErrorCode = 'artifactChanged'; }
    }
    if (profileBefore !== null) {
      try {
        profileAfter = await inventoryProfile(resolve(environment.APPDATA, 'Eky'));
        profilePresentAfter = await profileRootExists(resolve(environment.APPDATA, 'Eky'));
        if (profilePresentBefore !== profilePresentAfter || !inventoriesMatch(profileBefore, profileAfter)) throw new Error();
      } catch { safetyErrorCode ??= 'normalProfileChanged'; }
    }
    if (safetyErrorCode === null && workspaceSuccessRunRootRemovable({ supervisorAttempted, terminal })) {
      try {
        await removeRunRoot(runRoot);
        await lstat(runRoot).then(() => { throw new Error(); }, (error) => { if (error?.code !== 'ENOENT') throw error; });
        fixtureRemoved = true;
        fixtureCleanupResultCode = 'fixtureRemoved';
      } catch { fixtureCleanupResultCode = 'fixtureCleanupFailed'; errorCode ??= 'fixtureCleanupFailed'; }
    }
  }
  const result = { schemaVersion: 1, scenario: fault ? WORKSPACE_FAULT_SCENARIO : 'packagedWorkspaceSuccess',
    ...(fault ? { faultScenario } : {}), ...terminal,
    status: errorCode === null && safetyErrorCode === null && fixtureRemoved ? 'completed' : 'failed',
    errorCode: errorCode ?? safetyErrorCode, safetyErrorCode, fixtureCleanupResultCode, fixtureRemoved,
    businessDataPreserved: profileBefore !== null && profileAfter !== null && profilePresentBefore === profilePresentAfter &&
      inventoriesMatch(profileBefore, profileAfter),
    profileFileCountBefore: profileBefore?.filter((entry) => entry.kind === 'file').length ?? null,
    profileFileCountAfter: profileAfter?.filter((entry) => entry.kind === 'file').length ?? null,
    processTreeAbsent: terminal?.processTreeAbsent === true,
    ...(context ? { buildRevision: context.request.buildRevision, artifactDescriptorSha256: context.request.artifactDescriptorSha256,
      sourcePackageSha256: context.artifact.source.packageSha256, targetPackageSha256: context.artifact.target.packageSha256 } : {}),
  };
  if (result.status !== 'completed') throw new WorkspaceSuccessCommandFailure(result);
  return Object.freeze(result);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await runWorkspaceSuccess(process.argv.slice(2)))); }
  catch (error) {
    console.error(JSON.stringify(workspaceSuccessCommandFailureDetails(error) ?? {
      schemaVersion: 1, scenario: 'packagedWorkspaceSuccess', status: 'failed', errorCode: workspaceCommandErrorCode(error),
    }));
    process.exitCode = 1;
  }
}
