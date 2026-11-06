import type { ReadStream } from 'node:fs';
import { lstat, link, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi, type TestContext } from 'vitest';

import type { WorkspaceLegacyAdoptionMutationAuthority } from './workspaceLegacyAdoptionMutationAuthority.js';
import { deriveWorkspaceLegacyAdoptionPaths } from './workspaceLegacyAdoptionPaths.js';
import { WorkspaceLegacyAdoptionRootSelection } from './workspaceLegacyAdoptionRootSelection.js';
import { NodeWorkspaceLegacyAdoptionRootStore } from './workspaceLegacyAdoptionRootStore.js';
import { TEST_ADOPTION_OPERATION_ID, TEST_ADOPTION_WORKSPACE_ID } from './workspaceLegacyAdoptionTestSupport.js';

const hooks = vi.hoisted(() => ({
  afterEffect: undefined as ((kind: 'mkdir' | 'rename' | 'rm', path: string) => Promise<void>) | undefined,
  beforeStat: undefined as ((path: string) => Promise<void>) | undefined,
  beforeMkdir: undefined as ((path: string) => Promise<void>) | undefined,
  stream: undefined as ((stream: ReadStream, path: string) => void) | undefined,
}));

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual,
    async mkdir(...args: Parameters<typeof actual.mkdir>) {
      await hooks.beforeMkdir?.(String(args[0]));
      const result = await actual.mkdir(...args);
      await hooks.afterEffect?.('mkdir', String(args[0]));
      return result;
    },
    async rename(...args: Parameters<typeof actual.rename>) {
      await actual.rename(...args);
      await hooks.afterEffect?.('rename', String(args[0]));
    },
    async rm(...args: Parameters<typeof actual.rm>) {
      await actual.rm(...args);
      await hooks.afterEffect?.('rm', String(args[0]));
    },
    async lstat(...args: Parameters<typeof actual.lstat>) {
      await hooks.beforeStat?.(String(args[0]));
      return actual.lstat(...args);
    },
  };
});

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, createReadStream(...args: Parameters<typeof actual.createReadStream>) {
    const stream = actual.createReadStream(...args);
    hooks.stream?.(stream, String(args[0]));
    return stream;
  } };
});

afterEach(() => {
  hooks.afterEffect = undefined;
  hooks.beforeStat = undefined;
  hooks.beforeMkdir = undefined;
  hooks.stream = undefined;
});

describe('retained adoption root receipts', () => {
  it.for(['empty', 'candidate', 'published'] as const)('proves recovered payload absence only after its own %s cleanup', async (branch, context) => {
    const f = await fixture(context);
    const view = (await f.observe()).forPhase(f.owner);
    const store = new NodeWorkspaceLegacyAdoptionRootStore(view);
    if (branch !== 'empty') await store.prepareCandidate(f.paths, 'legacy');
    if (branch === 'published') await store.publishCandidate(f.paths);
    if (branch === 'candidate') await store.discardRecoveryCandidateMatchingLegacy(f.paths);
    if (branch === 'published') await store.discardUnregisteredPublishedRootMatchingLegacy(f.paths);
    await store.discardEmptyRecoveryOperation(f.paths);
    f.owner.assertCurrent.mockRejectedValue(new Error('readonly leaf must not re-enter metadata'));
    await view.assertRecoveredPayloadAbsent();
    await f.assertPreserved();
    expect(f.owner.onUncertain).not.toHaveBeenCalled();
  });

  it.for(['candidate', 'published', 'unacknowledgedRemoval', 'reappeared'] as const)(
    'does not turn %s into recovery payload absence', async (branch, context) => {
      const f = await fixture(context);
      const view = (await f.observe()).forPhase(f.owner);
      const store = new NodeWorkspaceLegacyAdoptionRootStore(view);
      await store.prepareCandidate(f.paths, 'legacy');
      if (branch === 'published') await store.publishCandidate(f.paths);
      if (branch === 'unacknowledgedRemoval') await rm(f.paths.operationRoot, { recursive: true });
      if (branch === 'reappeared') {
        await store.discardRecoveryCandidateMatchingLegacy(f.paths);
        await mkdir(f.paths.operationRoot, { mode: 0o700 });
      }
      const contents = await readdir(f.paths.operationsRoot);
      await expect(view.assertRecoveredPayloadAbsent()).rejects.toThrow();
      expect(await readdir(f.paths.operationsRoot)).toEqual(contents);
      await f.assertPreserved();
    });

  it.for(['assertCurrent', 'authority', 'mutationGuard', 'mkdir', 'rename', 'rm'].flatMap(callback => [false, true].map(expired => ({ callback, expired }))))(
    'rejects saved $callback callback before I/O after its invocation closes (expired=$expired)', async ({ callback, expired }, context) => {
      const f = await fixture(context);
      const view = (await f.observe()).forPhase(f.owner);
      await new NodeWorkspaceLegacyAdoptionRootStore(view).prepareCandidate(f.paths, 'legacy');
      const saved = await view.runMutation(f.paths, async selected => selected);
      f.owner.current = !expired;
      const reads = vi.fn(async () => {});
      hooks.beforeStat = reads;
      const operation = callback === 'assertCurrent' ? saved.assertCurrent()
        : callback === 'authority' ? saved.authority.assertCurrent()
        : callback === 'mutationGuard' ? Promise.resolve().then(() => saved.authority.assertMutationCurrent())
        : callback === 'mkdir' ? saved.acknowledgeCreatedDirectory(f.paths.workspacesRoot)
        : callback === 'rename' ? saved.acknowledgePublishedCandidate!()
        : saved.acknowledgeRemovedRoot!(f.paths.operationRoot);
      await expect(operation).rejects.toThrow();
      expect(reads).not.toHaveBeenCalled();
      saved.authority.onUncertain(new Error('synthetic stale callback notification'));
      expect(f.owner.onUncertain).not.toHaveBeenCalled();
      await view.forPhase(f.nextOwner).assertObservedCurrent();
      await f.assertPreserved();
    });

  it('preserves readonly content failure when the final completion authority check also fails', async context => {
    const f = await fixture(context);
    let checks = 0, failAt = Number.POSITIVE_INFINITY;
    const content = new Error('synthetic first content failure');
    const expiry = new Error('synthetic final completion expiry');
    const view = (await f.observe()).forPhase({
      assertCurrent: f.owner.assertCurrent,
      assertMutationCurrent() { if (++checks === failAt) throw expiry; },
      onUncertain: f.owner.onUncertain,
    });
    const read = async () => { throw content; };
    await expect(view.runRead(f.paths, read)).rejects.toBe(content);
    expect(f.owner.onUncertain).not.toHaveBeenCalled();
    failAt = checks;
    checks = 0;
    const failure = await view.runRead(f.paths, read).catch(error => error);
    expect(checks).toBe(failAt);
    expect(failure.cause).toBeInstanceOf(AggregateError);
    expect(failure.cause.errors).toEqual([content, expiry]);
    expect(f.owner.onUncertain).toHaveBeenCalledExactlyOnceWith(failure.cause);
    await f.assertPreserved();
  });

  it.for(['fresh', 'legacy'] as const)('retains the same %s selection through prepare, publish and live acceptance', async (kind, context) => {
    const f = await fixture(context, kind);
    const before = await f.observe();
    const preparing = before.forPhase(f.owner);
    const store = new NodeWorkspaceLegacyAdoptionRootStore(preparing);
    expect(await store.detectSourceKind(f.paths)).toBe(kind);
    await store.prepareCandidate(f.paths, kind);
    const candidate = await identity(f.paths.candidateRoot), runtime = await identity(f.paths.candidateRuntimeRoot);
    await store.publishCandidate(f.paths);
    expect(await identity(f.paths.finalRoot)).toEqual(candidate);
    expect(await identity(join(f.paths.finalRoot, 'runtime'))).toEqual(runtime);
    f.owner.current = false;
    const accepting = preparing.forPhase(f.nextOwner);
    const live = new NodeWorkspaceLegacyAdoptionRootStore(accepting);
    await writeFile(join(f.paths.finalRoot, 'runtime', 'data', 'eky.sqlite'), 'legitimate backend file change', { mode: 0o600 });
    await accepting.assertObservedCurrent();
    await live.inspectPublished(f.paths, kind);
    await live.discardCandidate(f.paths);
    await accepting.assertObservedCurrent();
    expect(await missing(f.paths.operationRoot)).toBe(true);
    expect(await readFile(join(f.paths.finalRoot, 'runtime', 'data', 'eky.sqlite'), 'utf8')).toBe('legitimate backend file change');
    await f.assertPreserved();
    expect(f.owner.onUncertain).not.toHaveBeenCalled();
    expect(f.nextOwner.onUncertain).not.toHaveBeenCalled();
  });

  it('captures readonly roots without calling an external guard or creating directories', async context => {
    const f = await fixture(context);
    f.owner.assertCurrent.mockRejectedValue(new Error('must not enter a peer during observation'));
    const before = await f.observe();
    await before.assertObservedCurrent();
    expect(f.owner.assertCurrent).not.toHaveBeenCalled();
    expect(await readdir(f.root)).toEqual(expect.arrayContaining(['runtime', 'other-workspace.txt']));
    expect(await missing(f.paths.operationsRoot)).toBe(true);
    expect(await missing(f.paths.workspacesRoot)).toBe(true);
    const view = before.forPhase(f.nextOwner);
    await view.assertObservedCurrent();
    expect(f.nextOwner.assertCurrent).not.toHaveBeenCalled();
  });

  it('keeps completed readonly content failure distinct from uncertain root mutation', async context => {
    const f = await fixture(context);
    const view = (await f.observe()).forPhase(f.owner);
    const store = new NodeWorkspaceLegacyAdoptionRootStore(view);
    await store.prepareCandidate(f.paths, 'legacy');
    await store.publishCandidate(f.paths);
    await rm(join(f.paths.finalRoot, 'runtime', 'storage', 'invoices'), { recursive: true });
    await expect(store.inspectPublished(f.paths, 'legacy')).rejects.toThrow();
    await view.assertObservedCurrent();
    await view.forPhase(f.nextOwner).assertObservedCurrent();
    expect(f.owner.onUncertain).not.toHaveBeenCalled();
    await f.assertPreserved();
  });

  it('binds live getter state and prototype methods to the original authority receiver', async context => {
    const f = await fixture(context);
    let current = true;
    class Owner implements WorkspaceLegacyAdoptionMutationAuthority {
      get live() { return current; }
      assertMutationCurrent() { if (!this.live) throw new Error('expired original owner'); }
      async assertCurrent() { this.assertMutationCurrent(); }
      onUncertain = vi.fn((_reason: unknown) => {});
    }
    const owner = new Owner();
    const observation = await WorkspaceLegacyAdoptionRootSelection.observe(f.paths, owner);
    const view = observation.forPhase(owner);
    current = false;
    let reads = 0;
    hooks.beforeStat = async () => { reads += 1; };
    await expect(observation.assertObservedCurrent()).rejects.toThrow('expired original owner');
    await expect(view.assertObservedCurrent()).rejects.toThrow('expired original owner');
    expect(reads).toBe(0);
    expect(owner.onUncertain).not.toHaveBeenCalled();
    await observation.forPhase(f.nextOwner).assertObservedCurrent();
  });

  it('rejects an old phase before I/O without poisoning the successor', async context => {
    const f = await fixture(context);
    const view = (await f.observe()).forPhase(f.owner);
    const next = view.forPhase(f.nextOwner);
    f.owner.current = false;
    const read = vi.fn(async () => {});
    hooks.beforeStat = read;
    await expect(new NodeWorkspaceLegacyAdoptionRootStore(view).prepareCandidate(f.paths, 'legacy')).rejects.toThrow();
    await expect(view.assertObservedCurrent()).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
    expect(f.owner.onUncertain).not.toHaveBeenCalled();
    await new NodeWorkspaceLegacyAdoptionRootStore(next).prepareCandidate(f.paths, 'legacy');
    await next.assertObservedCurrent();
  });

  it('does not adopt another operation supplied to the retained store', async context => {
    const f = await fixture(context);
    const view = (await f.observe()).forPhase(f.owner);
    const foreign = deriveWorkspaceLegacyAdoptionPaths(f.root, '10000000-0000-4000-8000-000000000098', TEST_ADOPTION_WORKSPACE_ID);
    await expect(new NodeWorkspaceLegacyAdoptionRootStore(view).prepareCandidate(foreign, 'legacy')).rejects.toThrow();
    expect(await missing(foreign.operationRoot)).toBe(true);
    await expect(view.forPhase(f.nextOwner).assertObservedCurrent()).rejects.toThrow();
    await f.assertPreserved();
  });

  it('captures caller paths before any external wait', async context => {
    const f = await fixture(context);
    const view = (await f.observe()).forPhase(f.owner);
    const supplied = { ...f.paths };
    f.owner.assertCurrent.mockImplementationOnce(async () => { supplied.candidateRuntimeRoot = join(f.root, 'foreign'); });
    await new NodeWorkspaceLegacyAdoptionRootStore(view).prepareCandidate(supplied, 'legacy');
    expect(await missing(supplied.candidateRuntimeRoot)).toBe(true);
    expect(await readFile(join(f.paths.candidateRuntimeRoot, 'data', 'eky.sqlite'), 'utf8')).toBe('synthetic-database');
  });

  it.for(['userDataRoot', 'operationsRoot', 'workspacesRoot', 'operationRoot', 'candidateRoot', 'candidateRuntimeRoot', 'legacyRuntimeRoot'] as const)(
    'does not recapture the same-name %s after preparing', async (key, context) => {
      const f = await fixture(context);
      await mkdir(f.paths.workspacesRoot, { mode: 0o700 });
      const view = (await f.observe()).forPhase(f.owner);
      const store = new NodeWorkspaceLegacyAdoptionRootStore(view);
      await store.prepareCandidate(f.paths, 'legacy');
      const path = f.paths[key];
      await rename(path, `${path}.preserved`);
      await mkdir(path, { mode: 0o700 });
      await writeFile(join(path, 'foreign.txt'), 'foreign evidence');
      await expect(new NodeWorkspaceLegacyAdoptionRootStore(view.forPhase(f.nextOwner)).publishCandidate(f.paths)).rejects.toThrow();
      expect(await readFile(join(path, 'foreign.txt'), 'utf8')).toBe('foreign evidence');
      expect(await missing(`${path}.preserved`)).toBe(false);
      expect(await missing(f.paths.finalRoot)).toBe(true);
      expect(await readFile(key === 'userDataRoot' ? join(`${path}.preserved`, 'other-workspace.txt') : f.other, 'utf8')).toBe('other workspace');
    });

  it.for(['finalRoot', 'finalRuntimeRoot'] as const)('retains a substituted %s during acceptance', async (key, context) => {
    const f = await fixture(context);
    const view = (await f.observe()).forPhase(f.owner);
    const store = new NodeWorkspaceLegacyAdoptionRootStore(view);
    await store.prepareCandidate(f.paths, 'legacy');
    await store.publishCandidate(f.paths);
    const path = key === 'finalRoot' ? f.paths.finalRoot : join(f.paths.finalRoot, 'runtime');
    await rename(path, `${path}.preserved`);
    await mkdir(path, { mode: 0o700 });
    await writeFile(join(path, 'foreign.txt'), 'foreign evidence');
    await expect(new NodeWorkspaceLegacyAdoptionRootStore(view.forPhase(f.nextOwner)).discardCandidate(f.paths)).rejects.toThrow();
    expect(await readFile(join(path, 'foreign.txt'), 'utf8')).toBe('foreign evidence');
    expect(await missing(f.paths.operationRoot)).toBe(false);
    await f.assertPreserved();
  });

  it.for(['operationsRoot', 'workspacesRoot', 'finalRoot'] as const)('preserves initially absent %s when it appears externally', async (key, context) => {
    const f = await fixture(context);
    const view = (await f.observe()).forPhase(f.owner);
    await mkdir(f.paths[key], { mode: 0o700, recursive: true });
    await writeFile(join(f.paths[key], 'foreign.txt'), 'foreign evidence');
    await expect(new NodeWorkspaceLegacyAdoptionRootStore(view).prepareCandidate(f.paths, 'legacy')).rejects.toThrow();
    expect(await readFile(join(f.paths[key], 'foreign.txt'), 'utf8')).toBe('foreign evidence');
    await f.assertPreserved();
  });

  it.for(['existing', 'absent'] as const)('does not acknowledge a foreign %s mkdir target', async (initial, context) => {
    const f = await fixture(context);
    if (initial === 'existing') await mkdir(f.paths.operationsRoot, { mode: 0o700 });
    const view = (await f.observe()).forPhase(f.owner);
    hooks.beforeMkdir = async path => {
      if (path !== f.paths.operationsRoot) return;
      hooks.beforeMkdir = undefined;
      if (initial === 'existing') await rename(path, `${path}.preserved`);
      await mkdir(path, { mode: 0o700 });
      await writeFile(join(path, 'foreign.txt'), 'foreign evidence');
    };
    await expect(new NodeWorkspaceLegacyAdoptionRootStore(view).prepareCandidate(f.paths, 'legacy')).rejects.toThrow();
    expect(await readFile(join(f.paths.operationsRoot, 'foreign.txt'), 'utf8')).toBe('foreign evidence');
    expect(await missing(f.paths.operationRoot)).toBe(true);
    await expect(view.forPhase(f.nextOwner).assertObservedCurrent()).rejects.toThrow();
  });

  it.for(['mkdir', 'rename', 'rm'] as const)('seals a lost %s acknowledgement across phases', async (effect, context) => {
    const f = await fixture(context);
    const view = (await f.observe()).forPhase(f.owner);
    const store = new NodeWorkspaceLegacyAdoptionRootStore(view);
    if (effect !== 'mkdir') await store.prepareCandidate(f.paths, 'legacy');
    if (effect === 'rm') await store.publishCandidate(f.paths);
    const original = new Error(`synthetic lost ${effect} acknowledgement`);
    hooks.afterEffect = async (kind, path) => {
      if (kind !== effect || (effect === 'mkdir' && path !== f.paths.operationRoot)) return;
      hooks.afterEffect = undefined;
      throw original;
    };
    await expect(effect === 'mkdir' ? store.prepareCandidate(f.paths, 'legacy')
      : effect === 'rename' ? store.publishCandidate(f.paths) : store.discardCandidate(f.paths)).rejects.toThrow();
    expect(f.owner.onUncertain).toHaveBeenCalledExactlyOnceWith(original);
    const next = view.forPhase(f.nextOwner);
    await expect(next.assertObservedCurrent()).rejects.toMatchObject({ cause: original });
    await expect(new NodeWorkspaceLegacyAdoptionRootStore(next).discardCandidate(f.paths)).rejects.toThrow();
    if (effect === 'mkdir') expect(await missing(f.paths.operationRoot)).toBe(false);
    else expect(await readFile(join(f.paths.finalRoot, 'runtime', 'data', 'eky.sqlite'), 'utf8')).toBe('synthetic-database');
    await f.assertPreserved();
  });

  it.for(['rename', 'rm'] as const)('seals authority lost during the successful %s effect', async (effect, context) => {
    const f = await fixture(context);
    const view = (await f.observe()).forPhase(f.owner);
    const store = new NodeWorkspaceLegacyAdoptionRootStore(view);
    await store.prepareCandidate(f.paths, 'legacy');
    if (effect === 'rm') await store.publishCandidate(f.paths);
    hooks.afterEffect = async kind => { if (kind === effect) f.owner.current = false; };
    await expect(effect === 'rename' ? store.publishCandidate(f.paths) : store.discardCandidate(f.paths)).rejects.toThrow();
    await expect(view.forPhase(f.nextOwner).assertObservedCurrent()).rejects.toThrow();
    await f.assertPreserved();
  });

  it.for(['root', 'runtime'] as const)('proves the moved %s inode rather than adopting a substituted final', async (target, context) => {
    const f = await fixture(context);
    const view = (await f.observe()).forPhase(f.owner);
    const store = new NodeWorkspaceLegacyAdoptionRootStore(view);
    await store.prepareCandidate(f.paths, 'legacy');
    const changed = target === 'root' ? f.paths.finalRoot : join(f.paths.finalRoot, 'runtime');
    hooks.afterEffect = async kind => {
      if (kind !== 'rename') return;
      hooks.afterEffect = undefined;
      await rename(changed, `${changed}.preserved`);
      await mkdir(changed, { mode: 0o700 });
      await writeFile(join(changed, 'foreign.txt'), 'foreign evidence');
    };
    await expect(store.publishCandidate(f.paths)).rejects.toThrow();
    expect(await readFile(join(changed, 'foreign.txt'), 'utf8')).toBe('foreign evidence');
    const preservedRuntime = target === 'root' ? join(`${changed}.preserved`, 'runtime') : `${changed}.preserved`;
    expect(await readFile(join(preservedRuntime, 'data', 'eky.sqlite'), 'utf8')).toBe('synthetic-database');
    await f.assertPreserved();
  });

  it('does not acknowledge rm when a foreign operation root reappears before readback', async context => {
    const f = await fixture(context);
    const view = (await f.observe()).forPhase(f.owner);
    const store = new NodeWorkspaceLegacyAdoptionRootStore(view);
    await store.prepareCandidate(f.paths, 'legacy');
    await store.publishCandidate(f.paths);
    hooks.afterEffect = async (kind, path) => {
      if (kind !== 'rm' || path !== f.paths.operationRoot) return;
      hooks.afterEffect = undefined;
      await mkdir(path, { mode: 0o700 });
      await writeFile(join(path, 'foreign.txt'), 'foreign evidence');
    };
    await expect(store.discardCandidate(f.paths)).rejects.toThrow();
    expect(await readFile(join(f.paths.operationRoot, 'foreign.txt'), 'utf8')).toBe('foreign evidence');
    expect(await readFile(join(f.paths.finalRoot, 'runtime', 'data', 'eky.sqlite'), 'utf8')).toBe('synthetic-database');
    await expect(view.forPhase(f.nextOwner).assertObservedCurrent()).rejects.toThrow();
    await f.assertPreserved();
  });

  it('rechecks original roots after the last external wait', async context => {
    const f = await fixture(context);
    const view = (await f.observe()).forPhase(f.owner);
    const store = new NodeWorkspaceLegacyAdoptionRootStore(view);
    await store.prepareCandidate(f.paths, 'legacy');
    f.owner.assertCurrent.mockImplementationOnce(async () => {
      await rename(f.paths.candidateRoot, `${f.paths.candidateRoot}.preserved`);
      await mkdir(f.paths.candidateRoot, { mode: 0o700 });
      await writeFile(join(f.paths.candidateRoot, 'foreign.txt'), 'foreign evidence');
    });
    await expect(store.publishCandidate(f.paths)).rejects.toThrow();
    expect(await readFile(join(f.paths.candidateRoot, 'foreign.txt'), 'utf8')).toBe('foreign evidence');
    expect(await missing(f.paths.finalRoot)).toBe(true);
  });

  it.for(['candidate', 'published', 'absent'] as const)('retains the strict %s recovery branch with the same selection', async (branch, context) => {
    const f = await fixture(context);
    const view = (await f.observe()).forPhase(f.owner);
    const store = new NodeWorkspaceLegacyAdoptionRootStore(view);
    if (branch !== 'absent') await store.prepareCandidate(f.paths, 'legacy');
    if (branch === 'published') await store.publishCandidate(f.paths);
    const recovery = view.forPhase(f.nextOwner);
    const recovering = new NodeWorkspaceLegacyAdoptionRootStore(recovery);
    await recovering.assertRecoveryLayout(f.paths, []);
    if (branch === 'candidate') await recovering.discardRecoveryCandidateMatchingLegacy(f.paths);
    if (branch === 'published') await recovering.discardUnregisteredPublishedRootMatchingLegacy(f.paths);
    await recovering.discardEmptyRecoveryOperation(f.paths);
    await recovery.assertObservedCurrent();
    expect(await missing(f.paths.operationRoot)).toBe(true);
    expect(await missing(f.paths.finalRoot)).toBe(true);
    await f.assertPreserved();
  });

  it.for(['candidate', 'published'] as const)('preserves changed %s recovery bytes', async (branch, context) => {
    const f = await fixture(context);
    const view = (await f.observe()).forPhase(f.owner);
    const store = new NodeWorkspaceLegacyAdoptionRootStore(view);
    await store.prepareCandidate(f.paths, 'legacy');
    if (branch === 'published') await store.publishCandidate(f.paths);
    const runtime = branch === 'candidate' ? f.paths.candidateRuntimeRoot : join(f.paths.finalRoot, 'runtime');
    await writeFile(join(runtime, 'data', 'eky.sqlite'), 'changed recovery bytes', { mode: 0o600 });
    const recovering = new NodeWorkspaceLegacyAdoptionRootStore(view.forPhase(f.nextOwner));
    await expect(branch === 'candidate' ? recovering.discardRecoveryCandidateMatchingLegacy(f.paths)
      : recovering.discardUnregisteredPublishedRootMatchingLegacy(f.paths)).rejects.toThrow();
    expect(await readFile(join(runtime, 'data', 'eky.sqlite'), 'utf8')).toBe('changed recovery bytes');
    await f.assertPreserved();
  });

  it.for(['entry', 'hardlink'] as const)('retains the existing %s publication validator', async (change, context) => {
    const f = await fixture(context);
    const view = (await f.observe()).forPhase(f.owner);
    const store = new NodeWorkspaceLegacyAdoptionRootStore(view);
    await store.prepareCandidate(f.paths, 'legacy');
    if (change === 'entry') await writeFile(join(f.paths.candidateRoot, 'foreign.txt'), 'foreign evidence');
    else await link(join(f.paths.candidateRuntimeRoot, 'data', 'eky.sqlite'), join(f.root, 'alias'));
    await expect(store.publishCandidate(f.paths)).rejects.toThrow();
    expect(await missing(f.paths.finalRoot)).toBe(true);
    expect(await readFile(join(f.paths.candidateRuntimeRoot, 'data', 'eky.sqlite'), 'utf8')).toBe('synthetic-database');
    await f.assertPreserved();
  });

  it.for(['readonlyLeaf', 'writer'] as const)('rejects overlapping %s without completing the original work early', async (overlap, context) => {
    const f = await fixture(context);
    const view = (await f.observe()).forPhase(f.owner);
    const store = new NodeWorkspaceLegacyAdoptionRootStore(view);
    const entered = gate(), release = gate();
    f.owner.assertCurrent.mockImplementationOnce(async () => { entered.resolve(); await release.promise; });
    let settled = false;
    const work = store.prepareCandidate(f.paths, 'legacy');
    const observed = work.then(() => { settled = true; }, error => { settled = true; return error; });
    try {
      await entered.promise;
      await expect(overlap === 'readonlyLeaf' ? view.assertObservedCurrent() : store.prepareCandidate(f.paths, 'legacy')).rejects.toThrow();
      expect(settled).toBe(false);
    } finally { release.resolve(); await observed; }
    await expect(work).rejects.toThrow();
    expect(await missing(f.paths.operationsRoot)).toBe(true);
    await expect(view.forPhase(f.nextOwner).assertObservedCurrent()).rejects.toThrow();
  });

  it.for(['matching', 'unrelated'] as const)('preserves first failure and only its %s completion aggregate', async (kind, context) => {
    const f = await fixture(context);
    const view = (await f.observe()).forPhase(f.owner);
    const entered = gate(), release = gate();
    const first = new Error('synthetic first authority failure');
    const close = new Error('synthetic later writer close failure');
    const completion = new AggregateError(kind === 'matching' ? [first, close] : [close], 'synthetic writer completion');
    let settled = false;
    const work = view.runMutation(f.paths, async selection => {
      selection.authority.onUncertain(first);
      f.owner.current = false;
      entered.resolve();
      await release.promise;
      throw completion;
    });
    const observed = work.then(() => { settled = true; }, error => { settled = true; return error; });
    try {
      await entered.promise;
      expect(settled).toBe(false);
      expect(f.owner.onUncertain).toHaveBeenCalledExactlyOnceWith(first);
    } finally { release.resolve(); await observed; }
    const expected = kind === 'matching' ? completion : first;
    expect((await observed).cause).toBe(expected);
    await expect(view.forPhase(f.nextOwner).assertObservedCurrent()).rejects.toMatchObject({ cause: expected });
    expect(f.owner.onUncertain).toHaveBeenCalledExactlyOnceWith(first);
    expect(f.nextOwner.onUncertain).not.toHaveBeenCalled();
    expect(await missing(f.paths.operationsRoot)).toBe(true);
    await f.assertPreserved();
  });

  it.for(['success', 'failure'] as const)('joins original retained hash stream close after %s', async (outcome, context) => {
    const f = await fixture(context);
    const view = (await f.observe()).forPhase(f.owner);
    const entered = gate(), release = gate();
    const original = new Error('synthetic original stream failure');
    let selected = false;
    hooks.stream = stream => {
      if (selected) return;
      selected = true;
      const emit = stream.emit.bind(stream);
      stream.emit = (event: string | symbol, ...args: unknown[]) => {
        if (event !== 'close') return emit(event, ...args);
        entered.resolve();
        void release.promise.then(() => emit(event, ...args));
        return true;
      };
      if (outcome === 'failure') stream.once('open', () => stream.destroy(original));
    };
    let settled = false;
    const work = new NodeWorkspaceLegacyAdoptionRootStore(view).prepareCandidate(f.paths, 'legacy');
    const observed = work.then(() => { settled = true; }, error => { settled = true; return error; });
    try { await entered.promise; expect(settled).toBe(false); }
    finally { release.resolve(); await observed; }
    if (outcome === 'failure') {
      await expect(work).rejects.toThrow();
      expect(f.owner.onUncertain).toHaveBeenCalledExactlyOnceWith(original);
      await expect(view.forPhase(f.nextOwner).assertObservedCurrent()).rejects.toThrow();
    } else { await work; await view.assertObservedCurrent(); }
    await f.assertPreserved();
  });

  it('joins an interrupted initial observation before returning failure', async context => {
    const f = await fixture(context);
    const entered = gate(), release = gate();
    hooks.beforeStat = async path => {
      if (path !== f.paths.operationsRoot) return;
      hooks.beforeStat = undefined;
      entered.resolve();
      await release.promise;
    };
    let settled = false;
    const work = f.observe();
    const observed = work.then(() => { settled = true; }, error => { settled = true; return error; });
    try { await entered.promise; f.owner.current = false; expect(settled).toBe(false); }
    finally { release.resolve(); await observed; }
    await expect(work).rejects.toThrow();
    expect(await missing(f.paths.operationsRoot)).toBe(true);
    expect(f.owner.onUncertain).toHaveBeenCalledOnce();
  });
});

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}

function owner() {
  return { current: true, assertCurrent: vi.fn(async () => {}), onUncertain: vi.fn((_reason: unknown) => {}),
    assertMutationCurrent() { if (!this.current) throw new Error('synthetic expired phase'); } };
}

async function fixture(context: TestContext, kind: 'fresh' | 'legacy' = 'legacy') {
  const baseRoot = await mkdtemp(join(tmpdir(), 'eky-adoption-retained-root-'));
  const root = join(baseRoot, 'user-data');
  await mkdir(root, { mode: 0o700 });
  context.onTestFinished(async () => { if (context.task.result?.state === 'pass') await rm(baseRoot, { recursive: true, force: true }); });
  const paths = deriveWorkspaceLegacyAdoptionPaths(root, TEST_ADOPTION_OPERATION_ID, TEST_ADOPTION_WORKSPACE_ID);
  const source = join(paths.legacyRuntimeRoot, 'data', 'eky.sqlite');
  if (kind === 'legacy') {
    await mkdir(join(paths.legacyRuntimeRoot, 'data'), { recursive: true, mode: 0o700 });
    await mkdir(join(paths.legacyRuntimeRoot, 'storage', 'invoices'), { recursive: true, mode: 0o700 });
    await writeFile(source, 'synthetic-database', { mode: 0o600 });
  }
  const other = join(root, 'other-workspace.txt');
  await writeFile(other, 'other workspace', { mode: 0o600 });
  const currentOwner = owner(), nextOwner = owner();
  return { root, paths, source, other, owner: currentOwner, nextOwner,
    observe: () => WorkspaceLegacyAdoptionRootSelection.observe(paths, currentOwner),
    async assertPreserved() {
      if (kind === 'legacy') expect(await readFile(source, 'utf8')).toBe('synthetic-database');
      else expect(await missing(paths.legacyRuntimeRoot)).toBe(true);
      expect(await readFile(other, 'utf8')).toBe('other workspace');
    },
  };
}

async function identity(path: string) {
  const metadata = await lstat(path, { bigint: true });
  return { dev: metadata.dev, ino: metadata.ino };
}

async function missing(path: string) {
  try { await lstat(path); return false; }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return true; throw error; }
}
