import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { acquireWorkspaceProcessReservation } from '../../../desktop/src/runtime/workspaceProcessReservation.js';
import { deriveWorkspaceRoot } from '../../../desktop/src/workspaces/registry/deriveWorkspaceRoot.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../../../desktop/src/workspaces/registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../../../desktop/src/workspaces/registry/workspaceRegistryStore.js';
import { prepareWorkspaceColdRecoveryPackagedSmoke } from '../../src/data/prepareWorkspaceColdRecoveryPackagedSmoke.js';
import { createE2eRunRoot } from '../../src/environment/createE2eRunRoot.js';
import { removeE2eRunRoot } from '../../src/environment/removeE2eRunRoot.js';

for (const kind of ['creation', 'import'] as const) {
  test(`SYS-WORKSPACE-COLD-PACKAGED-${kind.toUpperCase()}-001 @critical @recovery validates input and rejects incomplete or changed recovery`, async () => {
    const runRoot = createE2eRunRoot();
    const smokeToken = randomBytes(16).toString('hex');
    const previous = process.env.EKY_E2E;
    process.env.EKY_E2E = '1';
    let passed = false;
    let prepared: Awaited<ReturnType<typeof prepareWorkspaceColdRecoveryPackagedSmoke>> | undefined;
    try {
      prepared = await prepareWorkspaceColdRecoveryPackagedSmoke({ kind, runRoot, smokeToken });
      const journal = readFileSync(prepared.journalPaths.currentPath);
      await expect(prepared.verifyRecovered()).rejects.toThrow('WORKSPACE_COLD_PACKAGED_JOURNAL_REMAINS');
      await expect(prepareWorkspaceColdRecoveryPackagedSmoke({ kind, runRoot, smokeToken })).rejects.toMatchObject({ code: 'EEXIST' });
      expect(readFileSync(prepared.journalPaths.currentPath)).toEqual(journal);
      const owner = await acquireWorkspaceProcessReservation({ userDataRoot: prepared.userDataRoot, signal: AbortSignal.timeout(5_000) });
      try { await expect(prepared.verifyRecovered()).rejects.toMatchObject({ reason: 'busy' }); }
      finally { await owner.release(); }
      // Simulate postconditions only: this unit-level check does not claim a runtime recovery.
      await unlink(prepared.journalPaths.currentPath);
      await expect(prepared.verifyRecovered()).rejects.toThrow('WORKSPACE_COLD_PACKAGED_REGISTRY_MISMATCH');
      const registry = new WorkspaceRegistryStore({ installationRoot: prepared.userDataRoot,
        filePath: join(prepared.userDataRoot, WORKSPACE_REGISTRY_FILE_NAME) });
      await registry.write(prepared.expectedRegistry);
      await prepared.verifyRecovered();
      writeFileSync(prepared.journalPaths.nextPath, journal);
      await expect(prepared.verifyRecovered()).rejects.toThrow('WORKSPACE_COLD_PACKAGED_JOURNAL_REMAINS');
      await unlink(prepared.journalPaths.nextPath);
      const target = prepared.expectedRegistry.workspaces[1]!;
      const targetRoot = deriveWorkspaceRoot(prepared.userDataRoot, target.workspaceId, 1).workspaceRoot;
      const changedPath = join(targetRoot, kind === 'creation' ? 'runtime/data/eky.sqlite' : 'runtime/storage/invoices/legacy/original.pdf');
      writeFileSync(changedPath, 'synthetic mutation');
      await expect(prepared.verifyRecovered()).rejects.toThrow('WORKSPACE_COLD_PACKAGED_CONTENT_CHANGED');
      passed = true;
    } finally {
      if (previous === undefined) delete process.env.EKY_E2E;
      else process.env.EKY_E2E = previous;
      if (passed && prepared) {
        const owner = await acquireWorkspaceProcessReservation({ userDataRoot: prepared.userDataRoot, signal: AbortSignal.timeout(5_000) });
        await owner.release();
        await rm(prepared.smokeRoot, { recursive: true });
        await removeE2eRunRoot(runRoot);
      }
    }
  });
}

test('SYS-WORKSPACE-COLD-PACKAGED-ADMISSION-001 @critical @security rejects an invalid marker, token or source root before writes', async () => {
  const runRoot = createE2eRunRoot();
  const smokeToken = randomBytes(16).toString('hex');
  const previous = process.env.EKY_E2E;
  let passed = false;
  try {
    delete process.env.EKY_E2E;
    const input = { kind: 'creation' as const, runRoot, smokeToken };
    await expect(prepareWorkspaceColdRecoveryPackagedSmoke(input)).rejects.toThrow('WORKSPACE_COLD_PACKAGED_ADMISSION_FAILED');
    process.env.EKY_E2E = '1';
    for (const token of ['', '../escape', 'A'.repeat(32)]) {
      await expect(prepareWorkspaceColdRecoveryPackagedSmoke({ ...input, smokeToken: token })).rejects.toThrow('WORKSPACE_COLD_PACKAGED_ADMISSION_FAILED');
    }
    await expect(prepareWorkspaceColdRecoveryPackagedSmoke({ ...input, runRoot: tmpdir() })).rejects.toThrow('WORKSPACE_COLD_PACKAGED_ROOT_INVALID');
    expect(existsSync(join(realpathSync(tmpdir()), 'eky-desktop-smoke', smokeToken))).toBe(false);
    expect(readdirSync(runRoot)).toEqual([]);
    passed = true;
  } finally {
    if (previous === undefined) delete process.env.EKY_E2E;
    else process.env.EKY_E2E = previous;
    if (passed) await removeE2eRunRoot(runRoot);
  }
});
