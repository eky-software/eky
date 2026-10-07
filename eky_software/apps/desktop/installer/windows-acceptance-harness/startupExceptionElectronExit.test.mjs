import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createRequest, createTestRunContext, startSupervisor, writeRequest } from
  '../windows-process-supervisor/tests/supervisorContractTestSupport.mjs';
import { readWindowsAcceptanceSupervisorResult } from '../windows-process-supervisor/windowsAcceptanceSupervisorResult.mjs';
import { readLegacyOriginalExceptionEvidence } from './legacyOriginalExceptionEvidence.mjs';
import { LEGACY_STARTUP_TERMINAL_FILENAME } from './legacyStartupFailureEvidence.mjs';
import { STARTUP_EXCEPTION_CONTROL, startupExceptionDirectory } from '../../src/main/startupExceptionEvidence.ts';

const require = createRequire(import.meta.url);
test('original exception survives real Electron app.exit and owned process-tree cleanup', {
  skip: process.platform !== 'win32', timeout: 120_000,
}, async t => {
  const context = await createTestRunContext(t, 'original-exception-electron-exit');
  const identity = { appVersion: require('electron/package.json').version,
    buildRevision: process.env.GITHUB_SHA || 'a'.repeat(40) };
  const tempPath = join(context.runRoot, 'source-smoke-temp');
  const root = startupExceptionDirectory(tempPath, context.runNonce);
  await mkdir(join(root, 'user-data'), { recursive: true });
  await mkdir(join(root, 'result'));
  await writeFile(join(root, 'result', STARTUP_EXCEPTION_CONTROL), JSON.stringify({
    schemaVersion: 1, scenarioRunNonce: context.runNonce, ...identity,
  }), { flag: 'wx' });
  const inputPath = join(context.testRoot, 'exception-proof-input.json');
  await writeFile(inputPath, JSON.stringify({ enabled: true, tempPath,
    userDataPath: join(root, 'user-data'), token: context.runNonce,
    runtimeInstanceId: randomUUID(), ...identity }), { flag: 'wx' });
  const request = createRequest(context, 'normalExit');
  request.command = require('electron');
  request.arguments = [fileURLToPath(new URL('./fixtures/startupExceptionElectronExitFixture.mjs', import.meta.url)),
    `--exception-proof-input=${inputPath}`];
  await writeRequest(context, request);
  const completed = await startSupervisor(context).completion;
  const result = await readWindowsAcceptanceSupervisorResult(context.resultPath, {
    artifactDescriptorSha256: context.artifactDescriptorSha256, runNonce: context.runNonce,
    scenario: context.scenario, supervisorExitCode: completed.exitCode,
  });
  assert.equal(result.processResultCode === 'processExitFailed' && result.childExitCode === 1,
    true, 'STARTUP_EXCEPTION_ELECTRON_EXIT_NOT_PROVEN');
  assert.equal(result.processTreeAbsent && ['notRequired', 'processTreeAbsent'].includes(result.cleanupResultCode),
    true, 'STARTUP_EXCEPTION_ELECTRON_CLEANUP_NOT_PROVEN');
  const startup = { schemaVersion: 1, scenarioRunNonce: context.runNonce,
    artifactDescriptorSha256: context.artifactDescriptorSha256, targetIdentity: identity,
    status: 'notObserved', events: [] };
  const evidence = await readLegacyOriginalExceptionEvidence({ runRoot: context.runRoot,
    artifact: { target: identity }, supervisorResult: result }, startup);
  assert.equal(evidence.status === 'recorded' && evidence.exceptions.length === 1,
    true, 'STARTUP_EXCEPTION_ELECTRON_DELIVERY_NOT_PROVEN');
  const record = evidence.exceptions[0];
  assert.equal(record.stage === 'earlyStartup' && record.chain.length === 2 && !record.incomplete &&
    record.chain[0].message === 'synthetic first Electron startup exception' &&
    record.chain[1].message === 'synthetic original Electron cause' &&
    record.chain[0].stack?.includes('startupExceptionElectronExitFixture.mjs'),
    true, 'STARTUP_EXCEPTION_ELECTRON_ORIGINAL_NOT_PROVEN');
  // The existing collector owns this exact terminal; never copy the profile.
  const terminalRoot = process.env.RUNNER_TEMP
    ? join(process.env.RUNNER_TEMP, `eky-acceptance-command-${context.runNonce.slice(0, 32)}`, 'fixtureCleanup')
    : join(context.testRoot, 'fixtureCleanup');
  await mkdir(terminalRoot, { recursive: true });
  await writeFile(join(terminalRoot, LEGACY_STARTUP_TERMINAL_FILENAME), JSON.stringify({
    binding: { schemaVersion: 1, runNonce: context.runNonce, scenario: 'acceptanceCommandPhase',
      artifactDescriptorSha256: context.artifactDescriptorSha256 },
    outcome: {}, startupEvidence: startup, originalExceptionEvidence: evidence,
  }), { flag: 'wx' });
});
