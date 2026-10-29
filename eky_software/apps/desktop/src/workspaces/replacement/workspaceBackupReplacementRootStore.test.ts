import { promises as fileSystem } from 'node:fs';
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { deriveWorkspaceBackupReplacementPaths } from './workspaceBackupReplacementPaths.js';
import { NodeWorkspaceBackupReplacementRootStore } from './workspaceBackupReplacementRootStore.js';
import {
  TEST_REPLACEMENT_OPERATION_ID,
  TEST_REPLACEMENT_WORKSPACE_ID,
} from './workspaceBackupReplacementTestSupport.js';

const cleanupRoots: string[] = [];

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rm: vi.fn(actual.rm) };
});

afterEach(context => {
  vi.restoreAllMocks(); vi.mocked(rm).mockReset();
  const owned = cleanupRoots.splice(0);
  context.onTestFinished(async () => {
    if (context.task.result?.state === 'pass') {
      for (const root of owned) await rm(root, { force: true, recursive: true });
    }
  });
});

describe('workspace backup replacement root store', () => {
  it.each(Array.from({ length: process.platform === 'win32' ? 10 : 20 }, (_, index) => index + 1))(
    'retains the exact root tree when preparation owner is lost before mutation %s', async boundary => {
      const f = await createFixture(); let calls = 0;
      let retained: Awaited<ReturnType<typeof snapshot>> | undefined;
      const first = new Error('SYNTHETIC_ROOT_OWNER_REVOKED');
      await expect(f.store.prepareCandidate(f.paths, {
        async assertCurrent() { retained = await snapshot(f.root); },
        assertMutationCurrent() { if (++calls === boundary) throw first; },
      })).rejects.toMatchObject({ cause: first });
      expect(calls).toBe(boundary); expect(await snapshot(f.root)).toEqual(retained);
    },
  );

  it.each([1, 2])('guards discard mutation %s separately and keeps the remaining evidence', async boundary => {
    const f = await createFixture(); await f.store.prepareCandidate(f.paths);
    await mkdir(f.paths.importStagingRoot, { mode: 0o700, recursive: true });
    await writeFile(join(f.paths.importStagingRoot, 'profile.sqlite'), 'source');
    await writeFile(f.paths.candidateDatabasePath, 'candidate');
    let calls = 0; let retained: Awaited<ReturnType<typeof snapshot>> | undefined;
    const first = new Error('SYNTHETIC_DISCARD_OWNER_REVOKED');
    await expect(f.store.discardBeforeActivation(f.paths, {
      async assertCurrent() { retained = await snapshot(f.root); },
      assertMutationCurrent() { if (++calls === boundary) throw first; },
    })).rejects.toMatchObject({ cause: first });
    expect(calls).toBe(boundary); expect(await snapshot(f.root)).toEqual(retained);
    expect(await readFile(f.paths.activeDatabasePath, 'utf8')).toBe('old database');
    expect(await readFile(f.paths.candidateDatabasePath, 'utf8')).toBe('candidate');
  });

  it.each(['prepareCandidate', 'discardBeforeActivation', 'removeImportStaging'] as const)(
    'rejects a non-synchronous guard without changing files in %s', async method => {
      const f = await createFixture(); await f.store.prepareCandidate(f.paths);
      await mkdir(f.paths.importStagingRoot, { mode: 0o700, recursive: true });
      const before = await snapshot(f.root);
      await expect(f.store[method](f.paths, { async assertCurrent() {}, async assertMutationCurrent() {} })).rejects.toThrow();
      expect(await snapshot(f.root)).toEqual(before);
    },
  );

  it('pins root authority callbacks before the first asynchronous validation', async () => {
    const f = await createFixture(); const foreign = vi.fn(); const guard = vi.fn();
    const authority = { async assertCurrent() { Object.assign(authority, { assertCurrent: foreign, assertMutationCurrent: foreign }); },
      assertMutationCurrent: guard };
    await f.store.prepareCandidate(f.paths, authority);
    expect(foreign).not.toHaveBeenCalled();
    expect(guard).toHaveBeenCalledTimes(process.platform === 'win32' ? 10 : 20);
  });

  it('joins the original removal before reporting lost ownership and never starts candidate cleanup', async () => {
    const f = await createFixture(); await f.store.prepareCandidate(f.paths);
    await mkdir(f.paths.importStagingRoot, { mode: 0o700, recursive: true });
    await writeFile(f.paths.candidateDatabasePath, 'candidate');
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
    let current = true; let settled = false;
    const first = new Error('SYNTHETIC_PENDING_REMOVAL_REVOKED');
    vi.mocked(rm).mockClear();
    vi.mocked(rm).mockImplementationOnce(async (...args) => {
      entered(); await gate; await fileSystem.rm(...args);
    });
    const result = f.store.discardBeforeActivation(f.paths, {
      async assertCurrent() { if (!current) throw first; },
      assertMutationCurrent() { if (!current) throw first; },
    }).then(() => undefined, error => error as unknown).finally(() => { settled = true; });
    try {
      await Promise.race([started, result.then(() => { throw new Error('REMOVAL_NOT_STARTED'); })]);
      current = false; await Promise.resolve(); expect(settled).toBe(false);
    } finally { release(); await result; }
    expect(await result).toMatchObject({ cause: first });
    expect(vi.mocked(rm)).toHaveBeenCalledOnce();
    expect(await readFile(f.paths.candidateDatabasePath, 'utf8')).toBe('candidate');
    expect(await readFile(f.paths.activeDatabasePath, 'utf8')).toBe('old database');
  });

  it('rechecks both trees after asynchronous authority before discarding either', async () => {
    const f = await createFixture(); await f.store.prepareCandidate(f.paths);
    await mkdir(f.paths.importStagingRoot, { mode: 0o700, recursive: true });
    await writeFile(join(f.paths.importStagingRoot, 'profile.sqlite'), 'source');
    await writeFile(f.paths.candidateDatabasePath, 'candidate');
    let retained: Awaited<ReturnType<typeof snapshot>> | undefined;
    const guard = vi.fn(); vi.mocked(rm).mockClear();
    await expect(f.store.discardBeforeActivation(f.paths, {
      async assertCurrent() {
        await writeFile(join(f.paths.activationStagingOperationRoot, 'foreign.txt'), 'retained');
        retained = await snapshot(f.root);
      }, assertMutationCurrent: guard,
    })).rejects.toThrow();
    expect(guard).not.toHaveBeenCalled(); expect(rm).not.toHaveBeenCalled();
    expect(await snapshot(f.root)).toEqual(retained);
  });

  it('revalidates import staging after asynchronous authority before removing it', async () => {
    const f = await createFixture(); await f.store.prepareCandidate(f.paths);
    await mkdir(f.paths.importStagingRoot, { mode: 0o700, recursive: true });
    const source = join(f.paths.importStagingRoot, 'profile.sqlite'); await writeFile(source, 'source');
    let retained: Awaited<ReturnType<typeof snapshot>> | undefined;
    const guard = vi.fn(); vi.mocked(rm).mockClear();
    await expect(f.store.removeImportStaging(f.paths, {
      async assertCurrent() { await link(source, join(f.root, 'foreign-link')); retained = await snapshot(f.root); },
      assertMutationCurrent: guard,
    })).rejects.toThrow();
    expect(guard).not.toHaveBeenCalled(); expect(rm).not.toHaveBeenCalled();
    expect(await snapshot(f.root)).toEqual(retained);
  });

  it('prepares and validates only the private candidate slots', async () => {
    const fixture = await createFixture();

    await fixture.store.prepareCandidate(fixture.paths);
    await mkdir(fixture.paths.importStagingRoot, {
      mode: 0o700,
      recursive: true,
    });
    await writeFile(fixture.paths.candidateDatabasePath, 'new database');
    const candidatePdf = join(
      fixture.paths.candidateArtifactRoot,
      'company-1',
      'invoice-1',
      'approved-invoice.pdf',
    );
    await mkdir(dirname(candidatePdf), { mode: 0o700, recursive: true });
    await writeFile(candidatePdf, 'new pdf');

    await fixture.store.removeImportStaging(fixture.paths);
    await expect(
      fixture.store.inspectCandidate(fixture.paths),
    ).resolves.toBeUndefined();
    await expect(readFile(fixture.paths.activeDatabasePath, 'utf8')).resolves.toBe(
      'old database',
    );
    await expect(readFile(fixture.activePdfPath, 'utf8')).resolves.toBe(
      'old pdf',
    );
  });

  it('discards only known pre-activation staging and preserves the active root', async () => {
    const fixture = await createFixture();
    await fixture.store.prepareCandidate(fixture.paths);
    await mkdir(fixture.paths.importStagingRoot, {
      mode: 0o700,
      recursive: true,
    });
    await writeFile(fixture.paths.candidateDatabasePath, 'new database');

    await fixture.store.discardBeforeActivation(fixture.paths);

    await expect(lstat(fixture.paths.importStagingRoot)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(
      lstat(fixture.paths.activationStagingOperationRoot),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(fixture.paths.activeDatabasePath, 'utf8')).resolves.toBe(
      'old database',
    );
    await expect(readFile(fixture.activePdfPath, 'utf8')).resolves.toBe(
      'old pdf',
    );
  });

  it('rejects unexpected candidate content and refuses unsafe cleanup', async () => {
    const fixture = await createFixture();
    await fixture.store.prepareCandidate(fixture.paths);
    await writeFile(fixture.paths.candidateDatabasePath, 'new database');
    await writeFile(
      join(fixture.paths.activationStagingOperationRoot, 'unexpected.txt'),
      'blocked',
    );

    await expect(
      fixture.store.inspectCandidate(fixture.paths),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_REPLACEMENT_STORAGE_FAILED',
      stage: 'candidateValidation',
    });
    await expect(
      fixture.store.discardBeforeActivation(fixture.paths),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_REPLACEMENT_STORAGE_FAILED',
      stage: 'cleanup',
    });
  });

  it('rejects a candidate database with another hard link', async () => {
    const fixture = await createFixture();
    await fixture.store.prepareCandidate(fixture.paths);
    await writeFile(fixture.paths.candidateDatabasePath, 'new database');
    await link(
      fixture.paths.candidateDatabasePath,
      join(fixture.root, 'linked.sqlite'),
    );

    await expect(
      fixture.store.inspectCandidate(fixture.paths),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_REPLACEMENT_STORAGE_FAILED',
      stage: 'candidateValidation',
    });
  });

  it.each(['inspectionRoot', 'wal', 'hardlinkedDatabase'] as const)(
    'preserves source staging before rejecting ambiguous candidate %s',
    async (ambiguity) => {
      const fixture = await createFixture();
      await fixture.store.prepareCandidate(fixture.paths);
      await mkdir(fixture.paths.importStagingRoot, {
        mode: 0o700,
        recursive: true,
      });
      const sourcePath = join(fixture.paths.importStagingRoot, 'profile.sqlite');
      await writeFile(sourcePath, 'original staged snapshot');
      await writeFile(fixture.paths.candidateDatabasePath, 'candidate database');
      if (ambiguity === 'inspectionRoot') {
        const inspectionRoot = join(
          fixture.paths.activationStagingOperationRoot,
          'inspection-unresolved',
        );
        await mkdir(inspectionRoot, { mode: 0o700 });
        await writeFile(
          join(inspectionRoot, 'inspection.sqlite'),
          'retained inspection copy',
        );
      } else if (ambiguity === 'wal') {
        await writeFile(
          fixture.paths.candidateDatabasePath + '-wal',
          'retained wal',
        );
      } else {
        await link(
          fixture.paths.candidateDatabasePath,
          join(fixture.root, 'linked-candidate.sqlite'),
        );
      }

      await expect(
        fixture.store.discardBeforeActivation(fixture.paths),
      ).rejects.toMatchObject({
        code: 'WORKSPACE_REPLACEMENT_STORAGE_FAILED',
        stage: 'cleanup',
      });

      await expect(readFile(sourcePath, 'utf8')).resolves.toBe(
        'original staged snapshot',
      );
      await expect(
        readFile(fixture.paths.candidateDatabasePath, 'utf8'),
      ).resolves.toBe('candidate database');
      await expect(
        readFile(fixture.paths.activeDatabasePath, 'utf8'),
      ).resolves.toBe('old database');
      if (ambiguity === 'inspectionRoot') {
        const inspectionPath = join(
          fixture.paths.activationStagingOperationRoot,
          'inspection-unresolved',
          'inspection.sqlite',
        );
        await expect(readFile(inspectionPath, 'utf8')).resolves.toBe(
          'retained inspection copy',
        );
      } else if (ambiguity === 'wal') {
        await expect(
          readFile(fixture.paths.candidateDatabasePath + '-wal', 'utf8'),
        ).resolves.toBe('retained wal');
      } else {
        expect((await lstat(fixture.paths.candidateDatabasePath)).nlink).toBe(2);
      }
    },
  );

  it('preserves the candidate when source staging has an unowned hard link', async () => {
    const fixture = await createFixture();
    await fixture.store.prepareCandidate(fixture.paths);
    await mkdir(fixture.paths.importStagingRoot, {
      mode: 0o700,
      recursive: true,
    });
    const sourcePath = join(fixture.paths.importStagingRoot, 'profile.sqlite');
    await writeFile(sourcePath, 'original staged snapshot');
    await link(sourcePath, join(fixture.root, 'linked-source.sqlite'));
    await writeFile(fixture.paths.candidateDatabasePath, 'candidate database');

    await expect(
      fixture.store.discardBeforeActivation(fixture.paths),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_REPLACEMENT_STORAGE_FAILED',
      stage: 'cleanup',
    });

    await expect(readFile(sourcePath, 'utf8')).resolves.toBe(
      'original staged snapshot',
    );
    await expect(
      readFile(fixture.paths.candidateDatabasePath, 'utf8'),
    ).resolves.toBe('candidate database');
  });

  it('fails closed when the target workspace layout is incomplete', async () => {
    const fixture = await createFixture();
    await rm(fixture.paths.activeDatabasePath);

    await expect(
      fixture.store.prepareCandidate(fixture.paths),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_REPLACEMENT_STORAGE_FAILED',
      stage: 'candidateRoot',
    });
  });
});

async function snapshot(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function visit(path: string, key: string): Promise<void> {
    const metadata = await lstat(path);
    result[key] = metadata.isDirectory() ? 'directory' : (await readFile(path)).toString('base64');
    if (metadata.isDirectory()) for (const name of (await readdir(path)).sort()) await visit(join(path, name), `${key}/${name}`);
  }
  await visit(root, 'root'); return result;
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'eky-workspace-replacement-root-'));
  cleanupRoots.push(root);
  const paths = deriveWorkspaceBackupReplacementPaths(
    root,
    TEST_REPLACEMENT_OPERATION_ID,
    TEST_REPLACEMENT_WORKSPACE_ID,
  );
  const activePdfPath = join(
    paths.activeArtifactRoot,
    'company-1',
    'invoice-1',
    'approved-invoice.pdf',
  );
  await mkdir(dirname(paths.activeDatabasePath), {
    mode: 0o700,
    recursive: true,
  });
  await mkdir(dirname(activePdfPath), { mode: 0o700, recursive: true });
  await writeFile(paths.activeDatabasePath, 'old database');
  await writeFile(activePdfPath, 'old pdf');
  return {
    activePdfPath,
    paths,
    root,
    store: new NodeWorkspaceBackupReplacementRootStore(),
  };
}
