import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  cleanupRunContext, createRunContext, createRequest, startSupervisor, writeRequest,
} from '../windows-process-supervisor/tests/supervisorContractTestSupport.mjs';
import { readWindowsAcceptanceSupervisorResult } from '../windows-process-supervisor/windowsAcceptanceSupervisorResult.mjs';
import { parseWorkspacePhaseObservation } from './workspacePhaseObservation.mjs';
import { parseWorkspaceCallerResult, workspaceCallerResultIdentity } from './workspaceCallerResult.mjs';

for (const mode of ['normal', 'unread', 'brokenChannel', 'brokenOutput', 'writerCrash', 'cancelled', 'invalidFields', 'missingResult',
  'callerFailure', 'invalidCallerResult']) {
  test(`phase writer whole-command exit and owned resources: ${mode}`, {
    skip: process.platform !== 'win32', timeout: 120_000,
  }, async (t) => {
    const context = await createRunContext('phase-writer-' + mode);
    t.after(() => cleanupRunContext(context));
    const callerRoot = join(await realpath(tmpdir()), 'eky-workspace-caller-' + randomBytes(16).toString('hex'));
    let treeAbsent = false;
    t.after(async () => { if (treeAbsent) await rm(callerRoot, { recursive: true, force: true }); });
    const callerResultPath = join(callerRoot, 'result.json');
    const reportPath = join(context.testRoot, 'writer-report.json');
    const inputPath = join(context.testRoot, 'writer-input.json');
    await writeFile(inputPath, JSON.stringify({
      mode, reportPath, callerResultPath, workerResultPath: context.workerResultPath, runNonce: context.runNonce,
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
    treeAbsent = true;
    const callerExit = mode === 'callerFailure' ? 1 : mode === 'invalidCallerResult' ? 2 : 0;
    const failed = mode === 'missingResult' || callerExit !== 0;
    assert.equal(completion.exitCode, failed ? 1 : 0);
    assert.equal(supervisor.status, failed ? 'failed' : 'completed');
    assert.equal(supervisor.childExitCode, callerExit);
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    assert.equal(report.result.writerResultCode, 'writerAbsent');
    assert.equal(report.result.processResult.directProcessAbsent, true);
    assert.equal(report.childClosed, true);
    assert.equal(report.inputDestroyed, true);
    assert.equal(report.starts, 1);
    assert.equal(report.blocked, mode === 'unread');
    assert.equal(report.callerExit, callerExit);
    if (mode === 'invalidCallerResult') await assert.rejects(readFile(callerResultPath), { code: 'ENOENT' });
    else {
      const binding = workspaceCallerResultIdentity(callerResultPath, {
        expectedBuildRevision: 'a'.repeat(40), expectedDescriptorSha256: context.artifactDescriptorSha256,
      });
      const result = parseWorkspaceCallerResult(await readFile(callerResultPath), binding);
      assert.equal(result.outcome.status, callerExit === 0 ? 'completed' : 'failed');
      if (callerExit !== 0) assert.equal(result.outcome.errorCode, 'scenarioResultInvalid');
    }
    assert.equal(report.verificationExit, callerExit === 0 ? 0 : 1);
    for (const line of report.output) parseWorkspacePhaseObservation(Buffer.from(line));
    if (mode === 'missingResult') {
      assert.equal(supervisor.workerResultCode, 'workerResultMissing');
      await assert.rejects(readFile(context.workerResultPath), { code: 'ENOENT' });
    }
  });
}
