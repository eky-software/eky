import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

const registryImportPathPattern = /(?:^|\/)workspaces\/registry(?:\/|$)/;
const sourceExtensions = new Set(['.cts', '.js', '.jsx', '.mts', '.ts', '.tsx']);
const sourceReadBatchSize = 8;
const currentDirectory = dirname(fileURLToPath(import.meta.url));
const desktopSourceRoot = join(currentDirectory, '..', '..');
const desktopPackageRoot = join(desktopSourceRoot, '..');
const repositoryRoot = join(desktopPackageRoot, '..', '..');

describe('workspace registry activation boundaries', () => {
  it('includes workspace production code while excluding colocated tests', async () => {
    const buildConfiguration = JSON.parse(
      await readFile(join(desktopPackageRoot, 'tsconfig.build.json'), 'utf8'),
    ) as { exclude?: unknown };

    expect(buildConfiguration.exclude).toContain('src/**/*.test.ts');
    expect(buildConfiguration.exclude).not.toContain('src/workspaces/**/*');
  });

  it('is activated through desktop composition but not preload or the thin entrypoint', async () => {
    const composition = await readFile(
      join(desktopSourceRoot, 'main', 'desktopComposition.ts'),
      'utf8',
    );
    expect(composition).toContain(
      "../workspaces/runtime/resolveActiveWorkspaceStartup.js",
    );

    await expectNoRegistryImports([
      join(desktopSourceRoot, 'main', 'index.ts'),
      join(desktopSourceRoot, 'preload', 'index.cts'),
    ]);
  });

  it('is not imported by Electron E2E, web or backend source', async () => {
    const sourceFiles = (
      await Promise.all(
        [
          join(repositoryRoot, 'apps', 'e2e', 'src'),
          join(repositoryRoot, 'apps', 'web', 'src'),
          join(repositoryRoot, 'apps', 'backend', 'src'),
        ].map(listSourceFiles),
      )
    ).flat();

    await expectNoRegistryImports(sourceFiles);
  });
});

describe('workspace registry boundary source reading', () => {
  it('bounds concurrent reads and covers every file including the final partial batch', async () => {
    const sourceFiles = Array.from({ length: sourceReadBatchSize * 2 + 1 }, (_, index) => `source-${index}.ts`);
    let activeReads = 0;
    let peakReads = 0;
    const readSource = vi.fn(async (_file: string) => {
      activeReads += 1;
      peakReads = Math.max(peakReads, activeReads);
      await Promise.resolve();
      activeReads -= 1;
      return 'export const value = 1;';
    });

    await expectNoRegistryImports(sourceFiles, readSource);

    expect(readSource.mock.calls.map(([file]) => file)).toEqual(sourceFiles);
    expect(peakReads).toBe(sourceReadBatchSize);
    expect(activeReads).toBe(0);
  });

  it.each([
    "import { value } from '../workspaces/registry/value.js';",
    "const value = import('../workspaces/registry/value.js');",
    "const value = require('../workspaces/registry/value.js');",
    "import '../workspaces/registry/value.js';",
    "import { value } from '..\\workspaces\\registry\\value.js';",
  ])('still rejects a registry import after the first batch: %s', async (source) => {
    const sourceFiles = Array.from({ length: sourceReadBatchSize + 1 }, (_, index) => `source-${index}.ts`);
    const forbiddenFile = `source-${sourceReadBatchSize}.ts`;

    await expect(expectNoRegistryImports(sourceFiles, async (file) =>
      file === forbiddenFile ? source : 'export const value = 1;',
    )).rejects.toThrow(forbiddenFile);
  });

  it('drains an in-flight batch before surfacing the original read failure and starts no further batch', async () => {
    const sourceFiles = Array.from({ length: sourceReadBatchSize + 1 }, (_, index) => `source-${index}.ts`);
    const readFailure = new Error('SOURCE_READ_FAILED');
    let releaseReads!: () => void;
    const pendingReads = new Promise<void>((resolve) => { releaseReads = resolve; });
    const readSource = vi.fn(async (file: string) => {
      if (file === sourceFiles[0]) throw readFailure;
      await pendingReads;
      return '';
    });
    let finished = false;
    const result = expectNoRegistryImports(sourceFiles, readSource).then(
      () => { finished = true; return undefined; },
      (error: unknown) => { finished = true; return error; },
    );

    try {
      await setImmediate();
      expect(finished).toBe(false);
      expect(readSource.mock.calls.map(([file]) => file)).toEqual(sourceFiles.slice(0, sourceReadBatchSize));
    } finally {
      releaseReads();
    }

    expect(await result).toBe(readFailure);
    expect(readSource).toHaveBeenCalledTimes(sourceReadBatchSize);
  });

  it('does not read when the source list is empty', async () => {
    const readSource = vi.fn(async () => '');
    await expectNoRegistryImports([], readSource);
    expect(readSource).not.toHaveBeenCalled();
  });
});

async function expectNoRegistryImports(
  sourceFiles: readonly string[],
  readSource: (sourceFile: string) => Promise<string> = (sourceFile) => readFile(sourceFile, 'utf8'),
) {
  for (let offset = 0; offset < sourceFiles.length; offset += sourceReadBatchSize) {
    const batch = sourceFiles.slice(offset, offset + sourceReadBatchSize);
    // Drain all owned reads before asserting or surfacing a read failure.
    const sources = await Promise.allSettled(batch.map(async (sourceFile) => readSource(sourceFile)));

    for (const [index, source] of sources.entries()) {
      if (source.status === 'rejected') throw source.reason;
      const importSpecifiers = readImportSpecifiers(source.value);

      expect(
        importSpecifiers.filter((specifier) =>
          registryImportPathPattern.test(specifier.replaceAll('\\', '/')),
        ),
        batch[index],
      ).toEqual([]);
    }
  }
}

function readImportSpecifiers(source: string): readonly string[] {
  const specifiers: string[] = [];
  const patterns = [
    /\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1] !== undefined) {
        specifiers.push(match[1]);
      }
    }
  }
  return specifiers;
}

async function listSourceFiles(root: string): Promise<readonly string[]> {
  const files: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listSourceFiles(path)));
    } else if (entry.isFile() && sourceExtensions.has(extname(entry.name))) {
      files.push(path);
    }
  }
  return files;
}
