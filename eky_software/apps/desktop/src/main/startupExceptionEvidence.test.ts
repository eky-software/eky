import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runSafeDesktopStartup } from './earlyStartup.js';
import { createStartupExceptionCapture, STARTUP_EXCEPTION_CONTROL,
  STARTUP_EXCEPTION_DELIVERY_TIMEOUT_MS, startupExceptionDirectory,
  validateStartupExceptionEvidence } from './startupExceptionEvidence.js';

vi.mock('node:fs/promises', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs/promises')>(),
  writeFile: vi.fn(),
}));

const roots: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function fixture() {
  const tempPath = realpathSync.native(mkdtempSync(join(tmpdir(), 'eky-exception-wait-')));
  roots.push(tempPath);
  const token = 'b'.repeat(64);
  const root = startupExceptionDirectory(tempPath, token);
  const userDataPath = join(root, 'user-data');
  mkdirSync(userDataPath, { recursive: true });
  mkdirSync(join(root, 'result'));
  writeFileSync(join(root, 'result', STARTUP_EXCEPTION_CONTROL), JSON.stringify({
    schemaVersion: 1, scenarioRunNonce: token, appVersion: '0.2.81', buildRevision: 'a'.repeat(40),
  }));
  const input = { enabled: true, tempPath, userDataPath, token, appVersion: '0.2.81',
    buildRevision: 'a'.repeat(40), runtimeInstanceId: '12345678-1234-4abc-8abc-1234567890ab' };
  return { input, capture: createStartupExceptionCapture(input)! };
}

describe('bounded synthetic startup exception delivery', () => {
  it('serializes the first migration decision cause with redaction instead of later safe wrappers', async () => {
    vi.mocked(writeFile).mockResolvedValue();
    const { capture } = fixture();
    const session = 'd'.repeat(64);
    capture(new Error(`synthetic migration detail ${session}`, {
      cause: new Error('synthetic recovery cause'),
    }), 'runtimeStartup', [session]);
    capture(new Error('BACKEND_MIGRATION_STARTUP_GATE_FAILED'), 'runtimeStartup', [session]);
    capture(new Error('DESKTOP_START_FAILED'), 'compositionStartup', [session]);
    expect(await capture.waitForDelivery()).toBe('recorded');
    expect(writeFile).toHaveBeenCalledOnce();
    const serialized = String(vi.mocked(writeFile).mock.calls[0]![1]);
    const evidence = validateStartupExceptionEvidence(JSON.parse(serialized));
    expect(evidence.stage).toBe('runtimeStartup');
    expect(evidence.chain.map(part => part.message))
      .toEqual(['synthetic migration detail [redacted]', 'synthetic recovery cause']);
    expect(serialized).not.toContain(session);
    expect(serialized).not.toContain('BACKEND_MIGRATION_STARTUP_GATE_FAILED');
    expect(serialized).not.toContain('DESKTOP_START_FAILED');
  });

  it('does not write or start a timer without a failure, or activate for normal startup', async () => {
    vi.useFakeTimers();
    const { input, capture } = fixture();
    expect(createStartupExceptionCapture({ ...input, enabled: false })).toBeUndefined();
    expect(await capture.waitForDelivery()).toBe('notObserved');
    expect(writeFile).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('finishes as soon as the exclusive write settles and clears the deadline timer', async () => {
    vi.useFakeTimers();
    let complete!: () => void;
    vi.mocked(writeFile).mockReturnValue(new Promise<void>(resolve => { complete = resolve; }));
    const { capture } = fixture();
    capture(new Error('synthetic original'), 'earlyStartup');
    const delivery = capture.waitForDelivery();
    expect(vi.getTimerCount()).toBe(1);
    complete();
    expect(await delivery).toBe('recorded');
    expect(vi.getTimerCount()).toBe(0);
    expect(writeFile).toHaveBeenCalledTimes(1);
  });

  it('bounds a stalled write, preserves its first failure and never waits a second deadline', async () => {
    vi.useFakeTimers();
    vi.mocked(writeFile).mockReturnValue(new Promise<void>(() => undefined));
    const { capture } = fixture();
    capture(new Error('synthetic first'), 'earlyStartup');
    capture(new Error('synthetic later'), 'earlyStartup');
    const delivery = capture.waitForDelivery();
    expect(capture.waitForDelivery()).toBe(delivery);
    let settled = false;
    void delivery.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(STARTUP_EXCEPTION_DELIVERY_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await delivery).toBe('timedOut');
    expect(vi.getTimerCount()).toBe(0);
    expect(await capture.waitForDelivery()).toBe('timedOut');
    expect(writeFile).toHaveBeenCalledTimes(1);
  });

  it('does not replace the startup code or prevent exit after a private write failure', async () => {
    vi.useFakeTimers();
    vi.mocked(writeFile).mockRejectedValue(new Error('private writer failure'));
    const { capture } = fixture();
    const exitApplication = vi.fn();
    let delivery;
    const onFailure = vi.fn(async () => { delivery = await capture.waitForDelivery(); });
    await runSafeDesktopStartup({
      exitApplication, loadRuntime: async () => { throw new Error('synthetic original'); },
      observeStartupException: error => capture(error, 'earlyStartup'), onFailure,
      startRuntime: async () => undefined, waitUntilReady: async () => undefined,
    });
    expect(delivery).toBe('failed');
    expect(onFailure).toHaveBeenCalledWith('DESKTOP_START_FAILED');
    expect(exitApplication).toHaveBeenCalledWith(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('still exits with the original safe failure after the private delivery deadline', async () => {
    vi.useFakeTimers();
    vi.mocked(writeFile).mockReturnValue(new Promise<void>(() => undefined));
    const { capture } = fixture();
    const exitApplication = vi.fn();
    let delivery;
    const onFailure = vi.fn(async () => { delivery = await capture.waitForDelivery(); });
    const completed = runSafeDesktopStartup({
      exitApplication, loadRuntime: async () => { throw new Error('BACKEND_READINESS_TIMEOUT'); },
      observeStartupException: error => capture(error, 'earlyStartup'), onFailure,
      startRuntime: async () => undefined, waitUntilReady: async () => undefined,
    });
    await vi.advanceTimersByTimeAsync(STARTUP_EXCEPTION_DELIVERY_TIMEOUT_MS - 1);
    expect(exitApplication).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await completed;
    expect(delivery).toBe('timedOut');
    expect(onFailure).toHaveBeenCalledWith('BACKEND_READINESS_TIMEOUT');
    expect(exitApplication).toHaveBeenCalledWith(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
