import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { boundarySourceReadBatchSize, inspectBoundarySourcesForTest } from '../boundarySourceTestSupport.js';

const creationImportPathPattern = /(?:^|\/)workspaces\/creation(?:\/|$)/;
const prohibitedDatabaseImports = new Set(['better-sqlite3', 'node:sqlite']);
const sourceExtensions = new Set(['.cts', '.js', '.jsx', '.mts', '.ts', '.tsx']);
const currentDirectory = dirname(fileURLToPath(import.meta.url));
const desktopSourceRoot = join(currentDirectory, '..', '..');
const desktopPackageRoot = join(desktopSourceRoot, '..');
const repositoryRoot = join(desktopPackageRoot, '..', '..');
const neutralWorkspaceContractFiles = [
  join(desktopSourceRoot, 'workspaces', 'maintenance', 'workspaceMaintenanceLease.ts'),
  join(desktopSourceRoot, 'workspaces', 'registry', 'workspaceRegistryPort.ts'),
  join(desktopSourceRoot, 'workspaces', 'runtime', 'activeWorkspaceLifecyclePort.ts'),
  join(desktopSourceRoot, 'workspaces', 'runtime', 'workspaceRuntimeAbsencePort.ts'),
];

describe('empty workspace creation boundaries', () => {
  it('includes W2 production code while excluding colocated tests', async () => {
    const buildConfiguration = JSON.parse(
      await readFile(join(desktopPackageRoot, 'tsconfig.build.json'), 'utf8'),
    ) as { exclude?: unknown };

    expect(buildConfiguration.exclude).toContain('src/**/*.test.ts');
    expect(buildConfiguration.exclude).not.toContain('src/workspaces/**/*');
  });

  it('is not imported by desktop production entrypoints', async () => {
    await expectNoCreationImports([
      join(desktopSourceRoot, 'main', 'desktopComposition.ts'),
      join(desktopSourceRoot, 'main', 'index.ts'),
      join(desktopSourceRoot, 'preload', 'index.cts'),
    ]);
  });

  it('is not imported by web or backend production source', async () => {
    const sourceFiles = (
      await Promise.all(
        [
          join(repositoryRoot, 'apps', 'web', 'src'),
          join(repositoryRoot, 'apps', 'backend', 'src'),
        ].map(listSourceFiles),
      )
    ).flat();

    await expectNoCreationImports(sourceFiles);
  });

  it('does not import a SQLite driver in workspace creation production code', async () => {
    const sourceFiles = (await listSourceFiles(currentDirectory)).filter(
      (sourceFile) => !sourceFile.endsWith('.test.ts'),
    );

    for (const sourceFile of sourceFiles) {
      const imports = readImportSpecifiers(await readFile(sourceFile, 'utf8'));
      expect(
        imports.filter((specifier) => prohibitedDatabaseImports.has(specifier)),
        sourceFile,
      ).toEqual([]);
    }
  });

  it('keeps neutral workspace contracts independent from creation', async () => {
    await expectNoCreationImports(neutralWorkspaceContractFiles);
  });
});

describe('workspace creation boundary rejection', () => {
  it.each([
    "import { value } from '../workspaces/creation/value.js';",
    "const value = import('../workspaces/creation/value.js');",
    "const value = require('../workspaces/creation/value.js');",
    "import '../workspaces/creation/value.js';",
    "import { value } from '..\\workspaces\\creation\\value.js';",
  ])('rejects the prohibited import in the final partial batch: %s', async (source) => {
    const sourceFiles = Array.from(
      { length: boundarySourceReadBatchSize + 1 },
      (_, index) => `source-${index}.test.ts`,
    );
    const forbiddenFile = `source-${boundarySourceReadBatchSize}.test.ts`;
    await expect(expectNoCreationImports(sourceFiles, async (file) =>
      file === forbiddenFile ? source : 'export const value = 1;',
    )).rejects.toThrow(forbiddenFile);
  });
});

async function expectNoCreationImports(
  sourceFiles: readonly string[],
  readSource?: (sourceFile: string) => Promise<string>,
) {
  await inspectBoundarySourcesForTest(sourceFiles, (source, sourceFile) => {
    expect(
      readImportSpecifiers(source).filter((specifier) =>
        creationImportPathPattern.test(specifier.replaceAll('\\', '/')),
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
      if (match[1] !== undefined) specifiers.push(match[1]);
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
