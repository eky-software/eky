import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

function sources(configName: string) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const path = fileURLToPath(new URL(`../${configName}`, import.meta.url));
  const read = ts.readConfigFile(path, ts.sys.readFile);
  expect(read.error).toBeUndefined();
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root);
  expect(parsed.errors).toEqual([]);
  return parsed.fileNames.map(name => name.replaceAll('\\', '/'));
}

describe('backend build source boundaries', () => {
  it.each(['tsconfig.build.json', 'tsconfig.e2e.json'])('omits unit-test fixtures from %s runtime roots', name => {
    const files = sources(name);
    expect(files.some(file => file.endsWith('/src/index.ts'))).toBe(true);
    expect(files.filter(file => file.endsWith('.fixture.ts') || file.endsWith('.test.ts') || file.includes('/src/testFixtures/'))).toEqual([]);
  });

  it('retains the same fixtures in the complete typecheck', () => {
    const files = sources('tsconfig.json');
    expect(files.some(file => file.endsWith('/invoiceSmtpApplication.fixture.ts'))).toBe(true);
    expect(files.some(file => file.endsWith('/invoicingSmtpComposition.test.ts'))).toBe(true);
  });
});
