import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cleanResultPathForRequest, writeJsonAtomicExclusive } from './cleanInstallUninstallContracts.mjs';
import { executeProductOperation } from './installerProductOperationWorker.mjs';

// Synthetic product/business facts only. The actual command, phase processes,
// result delivery and process cleanup remain the production harness path.
export function cleanCommandFixture(input, testCase, hold) {
  const needsCleanup = ['uninstallHold', 'resultBeforeExit', 'cleanupFailed',
    'scenarioAndCleanupFailed', 'productMissingResult', 'scenarioHold', 'scenarioMissing',
    'scenarioAndProfileFailed', 'scenarioAndRemovalFailed'].includes(testCase);
  const manifest = { appVersion: '0.2.7', msiProductVersion: testCase === 'temporaryRootAlias' ? '255.255.65535' : '0.2.7' };
  return {
    async inventoryProfile() {
      return ['profileChanged', 'scenarioAndProfileFailed'].includes(testCase) && input.phase === 'inventoryAfter'
        ? [{ path: 'synthetic.txt', kind: 'file', size: 1, sha256: 'f'.repeat(64) }] : [];
    },
    async materializeFixture(descriptor, root) {
      const fixtureRoot = resolve(root, 'fixture');
      await mkdir(fixtureRoot);
      await writeFile(resolve(fixtureRoot, 'private-evidence'), 'synthetic');
      return { fixtureRoot, sourceDescriptorPath: descriptor, manifest,
        packageSha256: 'c'.repeat(64), artifactDescriptorSha256: input.commandArguments[3], buildRevision: input.commandArguments[5] };
    },
    async verifyProductArtifact() { return { manifestPath: 'synthetic' }; },
    async readManifest() { return manifest; },
    async verifyArtifact() { if (testCase === 'artifactChanged') throw new Error('syntheticArtifactChanged'); },
    async removeRunRoot(root) {
      if (testCase === 'removalHold') hold();
      if (testCase === 'scenarioAndRemovalFailed') throw new Error('syntheticRemovalFailed');
      await rm(root, { recursive: true });
    },
    async executeProduct(request) {
      if (testCase === 'temporaryRootAlias' && input.phase === 'inspectSourceBefore') return executeProductOperation(request);
      if (testCase === 'uninstallHold' && request.operation === 'uninstall') hold();
      const present = testCase === 'preconditionFailed' || (needsCleanup && input.phase === 'inspectSourceAfter');
      const value = { schemaVersion: 1, productState: present ? 5 : -1, productName: present ? 'Eky' : null,
        productVersion: present ? '0.2.7' : null, localPackagePresent: present, ownedRegistryExists: present, ekyProcessCount: 0 };
      const failed = ['cleanupFailed', 'scenarioAndCleanupFailed'].includes(testCase) && request.operation === 'uninstall';
      return { schemaVersion: 1, nonce: request.nonce, operation: request.operation, status: failed ? 'failed' : 'completed',
        state: request.operation === 'inspect' ? Buffer.from(JSON.stringify(value)).toString('base64') : null,
        errorCode: failed ? 'commandFailed' : null, resultCleanup: 'completed' };
    },
    async runScenario([, requestPath]) {
      if (testCase === 'scenarioHold') hold();
      if (testCase === 'scenarioMissing') return 0;
      const request = JSON.parse(await readFile(requestPath, 'utf8'));
      const failed = needsCleanup || testCase === 'businessFailed';
      await writeJsonAtomicExclusive(cleanResultPathForRequest(requestPath), { schemaVersion: 1,
        runNonce: request.runNonce, scenario: request.scenario, artifactDescriptorSha256: request.artifactDescriptorSha256,
        status: failed ? 'failed' : 'completed', resultCode: failed ? 'cleanInstallUninstallFailed' : 'cleanInstallUninstallCompleted',
        errorCode: failed ? (testCase === 'businessFailed' ? 'cleanProfileChanged' : 'cleanInstallFailed') : null,
        installExitCode: failed ? 1603 : 0, uninstallExitCode: failed ? null : 0,
        installedStateValidated: !failed, uninstalledStateValidated: !failed, payloadValidated: !failed,
        profilePreserved: testCase !== 'businessFailed', repairValidated: !failed, reinstallValidated: !failed,
        cleanupResultCode: failed ? 'cleanupFailed' : 'notRequired' });
      // The actual clean worker exits zero after publishing even a failed
      // scenario; the command must forward its worker status, not infer success.
      return 0;
    },
  };
}
