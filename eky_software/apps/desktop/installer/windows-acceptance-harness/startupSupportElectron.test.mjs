import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { createRequest, createTestRunContext, startSupervisor, writeRequest } from
  '../windows-process-supervisor/tests/supervisorContractTestSupport.mjs';
import { readWindowsAcceptanceSupervisorResult } from '../windows-process-supervisor/windowsAcceptanceSupervisorResult.mjs';
import { hasExactPhaseKeys, readCommandPhaseJson } from './acceptanceCommandPhaseInput.mjs';
import { prepareStartupSupportFixture, readStartupSupportFixture } from './fixtures/startupSupportElectronFixture.mjs';
import { inspectSupportBundle } from '../../scripts/inspect-support-bundle.mjs';
import { createRunnerFailureSink } from '../../../../test-reporters/runnerFailureEvidence.mjs';

const require = createRequire(import.meta.url);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function createNamedRegistry() {
  const { validateWorkspaceRegistry } = await import('../../dist/workspaces/registry/workspaceRegistryValidation.js');
  const workspaceId = randomUUID();
  return validateWorkspaceRegistry({ formatVersion: 2, activeWorkspaceId: workspaceId, workspaces: [{
    workspaceId, workspaceLabel: 'Synthetic startup support company',
    lineageIdentity: { formatVersion: 1, profileId: randomBytes(32).toString('hex') },
    layoutVersion: 1, lifecycleState: 'ready', createdAt: '2026-11-01T00:00:00.000Z',
  }] });
}

test('startup support fixture accepts the real V2 ready-entry registry with a non-null active workspace', async () => {
  const registry = await createNamedRegistry();
  assert.equal(registry.formatVersion, 2);
  assert.equal(registry.activeWorkspaceId, registry.workspaces[0].workspaceId);
  assert.notEqual(registry.activeWorkspaceId, null);
  assert.match(registry.workspaces[0].lineageIdentity.profileId, /^[a-f0-9]{64}$/u);
});

test('startup support fixture rejects unknown config keys and foreign root markers', async t => {
  const context = await createTestRunContext(t, 'startup-support-config');
  const p = await prepareStartupSupportFixture(context);
  assert.equal(p.runRoot, context.runRoot);
  const original = await readFile(p.inputPath);
  await writeFile(p.inputPath, JSON.stringify({ ...JSON.parse(original), targetPath: p.targetPath }));
  await assert.rejects(readStartupSupportFixture(p.inputPath));
  await writeFile(p.inputPath, original);
  await writeFile(join(p.runRoot, 'fixture-marker.json'), JSON.stringify({
    schemaVersion: 1, fixture: 'startupSupportElectron', runNonce: '0'.repeat(64),
  }));
  await assert.rejects(readStartupSupportFixture(p.inputPath));
});

test('startup support fixture rejects hardlinked input and changed bootstrap bytes', async t => {
  const context = await createTestRunContext(t, 'startup-support-files');
  const p = await prepareStartupSupportFixture(context);
  const alias = join(p.testRoot, 'input-alias.json');
  await link(p.inputPath, alias);
  await assert.rejects(readStartupSupportFixture(p.inputPath));
  await rm(alias);
  await writeFile(join(p.appRoot, 'bootstrap.mjs'), 'throw new Error("foreign entry");\n');
  await assert.rejects(readStartupSupportFixture(p.inputPath));
});

test('startup support fixture rejects a linked Electron writing directory', async t => {
  const context = await createTestRunContext(t, 'startup-support-directory');
  const p = await prepareStartupSupportFixture(context);
  await rm(p.electronPaths.logs, { recursive: true });
  await symlink(p.electronPaths.temp, p.electronPaths.logs, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(readStartupSupportFixture(p.inputPath));
});

test('startup support exports a real missing workspace failure through index and Windows Job exit', {
  skip: process.platform !== 'win32', timeout: 120_000,
}, async t => {
  const context = await createTestRunContext(t, 'startup-support-electron');
  const p = await prepareStartupSupportFixture(context);
  const { WORKSPACE_REGISTRY_FILE_NAME } = await import('../../dist/workspaces/registry/workspaceRegistryPaths.js');
  const registry = await createNamedRegistry();
  const workspaceId = registry.activeWorkspaceId, profileId = registry.workspaces[0].lineageIdentity.profileId;
  const registryPath = join(p.electronPaths.userData, WORKSPACE_REGISTRY_FILE_NAME);
  const registryBytes = Buffer.from(JSON.stringify(registry));
  const workspacesRoot = join(p.electronPaths.userData, 'workspaces');
  await mkdir(workspacesRoot);
  await writeFile(registryPath, registryBytes, { flag: 'wx' });
  await assert.rejects(lstat(join(workspacesRoot, workspaceId)), { code: 'ENOENT' });
  const indexPath = new URL('../../dist/main/index.js', import.meta.url);
  const indexBytes = await readFile(indexPath);
  const request = createRequest(context, 'normalExit');
  request.command = require('electron');
  request.arguments = [p.appRoot, `--startup-support-input=${p.inputPath}`];
  await writeRequest(context, request);
  const completed = await startSupervisor(context).completion;
  const result = await readWindowsAcceptanceSupervisorResult(context.resultPath, {
    artifactDescriptorSha256: context.artifactDescriptorSha256, runNonce: context.runNonce,
    scenario: context.scenario, supervisorExitCode: completed.exitCode,
  });
  assert.equal(result.processTreeAbsent, true, 'STARTUP_SUPPORT_PROCESS_TREE_NOT_ABSENT');
  assert.ok(['notRequired', 'processTreeAbsent'].includes(result.cleanupResultCode), 'STARTUP_SUPPORT_CLEANUP_UNVERIFIED');
  assert.equal(result.processResultCode, 'processExitFailed');
  assert.equal(result.childExitCode, 1, 'STARTUP_SUPPORT_REAL_EXIT_ONE_REQUIRED');
  const proof = await readCommandPhaseJson(p.proofPath);
  assert.ok(hasExactPhaseKeys(proof, ['schemaVersion', 'runNonce', 'nativeDialogResponsesStubbed', 'isPackaged',
    'appVersion', 'electronVersion', 'architecture', 'platform', 'requestedExitCode', 'pathsIsolated', 'liveWindows',
    'workspaceRootCallerObserved', 'windowsCreated', 'businessForkAttempts', 'sqliteLoadAttempts', 'missingRootLookups',
    'missingRootFailures', 'confirmationCalls', 'saveCalls', 'errorDialogs', 'firstFailure']));
  if (proof.firstFailure !== null) {
    const sink = createRunnerFailureSink();
    sink.record({ runner: 'node', phase: 'startupSupportNative', projectedException: proof.firstFailure,
      testName: t.name, testId: context.runNonce, file: import.meta.url, attempt: 0, retryCount: 0, repeatCount: 0 });
    await sink.flush();
    assert.fail('STARTUP_SUPPORT_NATIVE_ADAPTER_FAILED');
  }
  assert.equal(proof.schemaVersion, 1); assert.equal(proof.runNonce, context.runNonce);
  assert.equal(proof.nativeDialogResponsesStubbed, true); assert.equal(proof.isPackaged, false);
  assert.equal(proof.appVersion, p.appVersion); assert.equal(proof.electronVersion, require('electron/package.json').version);
  assert.equal(proof.platform, process.platform); assert.equal(proof.architecture, process.arch);
  assert.equal(proof.requestedExitCode, 1); assert.equal(proof.pathsIsolated, true);
  for (const key of ['windowsCreated', 'liveWindows', 'businessForkAttempts', 'sqliteLoadAttempts', 'errorDialogs']) assert.equal(proof[key], 0, key);
  for (const key of ['missingRootLookups', 'missingRootFailures', 'confirmationCalls', 'saveCalls']) assert.equal(proof[key], 1, key);
  assert.equal(proof.workspaceRootCallerObserved, true, 'STARTUP_SUPPORT_REAL_ROOT_INSPECTION_REQUIRED');
  const { document, summary } = inspectSupportBundle(p.targetPath);
  assert.deepEqual(document.system, { appVersion: p.appVersion, buildRevision: 'development',
    electronVersion: proof.electronVersion, architecture: proof.architecture, platform: proof.platform });
  assert.equal(summary.formatVersion, 3); assert.equal(summary.kind, 'desktopOnly');
  assert.deepEqual(document.observation, { scope: 'currentOperation', status: 'unavailable' });
  assert.deepEqual(document.availability, { backend: 'exitUnconfirmed', database: 'notInspected',
    diagnosticHistory: 'notCollected', incidentHistory: 'notCollected' });
  const serialized = JSON.stringify(document);
  for (const excluded of [context.testRoot, workspaceId, profileId, registry.workspaces[0].workspaceLabel,
    'ENOENT', 'WORKSPACE_ROOT_INVALID', 'stack', 'cause']) assert.equal(serialized.includes(excluded), false, 'STARTUP_SUPPORT_PRIVATE_DATA_LEAK');
  assert.equal((await readFile(registryPath)).equals(registryBytes), true, 'STARTUP_SUPPORT_REGISTRY_CHANGED');
  await assert.rejects(lstat(join(workspacesRoot, workspaceId)), { code: 'ENOENT' });
  assert.deepEqual(await readdir(workspacesRoot), []);
  assert.equal((await readFile(indexPath)).equals(indexBytes), true, 'STARTUP_SUPPORT_DIST_CHANGED');
  t.diagnostic(JSON.stringify({ nativeDialogResponsesStubbed: true, childExitCode: result.childExitCode,
    processTreeAbsent: result.processTreeAbsent, windowsCreated: proof.windowsCreated,
    businessForkAttempts: proof.businessForkAttempts, sqliteLoadAttempts: proof.sqliteLoadAttempts,
    registryPreserved: true, missingWorkspacePreserved: true, inspector: 'desktopOnlyV3',
    indexSha256: sha256(indexBytes), bundleSha256: sha256(await readFile(p.targetPath)) }));
});
