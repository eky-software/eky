import assert from 'node:assert/strict';
import { registerHooks, stripTypeScriptTypes } from 'node:module';

const sourceRoot = new URL('../src/', import.meta.url).href;
const forbiddenModules = new Set(['electron', 'better-sqlite3', 'node:sqlite', 'sqlite', 'node:child_process', 'child_process']);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    assert.equal(forbiddenModules.has(specifier), false, 'DELETION_FIXTURE_MUST_NOT_OPEN_RUNTIME_OR_SPAWN');
    if (context.parentURL?.startsWith(sourceRoot) && specifier.startsWith('.') && specifier.endsWith('.js')) {
      return nextResolve(new URL(specifier.replace(/\.js$/u, '.ts'), context.parentURL).href, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (url.startsWith(sourceRoot) && new URL(url).pathname.endsWith('.ts')) {
      return { ...loaded, format: 'module', source: stripTypeScriptTypes(String(loaded.source), { mode: 'transform' }) };
    }
    return loaded;
  },
});

const controller = new AbortController();
process.once('disconnect', () => controller.abort(new Error('DELETION_FIXTURE_PARENT_LOST')));

function send(message) {
  return new Promise((resolve, reject) => {
    if (!process.connected) { reject(new Error('DELETION_FIXTURE_PARENT_LOST')); return; }
    process.send(message, error => error ? reject(error) : resolve());
  });
}

async function holdAtCut(cut, expected, assertCurrent) {
  if (cut !== expected) return;
  await send({ event: 'cut', cut, pid: process.pid });
  // Only the parent owns termination. Disconnect cancels the held operation.
  await new Promise(resolve => {
    if (controller.signal.aborted) resolve();
    else controller.signal.addEventListener('abort', resolve, { once: true });
  });
  assertCurrent();
}

async function run(config) {
  const { acquireWorkspaceProcessReservation } = await import('../src/runtime/workspaceProcessReservation.ts');
  const { InMemoryWorkspaceMaintenanceLease } = await import('../src/workspaces/maintenance/workspaceMaintenanceLease.ts');
  const { WorkspaceRegistryStore } = await import('../src/workspaces/registry/workspaceRegistryStore.ts');
  const { WORKSPACE_REGISTRY_FILE_NAME } = await import('../src/workspaces/registry/workspaceRegistryPaths.ts');
  const { captureDeletionTarget } = await import('../src/workspaces/management/workspaceDeletionTarget.ts');
  const { createWorkspaceDeletionCommand } = await import('../src/workspaces/deletion/workspaceDeletionCommand.ts');
  const { WorkspaceDeletionJournalStore } = await import('../src/workspaces/deletion/workspaceDeletionJournalStore.ts');
  const { join } = await import('node:path');
  const reservation = await acquireWorkspaceProcessReservation({ userDataRoot: config.root, signal: controller.signal });
  const leases = new InMemoryWorkspaceMaintenanceLease();
  if (config.mode === 'resumeCold') {
    const { recoverDesktopWorkspaceDeletion } = await import('../src/main/recoverDesktopWorkspaceDeletion.ts');
    let active = true, first;
    const work = { pending: false };
    const assertCurrent = () => {
      controller.signal.throwIfAborted(); reservation.invalidated.throwIfAborted();
      assert.equal(active, true, 'DELETION_FIXTURE_OWNER_ENDED');
    };
    try {
      const completion = await recoverDesktopWorkspaceDeletion({ userDataRoot: config.root,
        buildInfo: config.buildInfo, releaseInfo: config.releaseInfo, maintenanceLease: leases, work,
        assertStartupCurrent: assertCurrent,
        reservation: { assertMainCurrent: assertCurrent, assertMainOwned: () => reservation.assertOwned(),
          invalidate() { active = false; } }, observer: { record() {} } });
      assertCurrent(); await reservation.assertOwned(); assertCurrent();
      assert.equal(work.pending, false); assert.equal(work.uncertainty, undefined); assert.equal(leases.readState(), 'idle');
      assert.equal(completion?.status, 'completed');
      await send({ event: 'completed', pid: process.pid, coldSettled: true, completion });
    } catch (error) { first = error; }
    finally {
      active = false;
      // Uncertain main work retains the physical reservation until process exit.
      if (work.uncertainty === undefined && !work.pending) {
        try { await reservation.release(); }
        catch (error) { first = first === undefined ? error : new AggregateError([first, error], 'DELETION_FIXTURE_CLOSE_FAILED', { cause: first }); }
      }
    }
    if (first !== undefined) throw first;
    return;
  }
  const lease = await leases.acquire('delete');
  const leaseCurrent = leases.captureCurrentOwner(['delete'], lease);
  let active = true, receiptCount = 0, first;
  const assertCurrent = () => {
    controller.signal.throwIfAborted();
    reservation.invalidated.throwIfAborted();
    assert.equal(active, true, 'DELETION_FIXTURE_OWNER_ENDED');
    leaseCurrent();
  };
  const assertOwned = async () => { assertCurrent(); await reservation.assertOwned(); assertCurrent(); };
  const publish = WorkspaceDeletionJournalStore.prototype.publish;
  const advance = WorkspaceDeletionJournalStore.prototype.advance;
  WorkspaceDeletionJournalStore.prototype.publish = async function (...args) {
    const result = await publish.apply(this, args);
    await holdAtCut(config.cut, 'authorized', assertCurrent);
    return result;
  };
  WorkspaceDeletionJournalStore.prototype.advance = async function (...args) {
    if (config.cut === 'originalFailure' && args[0].phase === 'purged') {
      throw new Error('SYNTHETIC_W74_DELETION_ORIGINAL', { cause: new Error('SYNTHETIC_W74_DELETION_CAUSE') });
    }
    if (args[0].phase === 'purged') await holdAtCut(config.cut, 'payloadAbsent', assertCurrent);
    await holdAtCut(config.cut, `before:${args[0].phase}`, assertCurrent);
    const result = await advance.apply(this, args);
    await holdAtCut(config.cut, `after:${args[0].phase}`, assertCurrent);
    if (args[0].phase === 'registryPublished') await holdAtCut(config.cut, 'registryPublished', assertCurrent);
    return result;
  };
  try {
    const registry = new WorkspaceRegistryStore({ installationRoot: config.root, filePath: join(config.root, WORKSPACE_REGISTRY_FILE_NAME) });
    // The fixture has no backend, SQLite, Electron or child-spawning module.
    const command = createWorkspaceDeletionCommand({ userDataRoot: config.root, registry, assertWritersAbsent: assertOwned });
    if (config.mode === 'publish') {
      const selected = await captureDeletionTarget({ installationRoot: config.root, workspaceId: config.workspaceId,
        typedLabel: config.label, registry, assertAuthority: assertCurrent });
      await command.publish(assertCurrent, assertOwned, selected.target,
        { operationId: config.operationId, target: selected.target, backupDisposition: 'explicitDataLoss' }, () => selected.assertCurrent());
    }
    const completion = await command.resume(config.operationId, { assertCurrent, assertOwned, recordRemoved(receipt) {
      assertCurrent(); assert.equal(receipt.status, 'removed');
      assert.equal(receipt.journal.phase, 'registryPublished');
      assert.equal(++receiptCount, 1, 'DELETION_FIXTURE_DUPLICATE_RECEIPT');
    } });
    await send({ event: 'completed', pid: process.pid, receiptCount, completion });
  } catch (error) { first = error; }
  finally {
    active = false;
    WorkspaceDeletionJournalStore.prototype.publish = publish;
    WorkspaceDeletionJournalStore.prototype.advance = advance;
    for (const close of [() => lease.release(), () => reservation.release()]) {
      try { await close(); }
      catch (error) { first = first === undefined ? error : new AggregateError([first, error], 'DELETION_FIXTURE_CLOSE_FAILED', { cause: first }); }
    }
  }
  if (first !== undefined) throw first;
}

process.once('message', async config => {
  try {
    const { workspaceDeletionPhases } = await import('../src/workspaces/deletion/workspaceDeletionJournalCodec.ts');
    assert.deepEqual(Object.keys(config).sort(), ['buildInfo', 'cut', 'label', 'mode', 'operationId', 'releaseInfo', 'root', 'testId', 'workspaceId']);
    assert.ok(['publish', 'resume', 'resumeCold'].includes(config.mode));
    assert.ok(['authorized', 'payloadAbsent', 'registryPublished', 'originalFailure', null].includes(config.cut) ||
      workspaceDeletionPhases.slice(1).some(phase => config.cut === `before:${phase}` || config.cut === `after:${phase}`));
    assert.equal(typeof config.testId, 'string');
    await run(config);
  } catch (error) {
    // Retain the source before returning only the closed fixture result over IPC.
    const { createRunnerFailureSink } = await import('../../../test-reporters/runnerFailureEvidence.mjs');
    const sink = createRunnerFailureSink();
    sink.record({ runner: 'node', phase: 'workspaceDeletionProcess', error,
      testName: 'W7.4 real process continuation', testId: `${config?.testId ?? 'unknown'}:${config?.mode ?? 'unknown'}`,
      file: import.meta.url, attempt: 0, retryCount: 0, repeatCount: 0 });
    await sink.flush();
    process.exitCode = 1;
    if (process.connected) await send({ event: 'failed', pid: process.pid }).catch(() => {});
  } finally {
    hooks.deregister();
    if (process.connected) process.disconnect();
  }
});
