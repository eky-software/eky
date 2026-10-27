import { describe, expect, it, vi } from 'vitest';

import { InMemoryWorkspaceMaintenanceLease, type WorkspaceMaintenancePurpose } from '../maintenance/workspaceMaintenanceLease.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { DeferredWorkspaceRuntimeRelaunch } from './deferredWorkspaceRuntimeRelaunch.js';
import { MainOwnedSelectorWorkspaceLifecycle } from './mainOwnedSelectorWorkspaceLifecycle.js';

const workspaceId = validateWorkspaceId('11111111-1111-4111-8111-111111111111');

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture(purpose: WorkspaceMaintenancePurpose | undefined = 'create') {
  const lease = new InMemoryWorkspaceMaintenanceLease();
  const handle = purpose === undefined ? undefined : await lease.acquire(purpose);
  const current = { selector: true, main: true };
  const assertSelectorCurrent = vi.fn(() => {
    if (!current.selector) throw new Error('synthetic selector expired');
  });
  const reservation = {
    assertMainCurrent: vi.fn(() => { if (!current.main) throw new Error('synthetic child owns reservation'); }),
    assertMainOwned: vi.fn(async () => { if (!current.main) throw new Error('synthetic reservation missing'); }),
  };
  const relaunch = vi.fn();
  const runtimeRelaunch = new DeferredWorkspaceRuntimeRelaunch(relaunch);
  const options = { assertSelectorCurrent, reservation, maintenanceLease: lease, runtimeRelaunch };
  const lifecycle = new MainOwnedSelectorWorkspaceLifecycle(options);
  return { lifecycle, lease, handle, current, options, reservation, runtimeRelaunch, relaunch };
}

async function stopped() {
  const f = await fixture();
  await f.lifecycle.quiesceWrites(null);
  await f.lifecycle.stopAndProveHandlesClosed(null);
  return f;
}

describe('MainOwnedSelectorWorkspaceLifecycle', () => {
  it.each(['create', 'import', 'switch', 'delete'] as const)('requires real ownership for %s and defers relaunch to service completion', async purpose => {
    const f = await fixture(purpose);
    await f.lifecycle.quiesceWrites(null);
    await expect(f.lifecycle.stopAndProveHandlesClosed(null)).resolves.toEqual({ handlesClosed: true });
    await f.lifecycle.assertNoActiveWorkspaceRuntime();
    await f.lifecycle.ensurePreviousWorkspaceRunning(null);
    expect(f.reservation.assertMainOwned).toHaveBeenCalledTimes(4);
    expect(f.runtimeRelaunch.isRequested()).toBe(true);
    expect(f.relaunch).not.toHaveBeenCalled();
    await f.handle?.release();
    f.runtimeRelaunch.complete();
    expect(f.relaunch).toHaveBeenCalledOnce();
  });

  it.each(['backup', 'replace', 'adopt', 'rename', 'update', 'restore'] as const)('rejects an unrelated %s lease before physical proof', async purpose => {
    const f = await fixture(purpose);
    await expect(f.lifecycle.quiesceWrites(null)).rejects.toThrow('WORKSPACE_MAINTENANCE_BUSY');
    expect(f.reservation.assertMainOwned).not.toHaveBeenCalled();
    expect(f.runtimeRelaunch.isRequested()).toBe(false);
  });

  it('rejects a missing lease and does not later bind a different operation', async () => {
    const f = await fixture();
    await f.handle?.release();
    await expect(f.lifecycle.quiesceWrites(null)).rejects.toThrow('WORKSPACE_MAINTENANCE_BUSY');
    await f.lease.acquire('create');
    await expect(f.lifecycle.quiesceWrites(null)).rejects.toThrow('WORKSPACE_MAINTENANCE_BUSY');
    expect(f.reservation.assertMainOwned).not.toHaveBeenCalled();
  });

  it.each(['missing', 'replaced'] as const)('rejects a %s original lease before the first microtask', async mode => {
    const f = await fixture();
    if (mode === 'missing') await f.handle?.release();
    const pending = f.lifecycle.quiesceWrites(null);
    if (mode === 'replaced') void f.handle?.release();
    const successor = f.lease.acquire('switch');
    try {
      await expect(pending).rejects.toThrow('WORKSPACE_MAINTENANCE_BUSY');
      expect(f.reservation.assertMainOwned).not.toHaveBeenCalled();
      expect(f.runtimeRelaunch.isRequested()).toBe(false);
    } finally { await (await successor).release(); }
  });

  it('publishes preparation before an authority callback can re-enter', async () => {
    const f = await fixture();
    let nested: Promise<void> | undefined;
    f.options.assertSelectorCurrent.mockImplementationOnce(() => {
      nested = f.lifecycle.quiesceWrites(null);
    });
    await f.lifecycle.quiesceWrites(null);
    expect(nested).toBeDefined();
    await nested;
    expect(f.reservation.assertMainOwned).toHaveBeenCalledOnce();
  });

  it('rejects a business identity at every identity-bearing port', async () => {
    const f = await fixture();
    await expect(f.lifecycle.quiesceWrites(workspaceId)).rejects.toThrow('WORKSPACE_RUNTIME_IDENTITY_MISMATCH');
    await expect(f.lifecycle.stopAndProveHandlesClosed(workspaceId)).rejects.toThrow('WORKSPACE_RUNTIME_IDENTITY_MISMATCH');
    await expect(f.lifecycle.ensurePreviousWorkspaceRunning(workspaceId)).rejects.toThrow('WORKSPACE_RUNTIME_IDENTITY_MISMATCH');
    expect(f.reservation.assertMainOwned).not.toHaveBeenCalled();
  });

  it('does not infer absence or restart permission before completed preparation and stop', async () => {
    const f = await fixture();
    await expect(f.lifecycle.stopAndProveHandlesClosed(null)).rejects.toThrow('WORKSPACE_RUNTIME_LIFECYCLE_INVALID');
    await expect(f.lifecycle.assertNoActiveWorkspaceRuntime()).rejects.toThrow('WORKSPACE_RUNTIME_STILL_ACTIVE');
    await expect(f.lifecycle.ensurePreviousWorkspaceRunning(null)).rejects.toThrow('WORKSPACE_RUNTIME_STILL_ACTIVE');
    await f.lifecycle.quiesceWrites(null);
    await expect(f.lifecycle.assertNoActiveWorkspaceRuntime()).rejects.toThrow('WORKSPACE_RUNTIME_STILL_ACTIVE');
    expect(f.runtimeRelaunch.isRequested()).toBe(false);
  });

  it('shares pending preparation without reporting premature absence', async () => {
    const f = await fixture();
    const entered = deferred();
    const gate = deferred();
    f.reservation.assertMainOwned.mockImplementationOnce(async () => { entered.resolve(); await gate.promise; });
    const first = f.lifecycle.quiesceWrites(null);
    const second = f.lifecycle.quiesceWrites(null);
    await entered.promise;
    try {
      await expect(f.lifecycle.stopAndProveHandlesClosed(null)).rejects.toThrow('WORKSPACE_RUNTIME_LIFECYCLE_INVALID');
      await expect(f.lifecycle.assertNoActiveWorkspaceRuntime()).rejects.toThrow('WORKSPACE_RUNTIME_STILL_ACTIVE');
      expect(f.reservation.assertMainOwned).toHaveBeenCalledOnce();
    } finally { gate.resolve(); await Promise.allSettled([first, second]); }
    await Promise.all([first, second]);
    await expect(f.lifecycle.stopAndProveHandlesClosed(null)).resolves.toEqual({ handlesClosed: true });
  });

  it('checks a fresh physical reservation after each candidate handoff', async () => {
    const f = await stopped();
    // A reclaimed reservation still needs a fresh physical ownership check.
    const error = new Error('synthetic reclaimed reservation no longer held');
    f.reservation.assertMainOwned.mockRejectedValueOnce(error);
    await expect(f.lifecycle.assertNoActiveWorkspaceRuntime()).rejects.toBe(error);
    await expect(f.lifecycle.ensurePreviousWorkspaceRunning(null)).rejects.toBe(error);
    expect(f.runtimeRelaunch.isRequested()).toBe(false);
  });

  it('rejects an in-flight child instead of treating a missing backend as absence', async () => {
    const f = await stopped();
    f.current.main = false;
    await expect(f.lifecycle.assertNoActiveWorkspaceRuntime()).rejects.toThrow('synthetic child owns reservation');
    f.current.main = true;
    await expect(f.lifecycle.ensurePreviousWorkspaceRunning(null)).rejects.toThrow('synthetic child owns reservation');
    expect(f.runtimeRelaunch.isRequested()).toBe(false);
  });

  for (const stage of ['quiesce', 'stop', 'absence', 'return'] as const) {
    for (const purpose of ['create', 'delete'] as const) {
    it.each(['selector', 'lease', 'reservation'] as const)(`rejects %s loss during ${stage} proof for ${purpose}`, async loss => {
      const f = await fixture(purpose);
      if (stage !== 'quiesce') await f.lifecycle.quiesceWrites(null);
      if (stage === 'absence' || stage === 'return') await f.lifecycle.stopAndProveHandlesClosed(null);
      const entered = deferred();
      const gate = deferred();
      f.reservation.assertMainOwned.mockImplementationOnce(async () => { entered.resolve(); await gate.promise; });
      const pending = stage === 'quiesce' ? f.lifecycle.quiesceWrites(null)
        : stage === 'stop' ? f.lifecycle.stopAndProveHandlesClosed(null)
        : stage === 'absence' ? f.lifecycle.assertNoActiveWorkspaceRuntime()
        : f.lifecycle.ensurePreviousWorkspaceRunning(null);
      const outcome = pending.then(() => ({ ok: true as const }), error => ({ ok: false as const, error }));
      await entered.promise;
      try {
        if (loss === 'selector') f.current.selector = false;
        if (loss === 'reservation') f.current.main = false;
        if (loss === 'lease') { await f.handle?.release(); await f.lease.acquire(purpose); }
      } finally { gate.resolve(); }
      const result = await outcome;
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected rejected ownership proof');
      f.current.selector = true;
      f.current.main = true;
      await expect(f.lifecycle.assertNoActiveWorkspaceRuntime()).rejects.toBe(result.error);
      await expect(f.lifecycle.ensurePreviousWorkspaceRunning(null)).rejects.toBe(result.error);
      expect(f.runtimeRelaunch.isRequested()).toBe(false);
    });
    }
  }

  it('does not automatically return from stopped deletion preparation without an explicit selection', async () => {
    const f = await fixture('delete');
    await f.lifecycle.quiesceWrites(null);
    await f.lifecycle.stopAndProveHandlesClosed(null);
    f.runtimeRelaunch.complete();
    expect(f.runtimeRelaunch.isRequested()).toBe(false);
    expect(f.relaunch).not.toHaveBeenCalled();
    await expect(f.lifecycle.ensurePreviousWorkspaceRunning(workspaceId)).rejects.toThrow('WORKSPACE_RUNTIME_IDENTITY_MISMATCH');
    await f.lifecycle.ensurePreviousWorkspaceRunning(null);
    expect(f.relaunch).not.toHaveBeenCalled();
    await f.handle?.release();
    f.runtimeRelaunch.complete();
    expect(f.relaunch).toHaveBeenCalledOnce();
  });

  it('retains the first physical proof failure and prevents subsequent restart', async () => {
    const f = await fixture();
    const error = new Error('synthetic first ownership failure');
    f.reservation.assertMainOwned.mockRejectedValueOnce(error);
    await expect(f.lifecycle.quiesceWrites(null)).rejects.toBe(error);
    await expect(f.lifecycle.stopAndProveHandlesClosed(null)).rejects.toBe(error);
    await expect(f.lifecycle.quiesceWrites(null)).rejects.toBe(error);
    await expect(f.lifecycle.ensurePreviousWorkspaceRunning(null)).rejects.toBe(error);
    expect(f.reservation.assertMainOwned).toHaveBeenCalledOnce();
    expect(f.runtimeRelaunch.isRequested()).toBe(false);
  });

  it('captures the original owner callbacks instead of trusting mutable options', async () => {
    const f = await fixture();
    Object.assign(f.options, {
      assertSelectorCurrent() {},
      reservation: { assertMainCurrent() {}, assertMainOwned: async () => {} },
    });
    f.current.selector = false;
    await expect(f.lifecycle.quiesceWrites(null)).rejects.toThrow('synthetic selector expired');
    expect(f.reservation.assertMainOwned).not.toHaveBeenCalled();
  });

  it('rejects an asynchronous lifetime guard instead of accepting its pending result', async () => {
    const f = await fixture();
    f.options.assertSelectorCurrent.mockImplementation(() => Promise.reject(new Error('synthetic late guard')));
    await expect(f.lifecycle.quiesceWrites(null)).rejects.toThrow('WORKSPACE_RUNTIME_LIFECYCLE_INVALID');
    expect(f.reservation.assertMainOwned).not.toHaveBeenCalled();
    expect(f.runtimeRelaunch.isRequested()).toBe(false);
  });
});
