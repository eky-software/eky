import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { expect, test } from '@playwright/test';

import { createE2eRunRoot } from '../../src/environment/createE2eRunRoot.js';
import { measurePathBytes } from '../../src/stress/measurePathBytes.js';
import { resolveDesktopEndurancePaths } from '../../src/stress/resolveDesktopEndurancePaths.js';

const workspaceIds = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
] as const;

test.describe('SYS-DESKTOP-ENDURANCE-PATHS-001 @critical', () => {
  test('measures active workspace data while keeping installation logs separate', () => {
    const root = createE2eRunRoot();
    try {
      writeRegistry(root, workspaceIds[1]);
      const activeRuntime = join(root, 'workspaces', workspaceIds[1], 'runtime');
      const inactiveRuntime = join(root, 'workspaces', workspaceIds[0], 'runtime');
      for (const runtime of [join(root, 'runtime'), inactiveRuntime]) {
        writeFixtureFile(join(runtime, 'data', 'eky.sqlite'), 'inactive-database');
        writeFixtureFile(join(runtime, 'storage', 'invoices', 'old.pdf'), 'inactive-pdf');
      }
      writeFixtureFile(join(activeRuntime, 'data', 'eky.sqlite'), 'active-db');
      writeFixtureFile(join(activeRuntime, 'storage', 'invoices', 'invoice.pdf'), 'pdf');
      writeFixtureFile(join(activeRuntime, 'secrets', 'company-email-smtp-v1.dat'), 'synthetic-ciphertext');
      writeFixtureFile(join(root, 'runtime', 'logs', 'desktop', 'test.jsonl'), '{}\n');

      const paths = resolveDesktopEndurancePaths(root);
      expect(paths).toEqual({
        databaseFilePath: join(activeRuntime, 'data', 'eky.sqlite'),
        documentsRoot: join(activeRuntime, 'storage', 'invoices'),
        emailSecretFilePath: join(activeRuntime, 'secrets', 'company-email-smtp-v1.dat'),
        logsRoot: join(root, 'runtime', 'logs'),
      });
      expect(measurePathBytes(paths.databaseFilePath)).toBe(9);
      expect(measurePathBytes(paths.documentsRoot)).toBe(3);
      expect(measurePathBytes(paths.logsRoot)).toBe(3);
      expect(existsSync(paths.emailSecretFilePath)).toBe(true);
      rmSync(paths.emailSecretFilePath);
      expect(existsSync(paths.emailSecretFilePath)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('rereads the active workspace instead of retaining a prior selection', () => {
    const root = createE2eRunRoot();
    try {
      writeRegistry(root, workspaceIds[0]);
      const before = resolveDesktopEndurancePaths(root);
      writeRegistry(root, workspaceIds[1]);
      const after = resolveDesktopEndurancePaths(root);
      expect(after.databaseFilePath).not.toBe(before.databaseFilePath);
      expect(after.documentsRoot).not.toBe(before.documentsRoot);
      expect(after.emailSecretFilePath).not.toBe(before.emailSecretFilePath);
      expect(after.logsRoot).toBe(before.logsRoot);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects an invalid active workspace without falling back to legacy files', () => {
    const root = createE2eRunRoot();
    try {
      writeFixtureFile(join(root, 'runtime', 'data', 'eky.sqlite'), 'legacy');
      writeRegistry(root, '../outside');
      expect(() => resolveDesktopEndurancePaths(root)).toThrow('active workspace is invalid');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function writeRegistry(root: string, activeWorkspaceId: string): void {
  for (const id of workspaceIds) {
    mkdirSync(join(root, 'workspaces', id), { recursive: true });
  }
  writeFileSync(join(root, 'workspace-registry-v1.json'), JSON.stringify({
    activeWorkspaceId,
    workspaces: workspaceIds.map((workspaceId) => ({
      workspaceId,
      layoutVersion: 1,
      lineageIdentity: { formatVersion: 1, profileId: 'a'.repeat(64) },
    })),
  }));
}

function writeFixtureFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}
