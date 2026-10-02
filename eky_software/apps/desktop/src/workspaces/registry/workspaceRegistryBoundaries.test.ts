import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { boundarySourceReadBatchSize, inspectBoundarySourcesForTest } from '../boundarySourceTestSupport.js';

const registryImportPathPattern = /(?:^|\/)workspaces\/registry(?:\/|$)/;
const sourceExtensions = new Set(['.cts', '.js', '.jsx', '.mts', '.ts', '.tsx']);
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

describe('workspace registry boundary rejection', () => {
  it.each([
    "import { value } from '../workspaces/registry/value.js';",
    "const value = import('../workspaces/registry/value.js');",
    "const value = require('../workspaces/registry/value.js');",
    "import '../workspaces/registry/value.js';",
    "import { value } from '..\\workspaces\\registry\\value.js';",
  ])('still rejects a registry import after the first batch: %s', async (source) => {
    const sourceFiles = Array.from({ length: boundarySourceReadBatchSize + 1 }, (_, index) => `source-${index}.ts`);
    const forbiddenFile = `source-${boundarySourceReadBatchSize}.ts`;

    await expect(expectNoRegistryImports(sourceFiles, async (file) =>
      file === forbiddenFile ? source : 'export const value = 1;',
    )).rejects.toThrow(forbiddenFile);
  });
});

async function expectNoRegistryImports(
  sourceFiles: readonly string[],
  readSource?: (sourceFile: string) => Promise<string>,
) {
  await inspectBoundarySourcesForTest(sourceFiles, (source, sourceFile) => {
    const importSpecifiers = readImportSpecifiers(source);

    expect(
      importSpecifiers.filter((specifier) =>
        registryImportPathPattern.test(specifier.replaceAll('\\', '/')),
      ),
      sourceFile,
    ).toEqual([]);
  }, readSource);
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
