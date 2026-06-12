import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const moduleDirectory = new URL('.', import.meta.url);
const moduleDirectoryPath = fileURLToPath(moduleDirectory);

function listProductionSourceFiles(directoryPath: string): string[] {
  return readdirSync(directoryPath).flatMap((entry) => {
    const entryPath = join(directoryPath, entry);

    if (statSync(entryPath).isDirectory()) {
      return listProductionSourceFiles(entryPath);
    }

    return entry.endsWith('.ts') && !entry.endsWith('.test.ts')
      ? [entryPath]
      : [];
  });
}

describe('invoicing module boundaries', () => {
  it('does not import Customers, UI, or API client code', () => {
    const productionSourceFiles = listProductionSourceFiles(moduleDirectoryPath);
    const forbiddenImports = [
      /from\s+['"][^'"]*(?:modules\/customers|\/customers)(?:\/|['"])/,
      /from\s+['"]react(?:\/|['"])/,
      /from\s+['"]@eky\/api-client(?:\/|['"])/,
    ];

    for (const filePath of productionSourceFiles) {
      const source = readFileSync(filePath, 'utf8');

      for (const forbiddenImport of forbiddenImports) {
        expect(source, filePath).not.toMatch(forbiddenImport);
      }
    }
  });

  it('keeps database types out of application, HTTP, and repository ports', () => {
    const checkedDirectories = ['application', 'http', 'ports'];

    for (const directory of checkedDirectories) {
      const directoryPath = fileURLToPath(
        new URL(`${directory}/`, moduleDirectory),
      );

      for (const filePath of listProductionSourceFiles(directoryPath)) {
        const source = readFileSync(filePath, 'utf8');

        expect(source, filePath).not.toMatch(/better-sqlite3/);
        expect(source, filePath).not.toMatch(/\/database(?:\/|\.|['"])/);
        expect(source, filePath).not.toMatch(/\/infrastructure(?:\/|\.|['"])/);
      }
    }
  });

  it('keeps Hono inside the HTTP adapter', () => {
    const checkedDirectories = [
      'application',
      'domain',
      'infrastructure',
      'ports',
    ];

    for (const directory of checkedDirectories) {
      const directoryPath = fileURLToPath(
        new URL(`${directory}/`, moduleDirectory),
      );

      for (const filePath of listProductionSourceFiles(directoryPath)) {
        const source = readFileSync(filePath, 'utf8');

        expect(source, filePath).not.toMatch(/from\s+['"]hono(?:\/|['"])/);
      }
    }
  });

  it('keeps invoice calculations out of the SQLite adapter', () => {
    const adapterSource = readFileSync(
      fileURLToPath(
        new URL(
          'infrastructure/sqliteInvoiceDraftRepository.ts',
          moduleDirectory,
        ),
      ),
      'utf8',
    );

    expect(adapterSource).not.toMatch(/calculateInvoiceLine/);
    expect(adapterSource).not.toMatch(/calculateInvoiceTotals/);
  });

  it('keeps invoice calculations out of the HTTP adapter', () => {
    const httpDirectoryPath = fileURLToPath(
      new URL('http/', moduleDirectory),
    );

    for (const filePath of listProductionSourceFiles(httpDirectoryPath)) {
      const source = readFileSync(filePath, 'utf8');

      expect(source, filePath).not.toMatch(/calculateInvoiceLine/);
      expect(source, filePath).not.toMatch(/calculateInvoiceTotals/);
    }
  });
});
