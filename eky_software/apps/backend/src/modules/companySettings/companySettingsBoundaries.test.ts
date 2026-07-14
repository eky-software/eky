import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)));

describe('Company Settings module boundaries', () => {
  it('keeps the email secret reader out of HTTP and public response code', async () => {
    const httpFiles = await listSourceFiles(join(moduleRoot, 'http'));
    const httpSource = (
      await Promise.all(httpFiles.map((filePath) => readFile(filePath, 'utf8')))
    ).join('\n');

    expect(httpSource).not.toMatch(/CompanyEmailSecretReader|getSecret\s*\(/);
    expect(httpSource).not.toMatch(/readCompanyEmailSecret/);
  });

  it('keeps Electron imports outside the backend module', async () => {
    const moduleFiles = await listSourceFiles(moduleRoot);
    const moduleSource = (
      await Promise.all(moduleFiles.map((filePath) => readFile(filePath, 'utf8')))
    ).join('\n');

    expect(moduleSource).not.toMatch(/from ['"]electron['"]/);
  });
});

async function listSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listSourceFiles(entryPath)));
    } else if (/\.ts$/.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
}
