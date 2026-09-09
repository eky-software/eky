import assert from 'node:assert/strict';
import { lstat, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { cleanupRunContext, createRunContext, createRequest, startSupervisor, writeRequest }
  from '../windows-process-supervisor/tests/supervisorContractTestSupport.mjs';
import { readWindowsAcceptanceSupervisorResult } from '../windows-process-supervisor/windowsAcceptanceSupervisorResult.mjs';
import { legacyCallerResultIdentity, parseLegacyCallerResult } from './legacyCallerResult.mjs';

for (const mode of ['hold', 'unread', 'cleanupUnverified', 'missingSupervisor', 'cleanupFailed', 'writerUnverified', 'filesystemHold']) {
  test(`legacy whole command terminates after scenario deadline: ${mode}`, {
    skip: process.platform !== 'win32', timeout: 60_000,
  }, async (t) => {
    const context = await createRunContext('legacy-command-' + mode);
    const callerRoot = join(await realpath(tmpdir()), 'eky-legacy-caller-' + randomBytes(16).toString('hex'));
    let treeAbsent = false;
    let contractVerified = false;
    const callerResultPath = join(callerRoot, 'result.json');
    const rootPath = join(context.testRoot, 'run-root.txt');
    t.after(async () => {
      await cleanupRunContext(context, { preserveEvidence: true });
      if (treeAbsent && contractVerified) {
        const root = await readFile(rootPath, 'utf8').catch(() => null);
        if (root) await rm(root, { recursive: true, force: true });
        await rm(callerRoot, { recursive: true, force: true });
        await rm(context.testRoot, { recursive: true, force: true });
      }
    });
    const reportPath = join(context.testRoot, 'caller-report.json');
    const inputPath = join(context.testRoot, 'input.json');
    await writeFile(inputPath, JSON.stringify({ mode, reportPath, callerResultPath, rootPath,
      artifactDescriptorSha256: context.artifactDescriptorSha256 }));
    const request = createRequest(context, 'exitZero', { timeoutMilliseconds: 15_000, cleanupReserveMilliseconds: 1_000 });
    request.arguments = [fileURLToPath(new URL('./legacyCommandCompletionFixture.mjs', import.meta.url)), inputPath];
    await writeRequest(context, request);
    const execution = startSupervisor(context, { captureOutput: false, unreadOutput: mode === 'unread' });
    const completed = await execution.completion;
    const outer = await readWindowsAcceptanceSupervisorResult(context.resultPath, {
      artifactDescriptorSha256: context.artifactDescriptorSha256, runNonce: context.runNonce,
      scenario: context.scenario, supervisorExitCode: completed.exitCode,
    });
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    assert.equal(outer.processTreeAbsent, true);
    treeAbsent = true;
    assert.equal(report.supervisorResult.processResultCode, 'deadlineExceeded');
    assert.equal(report.supervisorResult.cleanupResultCode, 'processTreeAbsent');
    assert.equal(report.supervisorResult.processTreeAbsent, true);
    assert.equal(report.outcome.errorCode, mode === 'missingSupervisor' ? 'WINDOWS_ACCEPTANCE_SUPERVISOR_TERMINAL_RESULT_MISSING'
      : 'WINDOWS_ACCEPTANCE_SUPERVISOR_DEADLINE_EXCEEDED');
    const removed = ['hold', 'unread'].includes(mode);
    assert.equal(report.outcome.fixtureRemoved, removed);
    const root = await readFile(rootPath, 'utf8');
    if (removed) await assert.rejects(lstat(root), { code: 'ENOENT' });
    else assert.equal((await lstat(root)).isDirectory(), true);
    if (mode === 'cleanupUnverified') {
      assert.equal(report.outcome.processTreeAbsent, false);
      assert.equal(report.outcome.supervisorCleanupResultCode, 'cleanupUnverified');
      assert.equal(report.outcome.semanticCleanupResultCode, 'blockedByOwnedProcessTree');
    }
    if (mode === 'cleanupFailed') assert.equal(report.outcome.semanticCleanupResultCode, 'semanticCleanupFailed');
    if (mode === 'writerUnverified') assert.equal(report.outcome.safetyErrorCode, 'WINDOWS_ACCEPTANCE_LEGACY_PHASE_WRITER_EXIT_UNVERIFIED');
    const expectedEvents = ['supervisorExit', 'supervisorClose', 'supervisorResultValidated'];
    if (mode === 'filesystemHold') {
      expectedEvents.push('filesystemExit', 'filesystemClose');
      assert.equal(report.outcome.safetyErrorCode, 'WINDOWS_ACCEPTANCE_LEGACY_FILESYSTEM_TIMED_OUT');
      assert.equal(report.outcome.filesystemErrorCode, 'WINDOWS_ACCEPTANCE_LEGACY_FILESYSTEM_TIMED_OUT');
      assert.equal(report.outcome.filesystemOperation, 'artifact');
      assert.equal(report.outcome.filesystemProcessAbsent, true);
    }
    expectedEvents.push('callerOutcome', 'cliReturned');
    assert.deepEqual(report.events, expectedEvents);
    assert.equal(outer.processTreeAbsent, true);
    assert.equal(outer.processResultCode, 'processExitFailed');
    assert.equal(outer.childExitCode, 1);
    assert.equal(report.events.at(-1), 'cliReturned');
    assert.equal(execution.child.exitCode, 1);
    assert.equal(execution.child.signalCode, null);
    const binding = legacyCallerResultIdentity(callerResultPath, { artifactDescriptorSha256: context.artifactDescriptorSha256,
      buildRevision: 'a'.repeat(40) });
    const result = parseLegacyCallerResult(await readFile(callerResultPath), binding);
    assert.deepEqual(result.outcome, report.outcome);
    contractVerified = true;
  });
}
