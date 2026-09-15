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
for (const mode of ['valid', 'missing', 'wrongField', 'misordered', 'invalidRecord', 'msiFailure', 'unknownField', 'invalidRequest',
  'delayedAcknowledgement', 'missingAcknowledgement', 'wrongAcknowledgement', 'foreignAcknowledgement',
  'extraAcknowledgementField', 'duplicateAcknowledgementField', 'oversizedAcknowledgement', 'disconnectedAcknowledgement']) {
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
      assert.equal(completion.signal, null);
      assert.equal(result.processTreeAbsent, true);
      if (mode === 'missingAcknowledgement') {
        assert.equal(completion.exitCode, 1);
        assert.equal(result.processResultCode, 'deadlineExceeded');
        assert.equal(result.workerResultCode, 'notChecked');
        assert.equal(result.cleanupResultCode, 'processTreeAbsent');
        assert.deepEqual(JSON.parse(await readFile(resolve(context.testRoot, 'native-msi-validation.json'), 'utf8')),
          { observed: true });
        await assert.rejects(readFile(context.workerResultPath), { code: 'ENOENT' });
        await assert.rejects(readFile(resolve(context.testRoot, 'native-msi-evidence.json')), { code: 'ENOENT' });
        // Absence across the whole owned deadline proves callback suspension, not just a live client.
        await assert.rejects(readFile(resolve(context.testRoot, 'native-msi-callback-returned.json')), { code: 'ENOENT' });
        verified = true;
        return;
      }
      assert.equal(completion.exitCode, 0);
      assert.equal(result.processResultCode, 'processCompleted');
      assert.equal(result.workerResultCode, 'workerResultValidated');
      const evidence = JSON.parse(await readFile(resolve(context.testRoot, 'native-msi-evidence.json'), 'utf8'));
      const observed = ['valid', 'msiFailure'].includes(mode) || mode.endsWith('Acknowledgement') || mode.endsWith('AcknowledgementField');
      const protocolValid = ['valid', 'missing', 'wrongField', 'misordered', 'invalidRecord', 'msiFailure', 'delayedAcknowledgement'].includes(mode);
      assert.deepEqual(evidence, {
        validation: observed ? 'observed' : 'rejected', clientClosed: true,
        terminal: { exitCode: !protocolValid ? null : ['misordered', 'invalidRecord', 'msiFailure'].includes(mode) ? 1603 : 0,
          protocolValid, validationObserved: observed, callbackValid: protocolValid && !['misordered', 'invalidRecord'].includes(mode),
          applicationExitAcknowledged: protocolValid && observed },
      });
      const callbackReturnedPath = resolve(context.testRoot, 'native-msi-callback-returned.json');
      if (['valid', 'msiFailure', 'delayedAcknowledgement'].includes(mode)) {
        assert.deepEqual(JSON.parse(await readFile(callbackReturnedPath, 'utf8')), { callbackReturned: true });
      } else {
        await assert.rejects(readFile(callbackReturnedPath), { code: 'ENOENT' });
      }
      verified = true;
    } finally { await cleanupRunContext(context, { preserveEvidence: !verified }); }
  });
}
