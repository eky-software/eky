import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceRuntimeStopError } from '../src/workspaces/runtime/mainOwnedActiveWorkspaceLifecycle.js';
import { shutdownBeforeWorkspaceProof } from './workspaceProofInitialShutdown.js';

describe('workspace proof initial shutdown evidence', () => {
  it('preserves the original completed shutdown without extra work', async () => {
    const shutdown = vi.fn().mockResolvedValue(undefined);
    await expect(shutdownBeforeWorkspaceProof({ shutdown })).resolves.toBeUndefined();
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['secrets', 'operationFailed'], ['quiescence', 'operationFailed'],
    ['backend', 'gracefulTimeout'], ['backend', 'notGraceful'],
  ] as const)('keeps %s/%s through message-only transport', async (phase, reason) => {
    const runtime = new WorkspaceRuntimeStopError({ phase, reason });
    const original = new Error('DESKTOP_SHUTDOWN_FAILED', {
      cause: Object.freeze({ runtimeFailure: runtime, cleanupFailures: ['brokers'] }),
    });
    expect(new Error(original.message).message).not.toContain(`${phase}/${reason}`);
    const shutdown = vi.fn().mockRejectedValue(original);
    const failure = await shutdownBeforeWorkspaceProof({ shutdown }).catch(error => error as Error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).cause).toBe(original);
    // Models the observed transport limitation, not a new Electron E2E proof.
    const transported = new Error((failure as Error).message);
    expect(transported.cause).toBeUndefined();
    expect(transported.message).toBe(`E2E_INITIAL_SHUTDOWN_FAILED: ${phase}/${reason}`);
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(original.cause).toEqual({ runtimeFailure: runtime, cleanupFailures: ['brokers'] });
  });

  it('handles the direct owned cause without recursing into arbitrary objects', async () => {
    const original = new Error('DESKTOP_SHUTDOWN_FAILED', {
      cause: new WorkspaceRuntimeStopError({ phase: 'backend', reason: 'unsuccessfulExit' }),
    });
    await expect(shutdownBeforeWorkspaceProof({ shutdown: async () => { throw original; } }))
      .rejects.toThrow('E2E_INITIAL_SHUTDOWN_FAILED: backend/unsuccessfulExit');
  });

  it.each([undefined, new Error('unknown failure'), { message: 'unknown' }])(
    'retains an unknown original rejection unchanged', async original => {
      await expect(shutdownBeforeWorkspaceProof({ shutdown: async () => { throw original; } }))
        .rejects.toBe(original);
    },
  );

  it('does not invoke a cause accessor or expose unrelated cause fields', async () => {
    const read = vi.fn(() => { throw new Error('must not read'); });
    const original = new Error('DESKTOP_SHUTDOWN_FAILED', { cause: {
      get runtimeFailure() { return read(); }, password: 'excluded-synthetic-value',
    } });
    await expect(shutdownBeforeWorkspaceProof({ shutdown: async () => { throw original; } }))
      .rejects.toBe(original);
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    ['async function runFirstStartProof(', 'const { runWorkspaceFirstStartMigrationProof }'],
    ['async runWorkspaceActivationMigrationProof(', 'return runWorkspaceActivationMigrationProof('],
  ])('is wired before the backend-absence check in %s', async (entry, proofCall) => {
    const source = await readFile(new URL('./electronE2eEntrypoint.ts', import.meta.url), 'utf8');
    const start = source.indexOf(entry);
    const end = source.indexOf(proofCall, start) + proofCall.length;
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const body = source.slice(start, end);
    expect(body).toContain('await shutdownBeforeWorkspaceProof(lifecycle);');
    expect(body).not.toContain('await lifecycle.shutdown();');
    expect(body.indexOf('shutdownBeforeWorkspaceProof(lifecycle)'))
      .toBeLessThan(body.indexOf('backendController.isRunning()'));
    expect(body.indexOf('backendController.isRunning()'))
      .toBeLessThan(body.indexOf(proofCall));
  });
});
