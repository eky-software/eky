import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const desktopSourceRoot = join(currentDirectory, '..', '..');

describe('workspace management composition boundaries', () => {
  it('keeps inspection admission open for the preRestore point after write quiescence', async () => {
    const composition = await readFile(join(desktopSourceRoot, 'main', 'desktopComposition.ts'), 'utf8');
    const lifecycleResources = composition.split('const activeWorkspaceLifecycle = new MainOwnedActiveWorkspaceLifecycle(')[1]
      ?.split('const workspaceManagementComposition =')[0];
    expect(lifecycleResources).toBeDefined();
    expect(lifecycleResources).toMatch(/stopRecoveryPointScheduler\(\)\s*\{\s*return recoveryPointScheduler\.stopChecks\(\);\s*\}/u);
    const disposal = composition.split('const disposeWorkspaceRuntimeCapabilities =')[1]
      ?.split('let closeBrokersTask:')[0];
    expect(disposal).toContain('profileSnapshotInspectionClient.closeAdmission();');
    expect(disposal).toContain('await profileSnapshotInspectionClient.shutdown();');
  });

  it('keeps the composition proof on the real candidate ownership and preparation port', async () => {
    const proof = await readFile(
      join(desktopSourceRoot, '..', 'e2e', 'workspaceManagementCompositionProof.ts'),
      'utf8',
    );

    expect(proof).toContain('assertMainOwned: sourceReservation.assertMainOwned,');
    expect(proof).toContain('assertMainOwned: primaryReservation.assertMainOwned,');
    expect(proof).toContain('assertMainOwned: input.reservation.assertMainOwned,');
    expect(countOccurrences(proof, 'bindCandidate: ({ generationId, prepareMainOwned })')).toBe(3);
    expect(proof).toContain('sourceReservation!.bind(generationId, assertProofSingleInstanceOwnership, prepareMainOwned)');
    expect(proof).toContain('primaryReservation!.bind(generationId, assertProofSingleInstanceOwnership, prepareMainOwned)');
    expect(proof).toContain("input.maintenanceLease.captureCurrentOwner(['create', 'import', 'replace']),\n        prepareMainOwned,");
  });

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
      'activeWorkspaceLifecycle: {',
    );
    expect(desktopComposition).toContain('activeWorkspaceLifecycle.quiesceWrites(workspaceId)');
    expect(desktopComposition).toContain('activeWorkspaceLifecycle.stopAndProveHandlesClosed(workspaceId)');
    expect(desktopComposition).toContain('activeWorkspaceLifecycle.ensurePreviousWorkspaceRunning(workspaceId)');
    expect(desktopComposition).toContain('await activeWorkspaceLifecycle.assertNoActiveWorkspaceRuntime();\n          await workspaceReservation.assertMainOwned();');
    expect(desktopComposition).toContain("workspaceMaintenanceLease.captureCurrentOwner(['create', 'import', 'replace'])");
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
    ).toBe(6);
    expect(workspaceComposition).toContain("completionMode: 'beforeRuntimeStart' as const");
    expect(workspaceComposition).toContain('assertRecoveryAdmission: options.assertRecoveryAdmission,');
    expect(workspaceComposition).toContain('workspaceRuntimeAbsence: options.workspaceRuntimeAbsence,');
    expect(workspaceComposition).toContain(
      'maintenanceState: options.maintenanceLease,',
    );
    expect(workspaceComposition).toContain(
      'runtimeRelaunchCompletion: options.runtimeRelaunch,',
    );
    expect(desktopComposition).toContain(
      'disposeCapabilities: disposeWorkspaceRuntimeCapabilities,',
    );
    expect(desktopComposition).toContain(
      'const capabilities = [\n        workspaceManagementCapability,',
    );
    expect(desktopComposition).toContain('capability?.dispose();');
    // Runtime ordering is covered by lifecycle and real composition shutdown tests.
  });
});

function countOccurrences(source: string, value: string): number {
  return source.split(value).length - 1;
}
