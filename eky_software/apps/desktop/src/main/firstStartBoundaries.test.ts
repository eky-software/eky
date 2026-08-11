import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const sourceRoot = resolveSourceRoot();

describe('desktop first-start boundaries', () => {
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
});

function resolveSourceRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..');
}
