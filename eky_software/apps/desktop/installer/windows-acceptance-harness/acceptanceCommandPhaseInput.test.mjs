import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { link, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { readLegacyCommandPhase } from './legacyCommandPhase.mjs';

async function fixture(t) {
  const temp = await realpath(tmpdir());
  const root = resolve(temp, 'eky-acceptance-command-' + randomBytes(16).toString('hex'));
  const runRoot = await mkdtemp(resolve(temp, 'eky-windows-acceptance-v2-legacy-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); await rm(runRoot, { recursive: true, force: true }); });
  await mkdir(resolve(root, 'prepare'), { recursive: true });
  await mkdir(resolve(root, 'inventoryBefore'));
  const binding = { schemaVersion: 1, runNonce: 'a'.repeat(64), scenario: 'acceptanceCommandPhase', artifactDescriptorSha256: 'b'.repeat(64) };
  const report = { ...binding, status: 'completed', processResultCode: 'processCompleted', workerResultCode: 'workerResultValidated',
    childExitCode: 0, processWin32ErrorCode: null, cleanupWin32ErrorCode: null, cleanupResultCode: 'notRequired', processTreeAbsent: true, durationMs: 1 };
  const state = { runRoot, artifact: null, profileBefore: null, profileAfter: null, products: {}, semanticProof: null,
    safetyErrorCode: null, fixtureRemoved: false, fixtureCleanupResultCode: 'retainedUnverified' };
  const input = { schemaVersion: 1, phase: 'inventoryBefore', commandKind: 'legacy', scenarioRunNonce: 'd'.repeat(64),
    commandArguments: ['--artifact-descriptor', resolve(root, 'legacy-upgrade-artifact.json'), '--expected-descriptor-sha256',
      binding.artifactDescriptorSha256, '--expected-build-revision', 'c'.repeat(40), '--result-path',
      resolve(temp, 'eky-legacy-caller-' + randomBytes(16).toString('hex'), 'result.json')],
    history: [{ phase: 'prepare', runNonce: binding.runNonce, exitCode: 0, resultWritten: true, processBoundaryVerified: true, requestErrorCode: null }] };
  const path = resolve(root, 'inventoryBefore', 'phase-input.json');
  const statePath = resolve(root, 'prepare', 'phase-state.json');
  const reportPath = resolve(root, 'prepare', 'result.json');
  await writeFile(path, JSON.stringify(input));
  await writeFile(statePath, JSON.stringify({ binding, state }));
  await writeFile(reportPath, JSON.stringify(report));
  await writeFile(resolve(root, 'inventoryBefore', 'request.json'), JSON.stringify({ ...binding,
    runNonce: 'e'.repeat(64), workingDirectory: resolve(root, 'inventoryBefore') }));
  return { root, runRoot, path, input, binding, statePath, reportPath };
}

test('command phase requires bound process evidence and the exact previous phase order', async (t) => {
  const f = await fixture(t);
  assert.equal((await readLegacyCommandPhase(f.path)).state.runRoot, f.runRoot);
  const first = f.input.history[0];
  for (const changes of [{ processBoundaryVerified: false }, { resultWritten: false }, { requestErrorCode: 'requestFileInvalid' },
    { exitCode: null }, { runNonce: 'f'.repeat(64) }, { phase: 'uninstallTarget' }]) {
    await writeFile(f.path, JSON.stringify({ ...f.input, history: [{ ...first, ...changes }] }));
    await assert.rejects(readLegacyCommandPhase(f.path));
  }
  await writeFile(f.path, JSON.stringify(f.input));
  const original = JSON.parse(await readFile(f.reportPath, 'utf8'));
  await writeFile(f.reportPath, JSON.stringify({ ...original, processTreeAbsent: false }));
  await assert.rejects(readLegacyCommandPhase(f.path));
  await rm(f.reportPath);
  await assert.rejects(readLegacyCommandPhase(f.path));
  assert.equal((await lstat(f.runRoot)).isDirectory(), true);
});

test('command state rejects a hardlink or an unbound snapshot without deleting evidence', async (t) => {
  const f = await fixture(t);
  const original = await readFile(f.statePath, 'utf8');
  const alias = resolve(f.root, 'snapshot-alias.json');
  await link(f.statePath, alias);
  await assert.rejects(readLegacyCommandPhase(f.path));
  assert.equal(await readFile(alias, 'utf8'), original);
  await rm(alias);
  const parsed = JSON.parse(original);
  await writeFile(f.statePath, JSON.stringify({ ...parsed, binding: { ...parsed.binding, runNonce: 'f'.repeat(64) } }));
  await assert.rejects(readLegacyCommandPhase(f.path));
  assert.equal((await lstat(f.runRoot)).isDirectory(), true);
});
