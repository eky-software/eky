import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import { runLegacyUpgrade, runLegacyUpgradeCli, startLegacyUpgradeSupervisor } from './runLegacyUpgrade.mjs';
import { legacyUpgradeFailureDetails } from './legacyUpgradeFailureBoundary.mjs';
import { readWindowsAcceptanceSupervisorResult } from '../windows-process-supervisor/windowsAcceptanceSupervisorResult.mjs';
import { createLegacyUpgradeFilesystemRuntime } from './legacyUpgradeFilesystemRuntime.mjs';
import { runBoundedWindowsAdapterProcess } from './boundedWindowsAdapterProcess.mjs';
import { createUpgradeRollbackPostSupervisorWindowsRuntime } from './upgradeRollbackPostSupervisorWindowsRuntime.mjs';
import { runInstallerProductOperation } from './installerProductOperationProcess.mjs';
import { spawnSupervisorProcess } from './supervisorProcessLaunch.mjs';

// Only the existing contract Job contains this command. The inner production
// supervisor still owns the scenario; no test code scans or kills its tree.
const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert(['hold', 'unread', 'cleanupUnverified', 'missingSupervisor', 'cleanupFailed', 'writerUnverified', 'filesystemHold',
  'productHold', 'productUnverified', 'productPreparationHold', 'productReadHold', 'productRemoveHold',
  'productCleanupFailure', 'productMissingResult', 'productOpenResultChannel', 'productResultBeforeExit',
  'productSupervisorHeld', 'supervisorLaunchPending'].includes(input.mode));
const events = [];
let supervisorResult;
const productResults = [];
const persist = async (outcome) => writeFile(input.reportPath, JSON.stringify({ events, supervisorResult, productResults, outcome }));
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
  createProductRuntime: () => ({ outcome: () => ({ productProcessAbsent: true }),
    verifyExactProductStates: async () => input.mode === 'cleanupFailed' && inspections++ > 0
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
    const execution = startLegacyUpgradeSupervisor(requestPath, root, observe, {
      timeoutMilliseconds: request.timeoutMilliseconds, terminationTimeoutMilliseconds: 1_000,
      ...(input.mode === 'supervisorLaunchPending' ? {
        spawnProcess: (command, args, options) => spawnSupervisorProcess(command, args, options, {
          createWorker(_, settings) {
            return new Worker(new URL('./fixtures/supervisorLateLaunchWorkerFixture.mjs', import.meta.url), {
              ...settings, workerData: { ...settings.workerData, delayMilliseconds: 10_000 },
            });
          },
        }),
      } : {}),
    });
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
const productStages = { productHold: 'Command', productUnverified: 'Command', productPreparationHold: 'Preparation',
  productReadHold: 'Read', productRemoveHold: 'Remove', productCleanupFailure: 'CleanupFailure',
  productMissingResult: 'MissingResult', productOpenResultChannel: 'OpenResultChannel', productResultBeforeExit: 'ResultBeforeExit',
  productSupervisorHeld: 'SupervisorHeld' };
if (productStages[input.mode]) {
  ports.createProductRuntime = ({ scenarioRoot }) => {
    const runtime = createUpgradeRollbackPostSupervisorWindowsRuntime({ scenarioRoot,
      artifact: { roles: { source: { productCode: '00000000-0000-0000-0000-000000000001' },
        target: { productCode: '00000000-0000-0000-0000-000000000002' } } },
    }, {
      async runProcess(options) {
        let productRequest;
        const result = await runInstallerProductOperation({ ...options,
          timeoutMilliseconds: 2_000, terminationTimeoutMilliseconds: 1_000, deliveryReserveMilliseconds: 200,
        }, {
          spawnProcess(command, args, settings) {
            productRequest = JSON.parse(Buffer.from(args[2], 'base64').toString('utf8'));
            const dll = resolve(dirname(fileURLToPath(import.meta.url)),
              '../bin/windows-process-supervisor-contract-fixture/Release/net10.0/Eky.WindowsProcessSupervisor.ContractFixture.dll');
            const child = spawnSupervisorProcess(command, [dll, '--mode', `productOperation${productStages[input.mode]}`,
              '--request', args[2]], settings);
            child.once('exit', () => events.push('productExit'));
            child.once('close', () => events.push('productClose'));
            return child;
          },
        });
        productResults.push(result.supervisor ?? result);
        assert.equal(result.resultCode, input.mode === 'productCleanupFailure' ? 'processExitFailed'
          : ['productMissingResult', 'productSupervisorHeld'].includes(input.mode) ? 'processCompleted' : 'timedOut');
        assert.equal(result.directProcessAbsent, input.mode !== 'productSupervisorHeld');
        if (input.mode === 'productSupervisorHeld') {
          assert.equal(result.invocation.resultCode, 'timedOut');
          assert.equal(result.invocation.directProcessAbsent, true);
          assert.equal(result.status, 'failed');
          return result;
        }
        if (input.mode === 'productCleanupFailure') {
          assert.equal(result.worker.errorCode, 'commandFailed');
          assert.equal(result.worker.resultCleanup, 'failed');
        } else {
          const boundary = JSON.parse(await readFile(resolve(scenarioRoot, `product-boundary-${productRequest.nonce}.json`), 'utf8'));
          assert.equal(boundary.phase, { Command: 'command', Preparation: 'preparation', Read: 'resultRead', Remove: 'resultCleanup',
            MissingResult: 'missingResult', OpenResultChannel: 'openResultChannel', ResultBeforeExit: 'resultBeforeExit' }[productStages[input.mode]]);
          if (productStages[input.mode] === 'Command') assert.equal(boundary.descendantStarted, true);
        }
        if (input.mode === 'productMissingResult') assert.equal(result.supervisor.workerResultCode, 'workerResultMissing');
        // Inject uncertainty only after proving the real Job's removal. This
        // tests retention, not a claim that native cleanup failed in this run.
        return input.mode === 'productUnverified'
          ? { ...result, resultCode: 'terminationUnconfirmed', directProcessAbsent: false } : result;
      },
    });
    let preflight = true;
    return { ...runtime, verifyExactProductStates() {
      if (preflight) { preflight = false; return absent; }
      return runtime.verifyExactProductStates();
    } };
  };
}
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
