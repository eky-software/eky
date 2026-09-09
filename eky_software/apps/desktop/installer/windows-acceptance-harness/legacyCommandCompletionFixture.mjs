import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runLegacyUpgrade, runLegacyUpgradeCli, startLegacyUpgradeSupervisor } from './runLegacyUpgrade.mjs';
import { legacyUpgradeFailureDetails } from './legacyUpgradeFailureBoundary.mjs';
import { readWindowsAcceptanceSupervisorResult } from '../windows-process-supervisor/windowsAcceptanceSupervisorResult.mjs';
import { createLegacyUpgradeFilesystemRuntime } from './legacyUpgradeFilesystemRuntime.mjs';
import { runBoundedWindowsAdapterProcess } from './boundedWindowsAdapterProcess.mjs';

// Only the existing contract Job contains this command. The inner production
// supervisor still owns the scenario; no test code scans or kills its tree.
const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert(['hold', 'unread', 'cleanupUnverified', 'missingSupervisor', 'cleanupFailed', 'writerUnverified', 'filesystemHold'].includes(input.mode));
const events = [];
let supervisorResult;
const persist = async (outcome) => writeFile(input.reportPath, JSON.stringify({ events, supervisorResult, outcome }));
const absent = { status: 'completed', resultCode: 'exactProductsAbsent', sourcePresent: false,
  targetPresent: false, installerRegistryPresent: false };
let root;
let inspections = 0;
const ports = {
  inventoryProfile: async () => [],
  materializeFixture: async (_, destination) => {
    root = dirname(destination);
    await writeFile(input.rootPath, root);
    await mkdir(destination);
    return { descriptorSha256: input.artifactDescriptorSha256, artifactRoot: destination,
      source: { artifactClass: 'historical-source-rebuild', appVersion: '0.2.6' },
      target: { appVersion: '0.2.7' } };
  },
  verifyArtifact: async () => undefined,
  createProductRuntime: () => ({ verifyExactProductStates: async () => input.mode === 'cleanupFailed' && inspections++ > 0
    ? { ...absent, resultCode: 'targetProductPresent', targetPresent: true, installerRegistryPresent: true } : absent,
    cleanupExactProducts: async () => { throw new Error('SYNTHETIC_CLEANUP_FAILURE'); } }),
  launchSupervisor(requestPath, root, observe) {
    const request = JSON.parse(readFileSync(requestPath, 'utf8'));
    // Only this contract shortens the real supervisor request and substitutes
    // synthetic work. Normal CLI budgets and its process launch stay unchanged.
    request.timeoutMilliseconds = 4_000;
    request.cleanupReserveMilliseconds = 1_000;
    request.arguments = [fileURLToPath(new URL('./legacyCommandWorkerFixture.mjs', import.meta.url)), input.mode === 'unread' ? 'unread' : 'hold'];
    writeFileSync(requestPath, JSON.stringify(request));
    const execution = startLegacyUpgradeSupervisor(requestPath, root, observe);
    execution.child.once('exit', () => events.push('supervisorExit'));
    execution.child.once('close', () => events.push('supervisorClose'));
    return execution;
  },
  async readSupervisorResult(...args) {
    supervisorResult = await readWindowsAcceptanceSupervisorResult(...args);
    events.push('supervisorResultValidated');
    await persist(null);
    if (input.mode === 'missingSupervisor') throw new Error('WINDOWS_ACCEPTANCE_SUPERVISOR_TERMINAL_RESULT_MISSING');
    // Inject only the caller's evidence boundary. The independent report keeps
    // the actual strict result; it is never passed off as a native cleanup fault.
    if (input.mode === 'cleanupUnverified') return { ...supervisorResult, processTreeAbsent: false,
      cleanupResultCode: 'cleanupUnverified' };
    return supervisorResult;
  },
};
if (input.mode === 'filesystemHold') {
  // Block the existing grouped filesystem boundary after the scenario's real
  // deadline. Its existing adapter, not the fixture, owns exact termination.
  ports.filesystem = createLegacyUpgradeFilesystemRuntime({
    runProcess: (options) => runBoundedWindowsAdapterProcess({ ...options,
      timeoutMilliseconds: 1_000, terminationTimeoutMilliseconds: 1_000 }),
    spawnProcess(command, _, options) {
      const child = spawn(command, [fileURLToPath(new URL('./legacyCommandWorkerFixture.mjs', import.meta.url)), 'hold'], options);
      child.once('exit', () => events.push('filesystemExit'));
      child.once('close', () => events.push('filesystemClose'));
      return child;
    },
  });
  ports.verifyArtifact = ports.filesystem.verifyArtifact;
}
if (input.mode === 'writerUnverified') ports.createPhaseWriter = () => ({ send() {}, async finish() {
  return { writerResultCode: 'writerExitUnverified', diagnosticResultCode: 'channelFailed' };
} });
process.exitCode = await runLegacyUpgradeCli(['--artifact-descriptor', resolve('legacy-upgrade-artifact.json'),
  '--expected-descriptor-sha256', input.artifactDescriptorSha256, '--expected-build-revision', 'a'.repeat(40),
  '--result-path', input.callerResultPath], {
  async runScenario(args) {
    try { return await runLegacyUpgrade(args, ports); }
    catch (error) {
      events.push('callerOutcome');
      await persist(legacyUpgradeFailureDetails(error));
      throw error;
    }
  },
});
events.push('cliReturned');
await persist(JSON.parse(await readFile(input.reportPath, 'utf8')).outcome);
