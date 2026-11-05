import { afterEach, expect, it, vi, type TestContext } from 'vitest';
import { workspaceInspectionRemnantReads } from './workspaceInspectionRemnantAbsence.js';

const io = vi.hoisted(() => ({ stat: undefined as (() => Promise<unknown>) | undefined, calls: 0 }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, async lstat(...args: Parameters<typeof actual.lstat>) {
    if (io.stat !== undefined) { io.calls++; return io.stat(); }
    return actual.lstat(...args);
  } };
});
afterEach(() => { io.stat = undefined; io.calls = 0; });

function fixture(test: TestContext) {
  let active = true, resolve!: (value: unknown) => void, reject!: (error: unknown) => void;
  const lost = new Error('SYNTHETIC_ABSENCE_OWNER_LOST');
  const stat = new Promise<unknown>((accept, fail) => { resolve = accept; reject = fail; });
  void stat.catch(() => undefined);
  io.stat = () => stat;
  const work: Promise<unknown>[] = [];
  test.onTestFinished(async () => { active = false; reject(lost); await Promise.allSettled(work); });
  return { lost, resolve, reject, expire() { active = false; },
    start() {
      const result = workspaceInspectionRemnantReads.assertAbsent('synthetic-absence-root', () => {
        test.signal.throwIfAborted(); if (!active) throw lost;
      });
      work.push(result); void result.catch(() => undefined); return result;
    } };
}

it.for(['EIO', 'EACCES'])('retains already rejected %s before later authority loss', async (code, test) => {
  const f = fixture(test), first = Object.assign(new Error('SYNTHETIC_ABSENCE_NATIVE_FAILURE'), { code });
  const outcome = f.start().then(() => undefined, error => error);
  expect(io.calls).toBe(1);
  // The read rejects first; authority changes before its catch resumes.
  f.reject(first); f.expire();
  expect(await outcome).toBe(first);
});

it('does not turn an expected absence into authority after revocation', async test => {
  const f = fixture(test), outcome = f.start().then(() => undefined, error => error);
  f.reject(Object.assign(new Error('SYNTHETIC_ABSENT'), { code: 'ENOENT' })); f.expire();
  expect(await outcome).toBe(f.lost);
});

it('checks current authority after a successful stat', async test => {
  const f = fixture(test), outcome = f.start().then(() => undefined, error => error);
  f.resolve({}); f.expire();
  expect(await outcome).toBe(f.lost);
});

it('keeps ordinary expected absence successful without replacing its owner checks', async test => {
  const f = fixture(test), pending = f.start();
  f.reject(Object.assign(new Error('SYNTHETIC_ABSENT'), { code: 'ENOENT' }));
  await expect(pending).resolves.toBeUndefined();
});

it('still rejects an existing payload after an ordinary successful stat', async test => {
  const f = fixture(test), pending = f.start(); f.resolve({});
  await expect(pending).rejects.toThrow();
});

it('does not start a stat when authority is already invalid', async test => {
  const f = fixture(test); f.expire();
  await expect(f.start()).rejects.toBe(f.lost);
  expect(io.calls).toBe(0);
});

it('joins the returned stat promise before rejecting a revoked owner', async test => {
  const f = fixture(test);
  let settled = false;
  const outcome = f.start().then(() => undefined, error => error).finally(() => { settled = true; });
  f.expire(); await Promise.resolve();
  expect(settled).toBe(false);
  f.reject(Object.assign(new Error('SYNTHETIC_ABSENT'), { code: 'ENOENT' }));
  expect(await outcome).toBe(f.lost);
  expect(settled).toBe(true);
});
