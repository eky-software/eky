import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const importPathPattern = /(?:^|\/)workspaces\/import(?:\/|$)/;
const prohibitedDatabaseImports = new Set(['better-sqlite3', 'node:sqlite']);
const sourceExtensions = new Set(['.cts', '.js', '.jsx', '.mts', '.ts', '.tsx']);
const currentDirectory = dirname(fileURLToPath(import.meta.url));
const desktopSourceRoot = join(currentDirectory, '..', '..');
const desktopPackageRoot = join(desktopSourceRoot, '..');
const repositoryRoot = join(desktopPackageRoot, '..', '..');
const neutralWorkspaceContractFiles = [
  join(
    desktopSourceRoot,
    'workspaces',
    'maintenance',
    'workspaceMaintenanceLease.ts',
  ),
  join(
    desktopSourceRoot,
    'workspaces',
    'registry',
    'workspaceRegistryPort.ts',
  ),
  join(
    desktopSourceRoot,
    'workspaces',
    'runtime',
    'activeWorkspaceLifecyclePort.ts',
  ),
  join(
    desktopSourceRoot,
    'workspaces',
    'runtime',
    'workspaceRuntimeAbsencePort.ts',
  ),
];

describe('workspace backup import boundaries', () => {
  it('includes W3 production code while excluding colocated tests', async () => {
    const buildConfiguration = JSON.parse(
      await readFile(join(desktopPackageRoot, 'tsconfig.build.json'), 'utf8'),
    ) as { exclude?: unknown };

    expect(buildConfiguration.exclude).toContain('src/**/*.test.ts');
    expect(buildConfiguration.exclude).not.toContain('src/workspaces/**/*');
  });

  it('is not imported by desktop production entrypoints', async () => {
    await expectNoImportFeatureImports([
      join(desktopSourceRoot, 'main', 'desktopComposition.ts'),
      join(desktopSourceRoot, 'main', 'index.ts'),
      join(desktopSourceRoot, 'preload', 'index.cts'),
    ]);
  });

  it('is not imported by Electron E2E runtime, web or backend production source', async () => {
    const sourceFiles = (
      await Promise.all(
        [
          join(repositoryRoot, 'apps', 'e2e', 'src'),
          join(repositoryRoot, 'apps', 'web', 'src'),
          join(repositoryRoot, 'apps', 'backend', 'src'),
        ].map(listSourceFiles),
      )
    ).flat();

    await expectNoImportFeatureImports(sourceFiles);
  });

  it('does not own a SQLite driver in import production code', async () => {
    const sourceFiles = (await listSourceFiles(currentDirectory)).filter(
      (sourceFile) => !sourceFile.endsWith('.test.ts'),
    );

    for (const sourceFile of sourceFiles) {
      expect(
        readImportSpecifiers(await readFile(sourceFile, 'utf8')).filter(
          (specifier) => prohibitedDatabaseImports.has(specifier),
        ),
        sourceFile,
      ).toEqual([]);
    }
  });

  it('keeps neutral workspace contracts independent from import', async () => {
    await expectNoImportFeatureImports(neutralWorkspaceContractFiles);
  });
});

async function expectNoImportFeatureImports(sourceFiles: readonly string[]) {
  for (const sourceFile of sourceFiles) {
    expect(
      readImportSpecifiers(await readFile(sourceFile, 'utf8')).filter(
        (specifier) => importPathPattern.test(specifier.replaceAll('\\', '/')),
      ),
      sourceFile,
    ).toEqual([]);
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
