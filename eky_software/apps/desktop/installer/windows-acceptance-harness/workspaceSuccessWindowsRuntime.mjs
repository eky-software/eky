import { spawn } from 'node:child_process';
import { lstat, mkdir, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as pollNextObservation } from 'node:timers/promises';

import { inspectPackageArtifactInventory } from '../../scripts/package-artifact-inventory.mjs';
import {
  verifyW6b2PackagedSuccessRunFixture, writeW6b2PackagedSuccessPhase,
} from '../scripts/w6b2PackagedSuccessRunFixture.mjs';
import { writeW6b2PackagedFaultPhase } from '../scripts/w6b2PackagedFaultRunFixture.mjs';
import { validateInstallerProductStateResult } from './cleanInstallUninstallWindowsRuntime.mjs';
import { inspectLegacyInstallerFootprint } from './legacyUpgradeWindowsRuntime.mjs';
import { verifyWorkspaceSuccessArtifact } from './workspaceSuccessArtifact.mjs';
import {
  WORKSPACE_SUCCESS_PROFILE_ERRORS, WORKSPACE_SUCCESS_PROOF_ERRORS, hasWorkspaceSuccessExactKeys,
  readWorkspaceSuccessObject, writeJsonAtomicExclusive,
} from './workspaceSuccessContracts.mjs';
import { WORKSPACE_FAULT_ERRORS, WORKSPACE_FAULT_SCENARIO, workspaceFaultPlan } from './workspaceFaultContracts.mjs';

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PRODUCT_INSPECTOR = resolve(DIRECTORY, 'inspectWindowsInstallerProductState.ps1');
const MSI_ACTIVITY_INSPECTOR = resolve(DIRECTORY, 'inspectWorkspaceSuccessMsiActivity.ps1');

// The existing supervisor's Job owns every descendant. This adapter only awaits
// a directly launched command; it has no timeout, kill or process-tree registry.
export function runWorkspaceSuccessOwnedCommand(command, arguments_, options, spawnProcess = spawn) {
  return new Promise((resolvePromise, rejectPromise) => {
    let child;
    try {
      child = spawnProcess(command, arguments_, {
        cwd: options.cwd, env: options.env, windowsHide: true, stdio: 'ignore', shell: false,
      });
    } catch { rejectPromise(new Error('ownedProcessStartFailed')); return; }
    child.once('error', () => rejectPromise(new Error('ownedProcessStartFailed')));
    child.once('close', (code, signal) => {
      if (signal !== null || !Number.isInteger(code)) {
        rejectPromise(new Error('ownedProcessExitInvalid'));
      } else resolvePromise(code);
    });
  });
}

export function workspaceSuccessApplicationEnvironment(environment, { temporaryRoot, token }) {
  const result = { ...environment };
  for (const name of Object.keys(result)) {
    if (/^(?:ELECTRON_RUN_AS_NODE|EKY_.*|TEMP|TMP)$/i.test(name)) delete result[name];
  }
  return { ...result, TEMP: temporaryRoot, TMP: temporaryRoot, EKY_W6B2_PROOF_TOKEN: token };
}

export async function removeWorkspaceSuccessPreviousResult(path) {
  try { await lstat(path); }
  catch (error) { if (error?.code === 'ENOENT') return; throw new Error('proofResultInvalid'); }
  await readWorkspaceSuccessObject(path, 'proofResultInvalid');
  await rm(path);
}

export function createWorkspaceSuccessWindowsRuntime(input, dependencies) {
  if (Object.hasOwn(input.request, 'faultScenario')) throw new Error('requestInvalid');
  return createWorkspaceWindowsRuntime(input, dependencies);
}

export function createWorkspaceFaultWindowsRuntime(input, dependencies) {
  if (input.request.scenario !== WORKSPACE_FAULT_SCENARIO) throw new Error('requestInvalid');
  workspaceFaultPlan(input.request.faultScenario);
  return createWorkspaceWindowsRuntime(input, dependencies, input.request.faultScenario);
}

async function createWorkspaceWindowsRuntime({
  request, artifact, runFixture, temporaryRoot, scenarioRoot, profileRuntime,
  proofProtocol, profileProtocol, captureCheckpoint, sessionProof,
}, {
  environment = process.env,
  runCommand = runWorkspaceSuccessOwnedCommand,
  readObject = readWorkspaceSuccessObject,
  inspectPayload = inspectPackageArtifactInventory,
  inspectFootprint = inspectLegacyInstallerFootprint,
  verifyArtifact = verifyWorkspaceSuccessArtifact,
  verifyRunFixture = verifyW6b2PackagedSuccessRunFixture,
  writePhase = writeW6b2PackagedSuccessPhase,
  writeFaultPhase = writeW6b2PackagedFaultPhase,
  removePreviousResult = removeWorkspaceSuccessPreviousResult,
  nextObservation = () => pollNextObservation(250),
} = {}, faultScenario) {
  if (!environment.APPDATA || !environment.LOCALAPPDATA || !environment.SystemRoot ||
    typeof captureCheckpoint !== 'function' || typeof sessionProof?.start !== 'function') throw new Error('requestInvalid');
  const installRoot = resolve(environment.LOCALAPPDATA, 'Programs', 'Eky');
  const executablePath = resolve(installRoot, 'Eky.exe');
  const shortcutPath = resolve(environment.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Eky', 'Eky.lnk');
  const powershell = resolve(environment.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const msiexec = resolve(environment.SystemRoot, 'System32', 'msiexec.exe');
  const commandOptions = { cwd: scenarioRoot, env: { ...environment } };
  const applicationEnvironment = workspaceSuccessApplicationEnvironment(environment, {
    temporaryRoot, token: request.runNonce,
  });
  const logRoot = resolve(scenarioRoot, 'msi-logs');
  await mkdir(logRoot, { recursive: false });
  let inspectionSequence = 0;
  const sessionPhases = faultScenario === undefined ? undefined
    : proofProtocol.getW6b2PackagedFaultSessionPhases(faultScenario);

  async function inspectResult(script, arguments_, code) {
    const resultPath = resolve(scenarioRoot, `workspace-inspection-${inspectionSequence++}.json`);
    try {
      const exitCode = await runCommand(powershell, [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
        ...arguments_, '-ResultPath', resultPath,
      ], commandOptions);
      if (exitCode !== 0) throw new Error(code);
      return await readObject(resultPath, code, 64 * 1024);
    } finally { await rm(resultPath, { force: true }); }
  }

  async function inspectProducts() {
    const source = validateInstallerProductStateResult(await inspectResult(PRODUCT_INSPECTOR,
      ['-ProductCode', `{${artifact.source.productCode}}`], 'productInspectionFailed'));
    const target = validateInstallerProductStateResult(await inspectResult(PRODUCT_INSPECTOR,
      ['-ProductCode', `{${artifact.target.productCode}}`], 'productInspectionFailed'));
    if (source.ekyProcessCount !== target.ekyProcessCount ||
      source.ownedRegistryExists !== target.ownedRegistryExists) throw new Error('productInspectionFailed');
    return { source, target, ekyProcessCount: source.ekyProcessCount,
      installerRegistryExists: source.ownedRegistryExists };
  }

  async function requireMsiIdle() {
    const value = await inspectResult(MSI_ACTIVITY_INSPECTOR, [], 'productInspectionFailed');
    if (!hasWorkspaceSuccessExactKeys(value, ['schemaVersion', 'msiClientCount']) ||
      value.schemaVersion !== 1 || !Number.isSafeInteger(value.msiClientCount) || value.msiClientCount < 0) {
      throw new Error('productInspectionFailed');
    }
    return value.msiClientCount === 0;
  }

  async function verifyBytes() {
    await verifyArtifact({ artifactRoot: request.fixtureRoot, expectedBuildRevision: request.buildRevision,
      expectedDescriptorSha256: request.artifactDescriptorSha256 });
    await verifyRunFixture({ ...runFixture, temporaryRoot });
  }

  async function runProfile(operation) {
    const resultPath = resolve(runFixture.proofRoot, 'result', profileProtocol.W6B2_PACKAGED_PROFILE_RESULT_FILE);
    await removePreviousResult(resultPath);
    const code = await runCommand(profileRuntime.executablePath, [profileRuntime.applicationPath], {
      cwd: scenarioRoot, env: { ...applicationEnvironment,
        [profileProtocol.W6B2_PACKAGED_PROFILE_OPERATION_ENV]: operation },
    });
    const value = await readObject(resultPath, 'profileResultUnreadable');
    let result;
    try { result = profileProtocol.parseW6b2PackagedProfileCommandResult(value); }
    catch { throw new Error('profileResultInvalid'); }
    if (result.operation !== operation ||
      (code === 0) !== (result.status === 'completed')) {
      throw new Error('profileResultInvalid');
    }
    if (result.status === 'failed') {
      const errorCode = Object.hasOwn(WORKSPACE_SUCCESS_PROFILE_ERRORS, result.failureStage)
        ? WORKSPACE_SUCCESS_PROFILE_ERRORS[result.failureStage] : 'profileResultInvalid';
      throw new Error(errorCode);
    }
  }

  return Object.freeze({
    versions: { source: artifact.source.msiProductVersion, target: artifact.target.msiProductVersion },
    async inspectState() {
      const state = await inspectProducts();
      if (!await requireMsiIdle()) throw new Error('productInspectionFailed');
      return { ...state, ...await inspectFootprint({ installRoot, executablePath, shortcutPath }) };
    },
    verifyArtifact: verifyBytes,
    installSource: () => runCommand(msiexec,
      ['/i', artifact.source.installerPath, '/qn', '/norestart', '/L*v', resolve(logRoot, 'source.log')],
      commandOptions),
    async validatePayload(role) {
      const inventory = await inspectPayload({ root: installRoot, stage: 'packagedApp' });
      const expected = artifact[role].payloadInventory;
      if (['stage', 'identity', 'fileCount', 'totalByteSize'].some((key) => inventory[key] !== expected[key])) {
        throw new Error(role === 'source' ? 'sourceStateInvalid' : 'targetStateInvalid');
      }
    },
    async prepareProfile() {
      // The existing preparation entrypoint requires the source success control.
      // Fault control begins only when the first application proof is launched.
      if (faultScenario !== undefined) await writePhase(runFixture.proofRoot, 'sourceHandoff');
      await runProfile('prepare');
    },
    captureCheckpoint,
    async runProofPhase(phase) {
      if (faultScenario === undefined) await writePhase(runFixture.proofRoot, phase);
      else await writeFaultPhase({ proofRoot: runFixture.proofRoot, faultScenario, phase });
      const bootstrap = proofProtocol.createW6b2PackagedProofBootstrapConfiguration({
        hasProofSwitch: true, tempPath: temporaryRoot, tokenValue: request.runNonce,
      });
      if (bootstrap.root !== runFixture.proofRoot) throw new Error('proofResultInvalid');
      const resultPath = resolve(bootstrap.root, 'result', 'w6b2-proof-result.json');
      await removePreviousResult(resultPath);
      const probe = sessionPhases === undefined || sessionPhases.includes(phase)
        ? await sessionProof.start(phase) : undefined;
      let result;
      let originalError;
      try {
        if (probe !== undefined) {
          const controlPath = resolve(bootstrap.root, 'control', 'phase.json');
          const nextPath = resolve(bootstrap.root, 'control', 'session-phase.next.json');
          await writeJsonAtomicExclusive(nextPath, {
            ...(faultScenario === undefined ? { formatVersion: 1 } : { formatVersion: 2, faultScenario }),
            phase, sessionProbeNonce: probe.nonce,
          });
          await rename(nextPath, controlPath);
        }
        const code = await runCommand(executablePath, [
          `--${proofProtocol.W6B2_PACKAGED_PROOF_SWITCH}`, `--user-data-dir=${bootstrap.userDataPath}`,
        ], { cwd: scenarioRoot, env: applicationEnvironment });
        const value = await readObject(resultPath, 'proofResultUnreadable');
        try { result = proofProtocol.parseW6b2PackagedProofResult(value); }
        catch { throw new Error('proofResultInvalid'); }
        if (result.phase !== phase || (faultScenario === undefined ? result.formatVersion !== 1
          : result.formatVersion !== 2 || result.faultScenario !== faultScenario)) throw new Error('proofResultInvalid');
        if (result.status === 'failed') {
          const errors = faultScenario === undefined ? WORKSPACE_SUCCESS_PROOF_ERRORS : WORKSPACE_FAULT_ERRORS;
          throw new Error(errors.includes(result.errorCode)
            ? result.errorCode : 'proofResultInvalid');
        }
        if (code !== 0) throw new Error('proofResultInvalid');
      } catch (error) { originalError = error; }
      try { await probe?.finish({ allowMissing: faultScenario === undefined &&
        phase === 'verifyBRestart' && result?.status === 'relaunching' }); }
      catch (error) { originalError ??= error; }
      if (originalError) throw originalError;
      return result;
    },
    ...(faultScenario === undefined ? { waitForTargetInstallation: () => waitForInstallation('target') }
      : { waitForInstallation }),
  });

  async function waitForInstallation(role) {
    if (role !== 'source' && role !== 'target') throw new Error('requestInvalid');
    // Observation is not installer ownership. The one Job deadline bounds both
    // these OS queries and the application's existing installer handoff.
    while (true) {
      const state = await inspectProducts();
      const idle = await requireMsiIdle();
      if (idle) {
        const other = role === 'source' ? 'target' : 'source';
        if (state[other].productState >= 1 || state[role].productState < 1 || state.ekyProcessCount !== 0) {
          throw new Error(role === 'source' ? 'sourceRollbackInstallFailed' : 'targetInstallFailed');
        }
        return;
      }
      await nextObservation();
    }
  }
}
