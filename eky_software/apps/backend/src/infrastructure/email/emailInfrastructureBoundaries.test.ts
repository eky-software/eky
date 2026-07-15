import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const emailInfrastructureRoot = fileURLToPath(new URL('.', import.meta.url));

describe('email infrastructure boundaries', () => {
  it('uses only Node built-ins and relative imports', () => {
    const violations: string[] = [];

    for (const filePath of listTypeScriptFiles(emailInfrastructureRoot)) {
      if (filePath.endsWith('.test.ts')) {
        continue;
      }

      const source = readFileSync(filePath, 'utf8');
      const imports = source.matchAll(/from\s+['"]([^'"]+)['"]/g);

      for (const match of imports) {
        const specifier = match[1] ?? '';

        if (!specifier.startsWith('.') && !specifier.startsWith('node:')) {
          violations.push(
            `${relative(emailInfrastructureRoot, filePath)} imports ${specifier}`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

function listTypeScriptFiles(directoryPath: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(directoryPath)) {
    const entryPath = join(directoryPath, entry);

    if (statSync(entryPath).isDirectory()) {
      files.push(...listTypeScriptFiles(entryPath));
    } else if (extname(entryPath) === '.ts') {
      files.push(entryPath);
    }
  }

  return files;
}
