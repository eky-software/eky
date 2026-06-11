import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const forbiddenImports = [
  /from\s+['"]hono(?:\/|['"])/,
  /from\s+['"]better-sqlite3(?:\/|['"])/,
  /from\s+['"]react(?:\/|['"])/,
  /from\s+['"]firebase(?:\/|['"])/,
  /from\s+['"]@eky\/api-client(?:\/|['"])/,
  /from\s+['"][^'"]*\/(?:database|http|infrastructure)(?:\/|\.|['"])/,
];

describe('invoicing domain boundaries', () => {
  it('does not import infrastructure, HTTP, UI, database, or API client code', () => {
    const domainDirectory = new URL('.', import.meta.url);
    const productionSourceFiles = readdirSync(domainDirectory)
      .filter((fileName) => fileName.endsWith('.ts'))
      .filter((fileName) => !fileName.endsWith('.test.ts'));

    for (const fileName of productionSourceFiles) {
      const source = readFileSync(new URL(fileName, domainDirectory), 'utf8');

      for (const forbiddenImport of forbiddenImports) {
        expect(source, fileName).not.toMatch(forbiddenImport);
      }
    }
  });
});
