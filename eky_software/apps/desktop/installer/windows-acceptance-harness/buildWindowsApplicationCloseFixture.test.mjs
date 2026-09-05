import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  cleanupRunContext, createRequest, createRunContext, isProcessAlive,
  startForeignSentinel, startSupervisor, waitForMarker, writeRequest,
} from '../windows-process-supervisor/tests/supervisorContractTestSupport.mjs';
import { readWindowsAcceptanceSupervisorResult } from '../windows-process-supervisor/windowsAcceptanceSupervisorResult.mjs';
import { readCompilationContext } from './fixtures/buildWindowsApplicationCloseFixture.mjs';

const DIRECTORY = dirname(fileURLToPath(import.meta.url));

test('fixture compilation rejects an unbound request and adds no timeout or cleanup owner', async () => {
  assert.throws(() => readCompilationContext('/test/request.json', {}), /fixtureCompilationRequestInvalid/u);
  const source = await readFile(resolve(DIRECTORY, 'fixtures', 'buildWindowsApplicationCloseFixture.mjs'), 'utf8');
  assert.doesNotMatch(source, /setTimeout|setInterval|\.kill\(|taskkill|Get-CimInstance|runBoundedWindowsAdapterProcess/u);
});

for (const mode of ['compilerFailure', 'compilerTimeout']) {
  test(`fixture compilation preserves ${mode} and proves exact Job cleanup`, {
    skip: process.platform !== 'win32',
  }, async (t) => {
    const context = await createRunContext(mode);
    t.after(() => cleanupRunContext(context));
    const foreign = await createRunContext('foreign-compiler-sentinel');
    t.after(() => cleanupRunContext(foreign));
    const sentinel = await startForeignSentinel(foreign);
    const request = createRequest(context, 'exitZero');
    request.arguments = [
      resolve(DIRECTORY, 'fixtures', 'fixtureCompilationProcessFixture.mjs'),
      context.requestPath, mode,
    ];
    await writeRequest(context, request);
    const completion = await startSupervisor(context).completion;
    const result = await readWindowsAcceptanceSupervisorResult(context.resultPath, {
      ...context, supervisorExitCode: completion.exitCode,
    });
    assert.equal(result.processTreeAbsent, true);
    assert.equal(isProcessAlive(sentinel.marker.processId), true);
    if (mode === 'compilerTimeout') {
      assert.equal(result.processResultCode, 'deadlineExceeded');
      assert.equal(result.cleanupResultCode, 'processTreeAbsent');
      for (const role of ['root', 'grandchild']) {
        const marker = await waitForMarker(context, role);
        assert.equal(isProcessAlive(marker.processId), false);
      }
      await assert.rejects(readFile(context.workerResultPath), { code: 'ENOENT' });
    } else {
      assert.equal(result.processResultCode, 'processExitFailed');
      assert.equal(result.childExitCode, 1);
      assert.equal(completion.evidence.some(({ phase }) => phase === 'deadlineExceeded'), false);
      const worker = JSON.parse(await readFile(context.workerResultPath, 'utf8'));
      assert.deepEqual(worker, {
        schemaVersion: 1, scenario: context.scenario, runNonce: context.runNonce,
        artifactDescriptorSha256: context.artifactDescriptorSha256,
        status: 'failed', resultCode: 'fixtureCompilationFailed', errorCode: 'fixtureCompilerFailed',
      });
    }
  });
}
