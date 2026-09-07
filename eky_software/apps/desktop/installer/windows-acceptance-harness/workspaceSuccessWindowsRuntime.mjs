import { spawn } from 'node:child_process';
import { lstat, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as pollNextObservation } from 'node:timers/promises';

import { inspectPackageArtifactInventory } from '../../scripts/package-artifact-inventory.mjs';
import {
  verifyW6b2PackagedSuccessRunFixture, writeW6b2PackagedSuccessPhase,
} from '../scripts/w6b2PackagedSuccessRunFixture.mjs';
import { validateInstallerProductStateResult } from './cleanInstallUninstallWindowsRuntime.mjs';
import { inspectLegacyInstallerFootprint } from './legacyUpgradeWindowsRuntime.mjs';
import { verifyWorkspaceSuccessArtifact } from './workspaceSuccessArtifact.mjs';
import { hasWorkspaceSuccessExactKeys, readWorkspaceSuccessObject } from './workspaceSuccessContracts.mjs';

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

export async function createWorkspaceSuccessWindowsRuntime({
  request, artifact, runFixture, temporaryRoot, scenarioRoot, profileRuntime,
  proofProtocol, profileProtocol, captureCheckpoint,
}, {
  environment = process.env,
  runCommand = runWorkspaceSuccessOwnedCommand,
  readObject = readWorkspaceSuccessObject,
  inspectPayload = inspectPackageArtifactInventory,
  inspectFootprint = inspectLegacyInstallerFootprint,
  verifyArtifact = verifyWorkspaceSuccessArtifact,
  verifyRunFixture = verifyW6b2PackagedSuccessRunFixture,
  writePhase = writeW6b2PackagedSuccessPhase,
  removePreviousResult = removeWorkspaceSuccessPreviousResult,
  nextObservation = () => pollNextObservation(250),
} = {}) {
  if (!environment.APPDATA || !environment.LOCALAPPDATA || !environment.SystemRoot ||
    typeof captureCheckpoint !== 'function') throw new Error('requestInvalid');
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
    const result = profileProtocol.parseW6b2PackagedProfileCommandResult(
      await readObject(resultPath, 'profileResultInvalid'));
    if (code !== 0 || result.operation !== operation || result.status !== 'completed') {
      throw new Error('profileResultInvalid');
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
    prepareProfile: () => runProfile('prepare'),
    captureCheckpoint,
    async runProofPhase(phase) {
      await writePhase(runFixture.proofRoot, phase);
      const bootstrap = proofProtocol.createW6b2PackagedProofBootstrapConfiguration({
        hasProofSwitch: true, tempPath: temporaryRoot, tokenValue: request.runNonce,
      });
      if (bootstrap.root !== runFixture.proofRoot) throw new Error('proofResultInvalid');
      const resultPath = resolve(bootstrap.root, 'result', 'w6b2-proof-result.json');
      await removePreviousResult(resultPath);
      const code = await runCommand(executablePath, [
        `--${proofProtocol.W6B2_PACKAGED_PROOF_SWITCH}`, `--user-data-dir=${bootstrap.userDataPath}`,
      ], { cwd: scenarioRoot, env: applicationEnvironment });
      const result = proofProtocol.parseW6b2PackagedProofResult(await readObject(resultPath, 'proofResultInvalid'));
      if (code !== 0 || result.phase !== phase || result.status === 'failed') throw new Error('proofResultInvalid');
      return result;
    },
    async waitForTargetInstallation() {
      // Observation is not installer ownership. The one Job deadline bounds both
      // these OS queries and the application's existing installer handoff.
      while (true) {
        const state = await inspectProducts();
        const idle = await requireMsiIdle();
        if (idle) {
          if (state.source.productState >= 1 || state.target.productState < 1 || state.ekyProcessCount !== 0) {
            throw new Error('targetInstallFailed');
          }
          return;
        }
        await nextObservation();
      }
    },
  });
}
