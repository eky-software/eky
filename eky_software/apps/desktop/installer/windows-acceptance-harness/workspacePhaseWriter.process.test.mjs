import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  cleanupRunContext, createRunContext, createRequest, startSupervisor, writeRequest,
} from '../windows-process-supervisor/tests/supervisorContractTestSupport.mjs';
import { readWindowsAcceptanceSupervisorResult } from '../windows-process-supervisor/windowsAcceptanceSupervisorResult.mjs';
import { parseWorkspacePhaseObservation } from './workspacePhaseObservation.mjs';

for (const mode of ['normal', 'unread', 'brokenChannel', 'brokenOutput', 'writerCrash', 'cancelled', 'invalidFields', 'missingResult']) {
  test(`phase writer whole-command exit and owned resources: ${mode}`, {
    skip: process.platform !== 'win32', timeout: 120_000,
  }, async (t) => {
    const context = await createRunContext('phase-writer-' + mode);
    t.after(() => cleanupRunContext(context));
    const reportPath = join(context.testRoot, 'writer-report.json');
    const inputPath = join(context.testRoot, 'writer-input.json');
    await writeFile(inputPath, JSON.stringify({
      mode, reportPath, workerResultPath: context.workerResultPath, runNonce: context.runNonce,
      scenario: context.scenario, artifactDescriptorSha256: context.artifactDescriptorSha256,
    }), { flag: 'wx' });
    const request = createRequest(context, 'exitZero', { timeoutMilliseconds: 30_000, cleanupReserveMilliseconds: 1_000 });
    request.arguments = [fileURLToPath(new URL('./workspacePhaseWriterCommandFixture.mjs', import.meta.url)), inputPath];
    await writeRequest(context, request);
    const execution = startSupervisor(context);
    const completion = await execution.completion;
    const supervisor = await readWindowsAcceptanceSupervisorResult(context.resultPath, {
      artifactDescriptorSha256: context.artifactDescriptorSha256, runNonce: context.runNonce,
      scenario: context.scenario, supervisorExitCode: completion.exitCode,
    });
    assert.equal(supervisor.processTreeAbsent, true);
    assert.equal(completion.exitCode, mode === 'missingResult' ? 1 : 0);
    assert.equal(supervisor.status, mode === 'missingResult' ? 'failed' : 'completed');
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    assert.equal(report.result.writerResultCode, 'writerAbsent');
    assert.equal(report.result.processResult.directProcessAbsent, true);
    assert.equal(report.childClosed, true);
    assert.equal(report.inputDestroyed, true);
    assert.equal(report.starts, 1);
    assert.equal(report.blocked, mode === 'unread');
    for (const line of report.output) parseWorkspacePhaseObservation(Buffer.from(line));
    if (mode === 'missingResult') {
      assert.equal(supervisor.workerResultCode, 'workerResultMissing');
      await assert.rejects(readFile(context.workerResultPath), { code: 'ENOENT' });
    }
  });
}
