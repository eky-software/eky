import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { link, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { registerHooks } from 'node:module';
import { setImmediate as nextTurn } from 'node:timers/promises';
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

for (const target of ['command', 'phase']) {
  test(`a temporary-parent alias does not authorize a linked ${target} directory`, async (t) => {
    const f = await fixture(t);
    const path = target === 'command' ? f.root : resolve(f.root, 'inventoryBefore');
    const saved = `${path}-retained`;
    await rename(path, saved);
    t.after(async () => { await rm(path, { recursive: true, force: true }); await rm(saved, { recursive: true, force: true }); });
    await symlink(saved, path, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(readLegacyCommandPhase(f.path), /commandPhaseInputInvalid/);
    assert.equal((await lstat(f.runRoot)).isDirectory(), true);
    assert.equal((await lstat(saved)).isDirectory(), true);
  });
}

async function controlledReader(t, controls = {}) {
  const target = new URL('./acceptanceCommandPhaseInput.mjs', import.meta.url);
  const key = `__ekyPhaseRead${randomBytes(16).toString('hex')}`;
  target.searchParams.set('fixture', key);
  const bytes = Buffer.from(controls.json ?? '{}'), calls = [];
  const metadata = { dev: 1n, ino: 2n, size: BigInt(bytes.length), nlink: 1n, mtimeNs: 3n, ctimeNs: 3n,
    isFile: () => true, isSymbolicLink: () => false };
  globalThis[key] = {
    lstat: async () => metadata,
    realpath,
    async open() {
      return { stat: async () => metadata, async read(buffer, offset, length, position) {
        calls.push('read');
        if (Object.hasOwn(controls, 'readFailure')) throw controls.readFailure;
        const count = Math.min(length, bytes.length - position);
        bytes.copy(buffer, offset, position, position + count);
        return { bytesRead: count };
      }, async close() {
        calls.push('close'); await controls.beforeClose?.();
        if (Object.hasOwn(controls, 'closeFailure')) throw controls.closeFailure;
      } };
    },
  };
  const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    if (context.parentURL === target.href && specifier === 'node:fs/promises') {
      const source = ['lstat', 'open', 'realpath'].map(name =>
        `export const ${name} = globalThis[${JSON.stringify(key)}][${JSON.stringify(name)}];`).join('\n');
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  } });
  t.after(() => { hooks.deregister(); delete globalThis[key]; });
  const module = await import(target.href);
  return { calls, read: () => module.readCommandPhaseJson('synthetic-input.json') };
}

for (const first of [new Error('SYNTHETIC_PHASE_READ_FIRST'), undefined]) {
test(`phase input preserves ${first === undefined ? 'undefined' : 'the first read error'} before a later close failure`, { timeout: 5_000 }, async t => {
  const close = new Error('SYNTHETIC_PHASE_CLOSE_SECOND');
  const f = await controlledReader(t, { readFailure: first, closeFailure: close });
  await assert.rejects(f.read(), error => error instanceof AggregateError && error.cause === first &&
    error.errors.length === 2 && error.errors[0] === first && error.errors[1] === close);
  assert.equal(f.calls.at(-1), 'close');
});
}

test('phase input retains invalid JSON as primary when close also fails', { timeout: 5_000 }, async t => {
  const close = new Error('SYNTHETIC_PHASE_CLOSE_AFTER_PARSE');
  const f = await controlledReader(t, { json: '[]', closeFailure: close });
  await assert.rejects(f.read(), error => error instanceof AggregateError && error.cause === error.errors[0] &&
    error.errors[0].message === 'commandPhaseInputInvalid' && error.errors[1] === close);
});

test('phase input does not return a successful parse if its handle close fails', { timeout: 5_000 }, async t => {
  const close = new Error('SYNTHETIC_PHASE_CLOSE_ONLY');
  const f = await controlledReader(t, { closeFailure: close });
  await assert.rejects(f.read(), error => error === close);
});

test('phase input joins a held close before returning its original read failure', { timeout: 5_000 }, async t => {
  const first = new Error('SYNTHETIC_PHASE_HELD_READ');
  let enter, finish;
  const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { finish = resolve; });
  const f = await controlledReader(t, { readFailure: first, async beforeClose() { enter(); await held; } });
  let settled = false;
  const task = f.read().then(value => ({ value }), error => ({ error })).then(result => { settled = true; return result; });
  await entered; await nextTurn();
  try { assert.equal(settled, false); }
  finally { finish(); await task; }
  assert.equal((await task).error, first);
});
