import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const sourceRoot = resolveSourceRoot();

describe('desktop first-start boundaries', () => {
  it('admits the packaged build before resolving or adopting a workspace', async () => {
    const source = await readFile(
      join(sourceRoot, 'main', 'desktopComposition.ts'),
      'utf8',
    );
    const admission = source.indexOf(
      'await requirePreWorkspaceBuildAdmission',
    );
    const workspaceStartup = source.indexOf(
      'await resolveDesktopWorkspaceStartup',
    );

    expect(admission).toBeGreaterThan(-1);
    expect(workspaceStartup).toBeGreaterThan(admission);
  });

  it('resolves adoption recovery before any backend runtime can own SQLite', async () => {
    const compositionSource = await readFile(
      join(sourceRoot, 'main', 'desktopComposition.ts'),
      'utf8',
    );
    const startupSource = await readFile(
      join(
        sourceRoot,
        'workspaces',
        'runtime',
        'resolveActiveWorkspaceStartup.ts',
      ),
      'utf8',
    );
    const workspaceStartup = compositionSource.indexOf(
      'await resolveDesktopWorkspaceStartup',
    );
    const backendStart = compositionSource.indexOf(
      'backendHandle = await dependencies.startBackend',
    );
    const recovery = startupSource.indexOf(
      'await recoverWorkspaceLegacyAdoption',
    );
    const adoption = startupSource.indexOf(
      'await resolveWorkspaceLegacyAdoptionStartup',
    );

    expect(workspaceStartup).toBeGreaterThan(-1);
    expect(backendStart).toBeGreaterThan(workspaceStartup);
    expect(recovery).toBeGreaterThan(-1);
    expect(adoption).toBeGreaterThan(recovery);
  });

  it('opens the business window only after backend and first-start acceptance', async () => {
    const source = await readFile(
      join(sourceRoot, 'main', 'desktopComposition.ts'),
      'utf8',
    );
    const backendStart = source.indexOf(
      'backendHandle = await dependencies.startBackend',
    );
    const firstStartAcceptance = source.indexOf(
      'await firstStartUpdateCoordinator.acceptAfterBackendReady()',
    );
    const applicationWindow = source.indexOf(
      'applicationWindow = createApplicationWindow',
    );

    expect(backendStart).toBeGreaterThan(-1);
    expect(firstStartAcceptance).toBeGreaterThan(backendStart);
    expect(applicationWindow).toBeGreaterThan(firstStartAcceptance);
  });

  it('does not expose first-start or migration controls through preload', async () => {
    const preloadSource = await readFile(
      join(sourceRoot, 'preload', 'index.cts'),
      'utf8',
    );

    expect(preloadSource).not.toMatch(
      /firstStart|beforeMigrations|continueStartup|abortStartup|migrationGate/i,
    );
  });

  it('limits restore-compatible migrations to the restore journal validation startup', async () => {
    const source = await readFile(
      join(sourceRoot, 'main', 'desktopComposition.ts'),
      'utf8',
    );

    expect(source).toContain(
      "startupRecoveryAuthority === 'profileRestore' &&",
    );
    expect(source).toContain(
      "profileRestoreStartupMode === 'validateRestoredProfile'",
    );
    expect(source).toContain("? 'restoreCompatible'");
    expect(source).toContain(
      'migrationAuthority: restoredProfileMigrationAuthorized',
    );
  });
});

function resolveSourceRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..');
}
