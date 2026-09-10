import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { cleanupActiveSupervisors, cleanupRunContext, createRequest, createRunContext,
  startSupervisor, writeRequest } from '../windows-process-supervisor/tests/supervisorContractTestSupport.mjs';
import { readWindowsAcceptanceSupervisorResult } from '../windows-process-supervisor/windowsAcceptanceSupervisorResult.mjs';

after(cleanupActiveSupervisors);
const directory = dirname(fileURLToPath(import.meta.url));
for (const mode of ['valid', 'missing', 'wrongField', 'misordered', 'invalidRecord', 'msiFailure', 'unknownField', 'invalidRequest']) {
  test(`native MSI record and pipe contract: ${mode}`, { skip: process.platform !== 'win32' }, async () => {
    const context = await createRunContext('native-msi-' + mode);
    let verified = false;
    try {
      const request = createRequest(context, 'unused');
      request.arguments = [resolve(directory, 'fixtures/nativeMsiAdapterWorkerFixture.mjs'), context.requestPath, mode];
      await writeRequest(context, request);
      const completion = await startSupervisor(context).completion;
      const result = await readWindowsAcceptanceSupervisorResult(context.resultPath, {
        ...context, supervisorExitCode: completion.exitCode,
      });
      verified = result.processTreeAbsent;
      assert.equal(completion.exitCode, 0);
      assert.equal(result.processTreeAbsent, true);
      const evidence = JSON.parse(await readFile(resolve(context.testRoot, 'native-msi-evidence.json'), 'utf8'));
      const observed = ['valid', 'msiFailure'].includes(mode);
      const protocolValid = !['unknownField', 'invalidRequest'].includes(mode);
      assert.deepEqual(evidence, {
        validation: observed ? 'observed' : 'rejected', clientClosed: true,
        terminal: { exitCode: !protocolValid ? null : ['misordered', 'invalidRecord', 'msiFailure'].includes(mode) ? 1603 : 0,
          protocolValid, validationObserved: observed, callbackValid: protocolValid && !['misordered', 'invalidRecord'].includes(mode) },
      });
    } finally { await cleanupRunContext(context, { preserveEvidence: !verified }); }
  });
}
