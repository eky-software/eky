import { spawn } from 'node:child_process';
import { lstat, mkdir, mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  LEGACY_UPGRADE_SCENARIO,
  createLegacyUpgradeWorkerRequest,
  legacyUpgradeResultPathForRequest,
  readLegacyUpgradeResult,
  writeJsonAtomicExclusive,
} from './legacyUpgradeContracts.mjs';
import {
  LegacyUpgradeCommandFailure,
  LEGACY_COMMAND_ERROR_CODES,
  legacyUpgradeFailureDetails,
  resolveLegacyUpgradeTerminalOutcome,
} from './legacyUpgradeFailureBoundary.mjs';
import { createLegacyUpgradeFilesystemRuntime } from './legacyUpgradeFilesystemRuntime.mjs';
import { LEGACY_SUPERVISOR_TIMEOUT_MS, LEGACY_SUPERVISOR_CLEANUP_MS,
  LEGACY_PHASE_WRITER_TIMEOUT_MS, LEGACY_PHASE_WRITER_TERMINATION_MS } from './legacyUpgradeBudget.mjs';
import { LEGACY_UPGRADE_DESCRIPTOR_FILENAME } from './legacyUpgradeArtifact.mjs';
import { createUpgradeRollbackPostSupervisorWindowsRuntime } from './upgradeRollbackPostSupervisorWindowsRuntime.mjs';
import { areProductProcessesAbsent } from './installerProductOperationRuntime.mjs';
import {
  inventoriesMatch,
} from './closedDirectoryInventory.mjs';
import { parseAbsoluteWindowsAcceptancePath } from './windowsAcceptancePathArgument.mjs';
import { readWindowsAcceptanceSupervisorResult } from '../windows-process-supervisor/windowsAcceptanceSupervisorResult.mjs';
import { runCallerResultCli } from './callerResultCli.mjs';
import { parseLegacyCallerArguments, validateLegacyCallerResult } from './legacyCallerResult.mjs';
import { runLegacyCallerResultProcess } from './legacyCallerResultProcess.mjs';
import { createWorkspacePhaseWriter } from './workspacePhaseWriter.mjs';

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const SUPERVISOR_DLL = resolve(
  DIRECTORY,
  '..',
  'bin',
  'windows-process-supervisor',
  'Release',
  'net10.0',
  'Eky.WindowsProcessSupervisor.dll',
);
const WORKER_PATH = resolve(DIRECTORY, 'runLegacyUpgradeWorker.mjs');
const DOTNET_EXECUTABLE = process.env.EKY_DOTNET_EXE || 'dotnet';

async function requireStandaloneRegularFile(path, errorCode) {
  try {
    const metadata = await lstat(path, { bigint: true });
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.nlink !== 1n ||
      metadata.size < 1n
    ) {
      throw new Error(errorCode);
    }
  } catch {
    throw new Error(errorCode);
  }
}

export function parseLegacyUpgradeArguments(arguments_) {
  if (
    arguments_.length !== 2 ||
    arguments_[0] !== '--artifact-descriptor'
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARGUMENTS_INVALID');
  }
  const descriptorPath = parseAbsoluteWindowsAcceptancePath(
    arguments_[1],
    'WINDOWS_ACCEPTANCE_LEGACY_ARGUMENTS_INVALID',
  );
  if (
    descriptorPath !==
    resolve(dirname(descriptorPath), LEGACY_UPGRADE_DESCRIPTOR_FILENAME)
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARGUMENTS_INVALID');
  }
  return Object.freeze({ descriptorPath });
}

export function startLegacyUpgradeSupervisor(requestPath, scenarioRoot, observe = () => {}, { spawnProcess = spawn } = {}) {
  const child = spawnProcess(
    DOTNET_EXECUTABLE,
    [SUPERVISOR_DLL, '--request', requestPath],
    {
      cwd: scenarioRoot,
      stdio: 'inherit',
      windowsHide: true,
    },
  );
  let started = false, failed = false;
  const notify = (phase, status) => { try { observe(phase, status); } catch { /* Observation is not control. */ } };
  const completion = new Promise((resolvePromise, rejectPromise) => {
    child.once('spawn', () => { started = true; });
    child.once('exit', (code) => notify('supervisorExit', code === 0 ? 'completed' : 'failed'));
    child.on('error', () => { failed = true; });
    child.once('close', (exitCode, signal) => {
      notify('supervisorClose', !failed && signal === null && exitCode === 0 ? 'completed' : 'failed');
      if (failed || signal !== null || !Number.isInteger(exitCode)) {
        rejectPromise(new Error(failed && !started ? 'WINDOWS_ACCEPTANCE_SUPERVISOR_START_FAILED'
          : 'WINDOWS_ACCEPTANCE_SUPERVISOR_EXIT_INVALID'));
        return;
      }
      resolvePromise(exitCode);
    });
  });
  return Object.freeze({ child, completion });
}

function safeErrorCode(error) {
  return LEGACY_COMMAND_ERROR_CODES.includes(error?.message)
    ? error.message
    : 'WINDOWS_ACCEPTANCE_LEGACY_UNEXPECTED_FAILURE';
}

export function requireLegacyUpgradeProductPrecondition(result) {
  if (
    result?.status !== 'completed' ||
    result.resultCode !== 'exactProductsAbsent' ||
    result.sourcePresent !== false ||
    result.targetPresent !== false ||
    result.installerRegistryPresent !== false
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_PRECONDITION_FAILED');
  }
}

export async function resolveLegacyUpgradeTemporaryRoot(
  temporaryRoot = tmpdir(),
) {
  try {
    const canonicalRoot = await realpath(resolve(temporaryRoot));
    const metadata = await lstat(canonicalRoot);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error('WINDOWS_ACCEPTANCE_LEGACY_TEMP_ROOT_INVALID');
    }
    return canonicalRoot;
  } catch {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_TEMP_ROOT_INVALID');
  }
}

function asProductRuntimeArtifact(artifact) {
  return Object.freeze({
    roles: Object.freeze({ source: artifact.source, target: artifact.target }),
  });
}

export async function runLegacyUpgrade(arguments_, {
  filesystem = createLegacyUpgradeFilesystemRuntime(),
  materializeFixture = filesystem.materializeFixture,
  inventoryProfile = filesystem.inventoryProfile,
  createProductRuntime = createUpgradeRollbackPostSupervisorWindowsRuntime,
  launchSupervisor = startLegacyUpgradeSupervisor,
  readSupervisorResult = readWindowsAcceptanceSupervisorResult,
  readScenarioResult = readLegacyUpgradeResult,
  verifySemanticPostcondition = filesystem.verifySemanticPostcondition,
  verifyArtifact = filesystem.verifyArtifact,
  removeRunRoot = filesystem.removeRunRoot,
  expectedArtifact,
  createPhaseWriter = createWorkspacePhaseWriter,
} = {}) {
  if (process.platform !== 'win32') {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_WINDOWS_REQUIRED');
  }
  const { descriptorPath } = parseLegacyUpgradeArguments(arguments_);
  const appData = process.env.APPDATA;
  if (!appData) {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ENVIRONMENT_INVALID');
  }
  await requireStandaloneRegularFile(
    SUPERVISOR_DLL,
    'WINDOWS_ACCEPTANCE_SUPERVISOR_BINARY_INVALID',
  );

  const temporaryRoot = await resolveLegacyUpgradeTemporaryRoot();
  const runRoot = await mkdtemp(
    join(temporaryRoot, 'eky-windows-acceptance-v2-legacy-'),
  );
  const profileRoot = resolve(appData, 'Eky');
  let activeSupervisor = null;
  let artifact = null;
  let productRuntime = null;
  let primaryError = null;
  let profileBefore = null;
  let profileAfter = null;
  let safetyError = null;
  let supervisorResult = null;
  let terminal = null;
  let supervisorAttempted = false;
  let fixtureRemoved = false;
  let fixtureCleanupResultCode = 'retainedUnverified';
  let phaseWriter = null;
  let writerAttempted = false;
  let writerStopped = false;
  let writerOutcome = { writerResultCode: 'notStarted', diagnosticResultCode: 'notSent' };
  const begun = performance.now();
  const phaseStarts = new Map();
  const observe = (phase, status) => {
    if (writerStopped) return;
    try {
      if (!writerAttempted) {
        writerAttempted = true;
        writerOutcome = { writerResultCode: 'writerExitUnverified', diagnosticResultCode: 'channelFailed' };
        phaseWriter = createPhaseWriter({ timeoutMilliseconds: LEGACY_PHASE_WRITER_TIMEOUT_MS,
          terminationTimeoutMilliseconds: LEGACY_PHASE_WRITER_TERMINATION_MS });
      }
      const now = performance.now();
      if (status === 'started') phaseStarts.set(phase, now);
      phaseWriter?.send({ schemaVersion: 1, operation: 'legacyAcceptanceCaller', scenario: LEGACY_UPGRADE_SCENARIO,
        phase, status, durationMs: Math.max(0, Math.floor(now - (phaseStarts.get(phase) ?? now))),
        elapsedMs: Math.floor(now - begun) });
    } catch { /* Optional observations cannot replace the required result. */ }
  };
  const observed = async (phase, task) => {
    observe(phase, 'started');
    try {
      const value = await task();
      observe(phase, value?.status === 'failed' ? 'failed' : 'completed');
      return value;
    } catch (error) { observe(phase, 'failed'); throw error; }
  };
  const stopActiveSupervisor = () => {
    if (
      activeSupervisor?.child.exitCode === null &&
      activeSupervisor.child.signalCode === null
    ) {
      activeSupervisor.child.kill();
    }
  };
  process.once('SIGINT', stopActiveSupervisor);
  process.once('SIGTERM', stopActiveSupervisor);
  try {
    profileBefore = await inventoryProfile(profileRoot);
    artifact = await materializeFixture(
      descriptorPath,
      resolve(runRoot, 'fixture'),
    );
    if (expectedArtifact && (artifact.descriptorSha256 !== expectedArtifact.artifactDescriptorSha256 ||
      artifact.buildRevision !== expectedArtifact.buildRevision)) {
      throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_VERIFICATION_FAILED');
    }
    const scenarioRoot = resolve(runRoot, 'scenario');
    await mkdir(scenarioRoot, { recursive: false });
    productRuntime = createProductRuntime({
      artifact: asProductRuntimeArtifact(artifact),
      scenarioRoot,
    });
    const productPrecondition = await productRuntime.verifyExactProductStates();
    requireLegacyUpgradeProductPrecondition(productPrecondition);
    if (!areProductProcessesAbsent(productRuntime)) throw new Error('WINDOWS_ACCEPTANCE_LEGACY_PRODUCT_PROCESS_UNVERIFIED');
    const workerRequestPath = resolve(scenarioRoot, 'worker-request.json');
    const supervisorRequestPath = resolve(scenarioRoot, 'request.json');
    const workerRequest = createLegacyUpgradeWorkerRequest({
      artifactDescriptorSha256: artifact.descriptorSha256,
      fixtureRoot: artifact.artifactRoot,
    });
    await writeJsonAtomicExclusive(workerRequestPath, workerRequest);
    await writeJsonAtomicExclusive(supervisorRequestPath, {
      schemaVersion: 1,
      runNonce: workerRequest.runNonce,
      scenario: LEGACY_UPGRADE_SCENARIO,
      artifactDescriptorSha256: artifact.descriptorSha256,
      command: process.execPath,
      arguments: [WORKER_PATH, '--request', workerRequestPath],
      workingDirectory: scenarioRoot,
      timeoutMilliseconds: LEGACY_SUPERVISOR_TIMEOUT_MS,
      cleanupReserveMilliseconds: LEGACY_SUPERVISOR_CLEANUP_MS,
    });

    supervisorAttempted = true;
    activeSupervisor = launchSupervisor(supervisorRequestPath, scenarioRoot, observe);
    const supervisorExitCode = await activeSupervisor.completion;
    activeSupervisor = null;
    supervisorResult = await observed('supervisorResult', () => readSupervisorResult(
      resolve(scenarioRoot, 'result.json'),
      {
        artifactDescriptorSha256: artifact.descriptorSha256,
        runNonce: workerRequest.runNonce,
        scenario: LEGACY_UPGRADE_SCENARIO,
        supervisorExitCode,
      },
    ));
    let inspections = 0;
    terminal = await resolveLegacyUpgradeTerminalOutcome({
      ...productRuntime,
      verifyExactProductStates: () => observed(inspections++ === 0 ? 'initialProductState' : 'finalProductState',
        productRuntime.verifyExactProductStates),
      cleanupExactProducts: () => observed('installationCleanup', productRuntime.cleanupExactProducts),
      productPrecondition,
      supervisorResult,
      readScenarioResult: () =>
        observed('scenarioResult', () => readScenarioResult(
          legacyUpgradeResultPathForRequest(workerRequestPath),
          workerRequest,
        )),
      verifySemanticPostcondition: () =>
        observed('semanticPostcondition', () => verifySemanticPostcondition({
          artifact,
          runNonce: workerRequest.runNonce,
          runtimeRoot: dirname(artifact.artifactRoot),
        })),
    });
  } catch (error) {
    primaryError = error;
  } finally {
    process.off('SIGINT', stopActiveSupervisor);
    process.off('SIGTERM', stopActiveSupervisor);
    if (
      activeSupervisor?.child.exitCode === null &&
      activeSupervisor.child.signalCode === null
    ) {
      activeSupervisor.child.kill();
      await activeSupervisor.completion.catch(() => undefined);
    }
    if (!areProductProcessesAbsent(productRuntime)) safetyError ??= new Error('WINDOWS_ACCEPTANCE_LEGACY_PRODUCT_PROCESS_UNVERIFIED');
    if (artifact !== null && areProductProcessesAbsent(productRuntime)) {
      try {
        await observed('artifactVerification', () => verifyArtifact(artifact));
      } catch {
        safetyError ??= new Error(
          filesystem.outcome().filesystemErrorCode ?? 'WINDOWS_ACCEPTANCE_LEGACY_LOCAL_FIXTURE_CHANGED',
        );
      }
    }
    if (profileBefore !== null && areProductProcessesAbsent(productRuntime)) {
      try {
        await observed('normalProfileVerification', async () => {
          profileAfter = await inventoryProfile(profileRoot);
          if (!inventoriesMatch(profileBefore, profileAfter)) throw new Error('WINDOWS_ACCEPTANCE_NORMAL_PROFILE_CHANGED');
        });
      } catch {
        safetyError ??= new Error(filesystem.outcome().filesystemErrorCode ?? 'WINDOWS_ACCEPTANCE_NORMAL_PROFILE_CHANGED');
      }
    }
    if (filesystem.outcome().filesystemErrorCode !== null) {
      safetyError ??= new Error(filesystem.outcome().filesystemErrorCode);
    }
    observe('fixtureCleanup', 'started');
    writerStopped = true;
    if (phaseWriter) {
      try { writerOutcome = await phaseWriter.finish(); }
      catch { writerOutcome = { writerResultCode: 'writerExitUnverified', diagnosticResultCode: 'channelFailed' }; }
    }
    if (writerAttempted && writerOutcome.writerResultCode !== 'writerAbsent') {
      safetyError ??= new Error('WINDOWS_ACCEPTANCE_LEGACY_PHASE_WRITER_EXIT_UNVERIFIED');
    }
    const failure = legacyUpgradeFailureDetails(primaryError);
    const cleanupVerified = terminal !== null || (
      ['notRequired', 'semanticCleanupCompleted'].includes(failure?.semanticCleanupResultCode) &&
      ['exactProductsAbsent', 'exactProductsAbsentAfterCleanup'].includes(failure?.postconditionResultCode)
    );
    if (safetyError === null && (!supervisorAttempted || (
      supervisorResult?.processTreeAbsent === true && cleanupVerified
    ))) {
      try {
        await removeRunRoot(runRoot);
        await lstat(runRoot).then(
          () => {
            throw new Error('WINDOWS_ACCEPTANCE_LEGACY_FIXTURE_CLEANUP_FAILED');
          },
          (error) => {
            if (error?.code !== 'ENOENT') throw error;
          },
        );
        fixtureRemoved = true;
        fixtureCleanupResultCode = 'fixtureRemoved';
      } catch {
        fixtureCleanupResultCode = 'fixtureCleanupFailed';
        primaryError ??= new Error(
          'WINDOWS_ACCEPTANCE_LEGACY_FIXTURE_CLEANUP_FAILED',
        );
      }
    }
  }

  if (primaryError || safetyError) {
    throw new LegacyUpgradeCommandFailure({
      schemaVersion: 1,
      scenario: LEGACY_UPGRADE_SCENARIO,
      status: 'failed',
      errorCode: safeErrorCode(primaryError ?? safetyError),
      processTreeAbsent: supervisorResult?.processTreeAbsent === true,
      ...legacyUpgradeFailureDetails(primaryError),
      safetyErrorCode: safetyError === null ? null : safeErrorCode(safetyError),
      fixtureCleanupResultCode,
      fixtureRemoved,
      productProcessAbsent: areProductProcessesAbsent(productRuntime),
      phaseWriterResultCode: writerOutcome.writerResultCode,
      phaseDiagnosticResultCode: writerOutcome.diagnosticResultCode,
      ...filesystem.outcome(),
    });
  }
  return Object.freeze({
    schemaVersion: 1,
    scenario: LEGACY_UPGRADE_SCENARIO,
    status: 'completed',
    resultCode: 'historicalLegacyUpgradeCompleted',
    sourceClassification: artifact.source.artifactClass,
    sourceVersion: artifact.source.appVersion,
    targetVersion: artifact.target.appVersion,
    sourcePackageSha256: artifact.source.packageSha256,
    targetPackageSha256: artifact.target.packageSha256,
    legacyBusinessFixtureValidated:
      terminal.semanticProof.businessDataPreserved,
    adoptedWorkspaceCount: terminal.semanticProof.adoptedWorkspaceCount,
    idempotentSecondStartup: terminal.semanticProof.idempotentSecondStartup,
    businessDataPreserved: true,
    profileFileCountBefore: profileBefore.filter((entry) => entry.kind === 'file')
      .length,
    profileFileCountAfter: profileAfter.filter((entry) => entry.kind === 'file')
      .length,
    processTreeAbsent: supervisorResult.processTreeAbsent,
    productProcessAbsent: areProductProcessesAbsent(productRuntime),
    supervisorProcessResultCode: supervisorResult.processResultCode,
    supervisorWorkerResultCode: supervisorResult.workerResultCode,
    supervisorCleanupResultCode: supervisorResult.cleanupResultCode,
    scenarioResultCode: terminal.scenarioResult.resultCode,
    semanticProofResultCode: terminal.semanticProof.resultCode,
    semanticCleanupResultCode: 'semanticCleanupCompleted',
    postconditionResultCode: 'exactProductsAbsent',
    fixtureCleanupResultCode,
    fixtureRemoved,
    phaseWriterResultCode: writerOutcome.writerResultCode,
    phaseDiagnosticResultCode: writerOutcome.diagnosticResultCode,
    ...filesystem.outcome(),
  });
}

export function runLegacyUpgradeCli(args, { runScenario = (input, expectedArtifact) => runLegacyUpgrade(input, { expectedArtifact }),
  resultProcess = runLegacyCallerResultProcess } = {}) {
  return runCallerResultCli(args, { runScenario, resultProcess,
    parseArguments: (input) => parseLegacyCallerArguments(input, parseLegacyUpgradeArguments),
    validateResult: validateLegacyCallerResult, failureDetails: legacyUpgradeFailureDetails, errorCode: safeErrorCode });
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = await runLegacyUpgradeCli(process.argv.slice(2));
}
