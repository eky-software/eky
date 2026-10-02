import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { boundarySourceReadBatchSize, inspectBoundarySourcesForTest } from '../boundarySourceTestSupport.js';

const foundationModulePattern =
  /workspaceFirstStartMigration(?:Journal|RegistryTransitions|TransitionCoordinator)/;
const prohibitedDatabaseImports = new Set(['better-sqlite3', 'node:sqlite']);
const sourceExtensions = new Set(['.cts', '.js', '.jsx', '.mts', '.ts', '.tsx']);
const currentDirectory = dirname(fileURLToPath(import.meta.url));
const desktopSourceRoot = join(currentDirectory, '..', '..');
const desktopPackageRoot = join(desktopSourceRoot, '..');
const repositoryRoot = join(desktopPackageRoot, '..', '..');
const foundationProductionFiles = [
  'workspaceFirstStartMigrationJournalCodec.ts',
  'workspaceFirstStartMigrationJournalDuplicateKeys.ts',
  'workspaceFirstStartMigrationJournalError.ts',
  'workspaceFirstStartMigrationJournalPaths.ts',
  'workspaceFirstStartMigrationJournalStore.ts',
  'workspaceFirstStartMigrationJournalTypes.ts',
  'workspaceFirstStartMigrationRegistryTransitions.ts',
  'workspaceFirstStartMigrationTransitionCoordinator.ts',
].map((fileName) => join(currentDirectory, fileName));

describe('workspace first-start migration foundation boundaries', () => {
  it('is wired only through desktop main and remains absent from preload', async () => {
    const compositionSource = await readFile(
      join(desktopSourceRoot, 'main', 'desktopComposition.ts'),
      'utf8',
    );

    expect(compositionSource).toContain(
      'createWorkspaceFirstStartMigrationComposition',
    );
    await expectNoFoundationImports([
      join(desktopSourceRoot, 'main', 'index.ts'),
      join(desktopSourceRoot, 'preload', 'index.cts'),
    ]);
  });

  it('is not imported by backend, web or Electron E2E production code', async () => {
    const sourceFiles = (
      await Promise.all(
        [
          join(repositoryRoot, 'apps', 'backend', 'src'),
          join(repositoryRoot, 'apps', 'e2e', 'src'),
          join(repositoryRoot, 'apps', 'web', 'src'),
        ].map(listSourceFiles),
      )
    ).flat();

    await expectNoFoundationImports(sourceFiles);
  });

  it('does not import a SQLite driver in foundation production code', async () => {
    for (const sourceFile of foundationProductionFiles) {
      expect(
        readImportSpecifiers(await readFile(sourceFile, 'utf8')).filter(
          (specifier) => prohibitedDatabaseImports.has(specifier),
        ),
        sourceFile,
      ).toEqual([]);
    }
  });
});

describe('workspace first-start migration foundation boundary rejection', () => {
  it.each([
    "import { value } from './workspaceFirstStartMigrationJournalStore.js';",
    "const value = import('./workspaceFirstStartMigrationRegistryTransitions.js');",
    "const value = require('./workspaceFirstStartMigrationTransitionCoordinator.js');",
    "import './workspaceFirstStartMigrationJournalStore.js';",
  ])('rejects the prohibited import in the final partial batch: %s', async (source) => {
    const sourceFiles = Array.from(
      { length: boundarySourceReadBatchSize + 1 },
      (_, index) => `source-${index}.test.ts`,
    );
    const forbiddenFile = `source-${boundarySourceReadBatchSize}.test.ts`;
    await expect(expectNoFoundationImports(sourceFiles, async (file) =>
      file === forbiddenFile ? source : 'export const value = 1;',
    )).rejects.toThrow(forbiddenFile);
  });
});

async function expectNoFoundationImports(
  sourceFiles: readonly string[],
  readSource?: (sourceFile: string) => Promise<string>,
) {
  await inspectBoundarySourcesForTest(sourceFiles, (source, sourceFile) => {
    expect(
      readImportSpecifiers(source).filter(
        (specifier) => foundationModulePattern.test(specifier),
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
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listSourceFiles(path)));
    } else if (entry.isFile() && sourceExtensions.has(extname(entry.name))) {
      files.push(path);
    }
  }
  return files;
}
