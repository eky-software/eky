import { link, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi, type TestContext } from 'vitest';

import { deriveWorkspaceLegacyAdoptionPaths } from './workspaceLegacyAdoptionPaths.js';
import { NodeWorkspaceLegacyAdoptionRootStore } from './workspaceLegacyAdoptionRootStore.js';
import { TEST_ADOPTION_OPERATION_ID, TEST_ADOPTION_WORKSPACE_ID } from './workspaceLegacyAdoptionTestSupport.js';

const variants = ['publish', 'discardCandidate', 'recoveryCandidate', 'recoveryPublished', 'emptyOperation'] as const;
type Variant = typeof variants[number];

describe('adoption root mutation authority', () => {
  it.for(variants)('preserves the ordinary successful %s path with current authority', async (variant, context) => {
    const f = await fixture(context, variant);
    await f.run();
    expect(await exists(f.target)).toBe(false);
    expect(await readFile(f.source, 'utf8')).toBe('synthetic-database');
    expect(await readFile(f.other, 'utf8')).toBe('other workspace');
    if (variant === 'publish') {
      expect(await readFile(join(f.paths.finalRoot, 'runtime', 'data', 'eky.sqlite'), 'utf8')).toBe('synthetic-database');
    }
    expect(f.onUncertain).not.toHaveBeenCalled();
    expect(f.assertCurrent).toHaveBeenCalled();
  });

  it.for(variants)('rejects expired authority before %s changes files', async (variant, context) => {
    const f = await fixture(context, variant);
    f.state.current = false;
    await expect(f.run()).rejects.toThrow();
    expect(await exists(f.target)).toBe(true);
    expect(await readFile(f.source, 'utf8')).toBe('synthetic-database');
    expect(f.onUncertain).toHaveBeenCalledOnce();
  });

  it.for(variants)('retains a different same-path root selected during %s validation', async (variant, context) => {
    const f = await fixture(context, variant);
    const preserved = `${f.target}.preserved`;
    f.assertCurrent.mockImplementationOnce(async () => {
      await rename(f.target, preserved);
      await mkdir(f.target, { mode: 0o700 });
      await writeFile(join(f.target, 'foreign.txt'), 'foreign evidence');
    });
    await expect(f.run()).rejects.toThrow();
    expect(await readFile(join(f.target, 'foreign.txt'), 'utf8')).toBe('foreign evidence');
    expect(await exists(preserved)).toBe(true);
    expect(await readFile(f.source, 'utf8')).toBe('synthetic-database');
    expect(f.onUncertain).toHaveBeenCalledOnce();
  });

  it.for(variants)('rejects authority lost in the final external wait before %s', async (variant, context) => {
    const f = await fixture(context, variant);
    f.assertCurrent.mockImplementationOnce(async () => { f.state.current = false; });
    await expect(f.run()).rejects.toThrow();
    expect(await exists(f.target)).toBe(true);
    expect(f.onUncertain).toHaveBeenCalledOnce();
  });

  it('retains an unknown operation entry introduced during validation', async context => {
    const f = await fixture(context, 'discardCandidate');
    f.assertCurrent.mockImplementationOnce(async () => {
      await writeFile(join(f.paths.operationRoot, 'foreign.txt'), 'foreign evidence');
    });
    await expect(f.run()).rejects.toThrow();
    expect(await readFile(join(f.paths.operationRoot, 'foreign.txt'), 'utf8')).toBe('foreign evidence');
    expect(await exists(f.paths.candidateRoot)).toBe(true);
  });

  it('preserves the original cause before safe mapping even when notification fails', async context => {
    const f = await fixture(context, 'emptyOperation');
    const original = new Error('synthetic private owner error');
    f.assertCurrent.mockRejectedValueOnce(original);
    f.onUncertain.mockImplementationOnce(() => { throw new Error('synthetic notification error'); });
    await expect(f.run()).rejects.toMatchObject({ code: 'WORKSPACE_ADOPTION_RECOVERY_REQUIRED' });
    expect(f.onUncertain).toHaveBeenCalledExactlyOnceWith(original);
    expect(await exists(f.target)).toBe(true);
  });

  it('does not create a publication directory after losing authority', async context => {
    const f = await fixture(context, 'publish');
    expect(await exists(f.paths.workspacesRoot)).toBe(false);
    f.assertCurrent.mockImplementationOnce(async () => { f.state.current = false; });
    await expect(f.run()).rejects.toThrow();
    expect(await exists(f.paths.workspacesRoot)).toBe(false);
    expect(await exists(f.paths.candidateRoot)).toBe(true);
  });

  it.for(['operationEntry', 'candidateEntry', 'hardlink'] as const)('retains changed %s before publication', async (change, context) => {
    const f = await fixture(context, 'publish');
    f.assertCurrent.mockImplementationOnce(async () => {
      if (change === 'hardlink') {
        await link(join(f.paths.candidateRuntimeRoot, 'data', 'eky.sqlite'), join(f.root, 'alias'));
      } else {
        await writeFile(join(change === 'operationEntry' ? f.paths.operationRoot : f.paths.candidateRoot, 'foreign.txt'), 'foreign evidence');
      }
    });
    await expect(f.run()).rejects.toThrow();
    expect(await exists(f.paths.candidateRoot)).toBe(true);
    expect(await exists(f.paths.finalRoot)).toBe(false);
    expect(await readFile(f.source, 'utf8')).toBe('synthetic-database');
  });

  it('retains an unknown candidate top-level entry before cleanup', async context => {
    const f = await fixture(context, 'discardCandidate');
    f.assertCurrent.mockImplementationOnce(async () => {
      await writeFile(join(f.paths.candidateRoot, 'foreign.txt'), 'foreign evidence');
    });
    await expect(f.run()).rejects.toThrow();
    expect(await readFile(join(f.paths.candidateRoot, 'foreign.txt'), 'utf8')).toBe('foreign evidence');
  });

  it.for(variants)('keeps the first lost acknowledgement after %s without deleting source evidence', async (variant, context) => {
    const f = await fixture(context, variant);
    const first = new Error('synthetic lost mutation acknowledgement');
    f.assertCurrent.mockImplementationOnce(async () => {}).mockRejectedValueOnce(first);
    await expect(f.run()).rejects.toThrow();
    expect(await exists(f.target)).toBe(false);
    expect(await readFile(f.source, 'utf8')).toBe('synthetic-database');
    expect(f.onUncertain).toHaveBeenCalledExactlyOnceWith(first);
  });
});

describe('adoption candidate preparation authority', () => {
  it.for(['legacy', 'fresh'] as const)('preserves ordinary %s preparation', async (kind, context) => {
    const f = await fixture(context, 'prepare');
    if (kind === 'fresh') await rm(f.paths.legacyRuntimeRoot, { recursive: true });
    await f.store.prepareCandidate(f.paths, kind, f.authority);
    await expect(f.store.inspectCandidate(f.paths, kind)).resolves.toBeUndefined();
    expect(await exists(f.paths.finalRoot)).toBe(false);
    if (kind === 'legacy') expect(await readFile(f.source, 'utf8')).toBe('synthetic-database');
    expect(f.onUncertain).not.toHaveBeenCalled();
  });

  it('creates nothing after the preparing owner is lost', async context => {
    const f = await fixture(context, 'prepare');
    f.assertCurrent.mockImplementationOnce(async () => { f.state.current = false; });
    await expect(f.store.prepareCandidate(f.paths, 'legacy', f.authority)).rejects.toThrow();
    expect(await exists(f.paths.operationsRoot)).toBe(false);
    expect(await readFile(f.source, 'utf8')).toBe('synthetic-database');
    expect(f.onUncertain).toHaveBeenCalledOnce();
  });

  it('retains both roots if the candidate is replaced after its own creation receipt', async context => {
    const f = await fixture(context, 'prepare');
    f.assertCurrent.mockImplementationOnce(async () => {}).mockImplementationOnce(async () => {
      await rename(f.paths.candidateRoot, `${f.paths.candidateRoot}.preserved`);
      await mkdir(f.paths.candidateRoot, { mode: 0o700 });
      await writeFile(join(f.paths.candidateRoot, 'foreign.txt'), 'foreign evidence');
    });
    await expect(f.store.prepareCandidate(f.paths, 'legacy', f.authority)).rejects.toThrow();
    expect(await readFile(join(f.paths.candidateRoot, 'foreign.txt'), 'utf8')).toBe('foreign evidence');
    expect(await exists(`${f.paths.candidateRoot}.preserved`)).toBe(true);
    expect(await readFile(f.source, 'utf8')).toBe('synthetic-database');
  });

  it('does not start the next copy after authority expires between entries', async context => {
    const f = await fixture(context, 'prepare');
    let checks = 0;
    f.assertCurrent.mockImplementation(async () => { if (++checks === 4) f.state.current = false; });
    await expect(f.store.prepareCandidate(f.paths, 'legacy', f.authority)).rejects.toThrow();
    expect(await readdir(f.paths.candidateRuntimeRoot)).toEqual(['data']);
    expect(await readdir(join(f.paths.candidateRuntimeRoot, 'data'))).toEqual([]);
    expect(await readFile(f.source, 'utf8')).toBe('synthetic-database');
  });

  it('uses the original captured paths even if the caller changes its object', async context => {
    const f = await fixture(context, 'prepare');
    const supplied = { ...f.paths };
    f.assertCurrent.mockImplementationOnce(async () => { supplied.candidateRuntimeRoot = join(f.root, 'foreign'); });
    await f.store.prepareCandidate(supplied, 'legacy', f.authority);
    expect(await exists(supplied.candidateRuntimeRoot)).toBe(false);
    expect(await readFile(join(f.paths.candidateRuntimeRoot, 'data', 'eky.sqlite'), 'utf8')).toBe('synthetic-database');
  });

  it('rejects paths not derived from the selected operation before creating them', async context => {
    const f = await fixture(context, 'prepare');
    await expect(f.store.prepareCandidate({ ...f.paths, candidateRoot: join(f.root, 'foreign') }, 'legacy', f.authority))
      .rejects.toMatchObject({ code: 'WORKSPACE_ADOPTION_RECOVERY_REQUIRED' });
    expect(await exists(f.paths.operationsRoot)).toBe(false);
    expect(await exists(join(f.root, 'foreign'))).toBe(false);
  });
});

async function fixture(context: TestContext, variant: Variant | 'prepare') {
  const root = await mkdtemp(join(tmpdir(), 'eky-adoption-root-authority-'));
  context.onTestFinished(async () => { if (context.task.result?.state === 'pass') await rm(root, { recursive: true, force: true }); });
  const paths = deriveWorkspaceLegacyAdoptionPaths(root, TEST_ADOPTION_OPERATION_ID, TEST_ADOPTION_WORKSPACE_ID);
  const source = join(paths.legacyRuntimeRoot, 'data', 'eky.sqlite');
  await mkdir(join(paths.legacyRuntimeRoot, 'data'), { recursive: true, mode: 0o700 });
  await mkdir(join(paths.legacyRuntimeRoot, 'storage', 'invoices'), { recursive: true, mode: 0o700 });
  await writeFile(source, 'synthetic-database', { mode: 0o600 });
  const other = join(root, 'other-workspace.txt');
  await writeFile(other, 'other workspace');
  const store = new NodeWorkspaceLegacyAdoptionRootStore();
  if (variant === 'emptyOperation') await mkdir(paths.operationRoot, { recursive: true, mode: 0o700 });
  else if (variant !== 'prepare') await store.prepareCandidate(paths, 'legacy');
  if (variant === 'recoveryPublished') await store.publishCandidate(paths);
  const state = { current: true };
  const assertCurrent = vi.fn(async () => {});
  const onUncertain = vi.fn((_error: unknown) => {});
  const authority = { assertCurrent, onUncertain, assertMutationCurrent() {
    if (!state.current) throw new Error('synthetic owner lost');
  } };
  const target = variant === 'publish' ? paths.candidateRoot
    : variant === 'recoveryPublished' ? paths.finalRoot : paths.operationRoot;
  const run = () => variant === 'publish' ? store.publishCandidate(paths, authority)
    : variant === 'discardCandidate' ? store.discardCandidate(paths, authority)
    : variant === 'recoveryCandidate' ? store.discardRecoveryCandidateMatchingLegacy(paths, authority)
    : variant === 'recoveryPublished' ? store.discardUnregisteredPublishedRootMatchingLegacy(paths, authority)
    : store.discardEmptyRecoveryOperation(paths, authority);
  return { root, paths, source, other, state, target, store, authority, assertCurrent, onUncertain, run };
}

async function exists(path: string) {
  try { await readdir(path); return true; }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false; throw error; }
}
