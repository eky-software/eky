import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const desktopSourceRoot = join(currentDirectory, '..', '..');

describe('workspace management composition boundaries', () => {
  it('reuses the single main-owned lease, lifecycle and relaunch instances', async () => {
    const desktopComposition = await readFile(
      join(desktopSourceRoot, 'main', 'desktopComposition.ts'),
      'utf8',
    );
    const workspaceComposition = await readFile(
      join(currentDirectory, 'workspaceManagementComposition.ts'),
      'utf8',
    );

    expect(
      countOccurrences(
        desktopComposition,
        'new InMemoryWorkspaceMaintenanceLease(',
      ),
    ).toBe(1);
    expect(
      countOccurrences(
        desktopComposition,
        'new MainOwnedActiveWorkspaceLifecycle(',
      ),
    ).toBe(1);
    expect(
      countOccurrences(
        desktopComposition,
        'new DeferredWorkspaceRuntimeRelaunch(',
      ),
    ).toBe(1);

    expect(desktopComposition).toContain(
      'activeWorkspaceLifecycle,\n      appVersion: desktopAppVersion,',
    );
    expect(desktopComposition).toContain(
      'maintenanceLease: workspaceMaintenanceLease,',
    );
    expect(desktopComposition).toContain(
      'runtimeRelaunch: workspaceRuntimeRelaunch,',
    );

    expect(workspaceComposition).not.toContain(
      'new InMemoryWorkspaceMaintenanceLease(',
    );
    expect(workspaceComposition).not.toContain(
      'new MainOwnedActiveWorkspaceLifecycle(',
    );
    expect(workspaceComposition).not.toContain(
      'new DeferredWorkspaceRuntimeRelaunch(',
    );
    expect(
      countOccurrences(
        workspaceComposition,
        'maintenanceLease: options.maintenanceLease,',
      ),
    ).toBe(5);
    expect(workspaceComposition).toContain(
      'maintenanceState: options.maintenanceLease,',
    );
    expect(workspaceComposition).toContain(
      'runtimeRelaunchCompletion: options.runtimeRelaunch,',
    );
    expect(desktopComposition).toContain(
      'const disposeWorkspaceRuntimeCapabilities = async (): Promise<void> => {\n    workspaceManagementCapability?.dispose();',
    );
    expect(
      desktopComposition.indexOf('workspaceManagementCapability?.dispose();'),
    ).toBeLessThan(
      desktopComposition.indexOf('await backendHandle.stop();'),
    );
  });
});

function countOccurrences(source: string, value: string): number {
  return source.split(value).length - 1;
}
