import assert from 'node:assert/strict';
import { watch } from 'node:fs';
import { access, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { runLegacyUpgradeWorker } from '../runLegacyUpgradeWorker.mjs';
import { legacyUpgradeWorkerResultPathForRequest, readLegacyUpgradeWorkerRequest, writeJsonAtomicExclusive }
  from '../legacyUpgradeContracts.mjs';
import { startLegacyOwnedProcess } from '../legacyUpgradeWindowsRuntime.mjs';
import { executeLegacyUpgradeLifecycle } from '../legacyUpgradeLifecycle.mjs';

// Synthetic proof only: no installed application, MSI operation or business profile.
const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert(['heldBeforeLifecycle', 'childExitedBeforeTerminal', 'publishedProfileRejection', 'success'].includes(input.mode));
const request = await readLegacyUpgradeWorkerRequest(input.requestPath);
assert.equal(legacyUpgradeWorkerResultPathForRequest(input.requestPath), input.workerResultPath);
await mkdir(input.runRoot);
await writeJsonAtomicExclusive(resolve(input.runRoot, 'root.ready.json'), {
  schemaVersion: 1, runNonce: request.runNonce, role: 'root', processId: process.pid,
});

async function waitForRelease() {
  const release = resolve(dirname(input.requestPath), 'observation-release');
  await new Promise((resolvePromise, rejectPromise) => {
    const watcher = watch(dirname(release), () => { void check(); });
    watcher.once('error', rejectPromise);
    async function check() {
      try { await access(release); watcher.close(); resolvePromise(); }
      catch (error) { if (error.code !== 'ENOENT') { watcher.close(); rejectPromise(error); } }
    }
    void check();
  });
}

const exitCode = await runLegacyUpgradeWorker(['--request', input.requestPath], {
  phaseObservation: { timeoutMilliseconds: 8_000, terminationTimeoutMilliseconds: 1_000 },
  async verifyArtifact() {
    if (input.mode === 'heldBeforeLifecycle') {
      setInterval(() => {}, 1_000); // Keep the intentional pre-terminal fault alive until its owner terminates it.
      await new Promise(() => {});
    }
    return { source: { msiProductVersion: '0.2.6' }, target: { msiProductVersion: '0.2.7' } };
  },
  async createRuntime(_request, _artifact, { observeOwnedProcess }) {
    if (input.mode === 'childExitedBeforeTerminal') {
      const child = await startLegacyOwnedProcess(process.execPath, ['-e', 'process.exit(0)'], {}, {
        observe: code => observeOwnedProcess('targetApplication', code),
      });
      await child.completion;
      await waitForRelease(); // The test proves delivery before deliberately losing the terminal result.
      process.exit(1);
    }
    return {};
  },
  async executeLifecycle(runtime) {
    if (input.mode === 'publishedProfileRejection') {
      const versions = { source: '0.2.6', target: '0.2.7' };
      const installed = [null, 'source', 'target'];
      return executeLegacyUpgradeLifecycle({
        ...runtime, versions,
        // This fixture proves the durable cause, not the separate lifecycle stdout protocol.
        reportProgress() {},
        async inspectState() {
          const active = installed.shift();
          function product(role) {
            const present = role === active;
            return { productState: present ? 5 : -1, productName: present ? 'Eky' : null,
              productVersion: present ? versions[role] : null, localPackagePresent: present,
              ownedRegistryExists: present };
          }
          return { source: product('source'), target: product('target'),
            installRootExists: active !== null, executableExists: active !== null,
            shortcutExists: active !== null, installerRegistryExists: active !== null, ekyProcessCount: 0 };
        },
        async verifyArtifact() {}, async runMsiOperation() { return 0; },
        async runSourcePackagedSmoke() {}, async runSourceStartup() {},
        async captureSourceEvidence() {}, async validateTargetPayload() {},
        async runTargetStartup() { throw new Error('legacyAdoptedDataMismatch'); },
      });
    }
    return { schemaVersion: 1, status: 'completed', resultCode: 'historicalLegacyUpgradeCompleted', errorCode: null,
      sourceInstallExitCode: 0, upgradeExitCode: 0, sourceStateValidated: true, sourceNormalStartupValidated: true,
      sourcePackagedSmokeValidated: true, legacyBusinessFixtureValidated: true, majorUpgradeValidated: true,
      targetFirstStartupValidated: true, targetSecondStartupValidated: true, artifactBytesValidated: true };
  },
});
process.exitCode = exitCode;
