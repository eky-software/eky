import { expect, it, type TestContext } from 'vitest';
import { captureWorkspaceRemnantParents } from './workspaceRemnantParentSelection.js';

const ancestors = ['synthetic-root', 'synthetic-root/child'] as const;
const phases = ['capture', 'revalidation'] as const;
const failures = [
  { path: ancestors[0], code: 'EIO' },
  { path: ancestors[1], code: 'EIO' },
  { path: ancestors[0], code: 'EACCES' },
  { path: ancestors[1], code: 'EACCES' },
  { path: ancestors[0], code: 'ENOENT' },
] as const;

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}

function fixture(test: TestContext) {
  let active = true, failPath: string | undefined;
  const lost = new Error('SYNTHETIC_PARENT_OWNER_LOST');
  const entered = deferred<void>(), native = deferred<string>();
  const jobs: Promise<unknown>[] = [], reads: string[] = [];
  const assertAuthority = () => { test.signal.throwIfAborted(); if (!active) throw lost; };
  const authority = { assertAuthority,
    async assertExternalSelection() { assertAuthority(); },
    async assertWritersAbsent() { assertAuthority(); } };
  const identity = async (path: string, assertCurrent: () => void) => {
    assertCurrent(); reads.push(path);
    if (path === failPath) { entered.resolve(); return native.promise; }
    return 'identity:' + path;
  };
  const track = <T>(work: Promise<T>) => { jobs.push(work); return work; };
  test.onTestFinished(async () => {
    active = false; native.reject(lost); await Promise.allSettled(jobs);
  });
  return { authority, reads, entered, native, lost, track,
    capture: () => track(captureWorkspaceRemnantParents(ancestors, authority, { directoryIdentity: identity })),
    failAt(path: string) { failPath = path; },
    expire() { active = false; },
  };
}

it.for(phases.flatMap(phase => failures.map(failure => ({ phase, ...failure }))))(
  'keeps rejected $code identity at $path before later owner loss during $phase', async ({ phase, path, code }, test) => {
    const f = fixture(test), first = Object.assign(new Error('SYNTHETIC_PARENT_NATIVE_FAILURE'), { code });
    const selected = phase === 'revalidation' ? await f.capture() : undefined;
    f.failAt(path);
    const pending = selected === undefined ? f.capture() : f.track(selected.assertSelected());
    const outcome = pending.then(() => ({ completed: true as const }), error => ({ completed: false as const, error }));
    await f.entered.promise;
    // Rejection is queued first; the authority changes before its catch resumes.
    f.native.reject(first); f.expire();
    expect(await outcome).toEqual({ completed: false, error: first });
    expect((await outcome as { error: unknown }).error).toBe(first);
    expect(f.reads.at(-1)).toBe(path);
  },
);

it.for(phases)('does not turn expected descendant absence into authority during $0', async (phase, test) => {
  const f = fixture(test), selected = phase === 'revalidation' ? await f.capture() : undefined;
  f.failAt(ancestors[1]);
  const pending = selected === undefined ? f.capture() : f.track(selected.assertSelected());
  const outcome = pending.then(() => undefined, error => error);
  await f.entered.promise;
  f.native.reject(Object.assign(new Error('SYNTHETIC_EXPECTED_ABSENCE'), { code: 'ENOENT' })); f.expire();
  expect(await outcome).toBe(f.lost);
});

it.for(phases)('checks current authority after a successful pending identity during $0', async (phase, test) => {
  const f = fixture(test), selected = phase === 'revalidation' ? await f.capture() : undefined;
  f.failAt(ancestors[1]);
  const pending = selected === undefined ? f.capture() : f.track(selected.assertSelected());
  const outcome = pending.then(() => undefined, error => error);
  await f.entered.promise;
  f.native.resolve('identity:' + ancestors[1]); f.expire();
  expect(await outcome).toBe(f.lost);
});

it('rejects expired authority before starting an identity read', async test => {
  const f = fixture(test); f.expire();
  await expect(f.capture()).rejects.toBe(f.lost);
  expect(f.reads).toEqual([]);
});

it('retains ordinary descendant absence and pins the complete ancestor vector', async test => {
  const f = fixture(test), missing = Object.assign(new Error('SYNTHETIC_EXPECTED_ABSENCE'), { code: 'ENOENT' });
  const reads = { async directoryIdentity(path: string, assertCurrent: () => void) {
    assertCurrent(); if (path === ancestors[1]) throw missing; return 'identity:' + path;
  } };
  const selected = await f.track(captureWorkspaceRemnantParents(ancestors, f.authority, reads));
  expect(selected.identities).toEqual(['identity:' + ancestors[0], null]);
  await f.track(selected.assertSelected());
});
