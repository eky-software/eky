import { expect, test } from '@playwright/test';

import { runPackagedSmoke } from '../../../desktop/scripts/run-packaged-smoke.mjs';
import { prepareWorkspaceColdRecoveryPackagedSmoke } from '../../src/data/prepareWorkspaceColdRecoveryPackagedSmoke.js';
import { createE2eRunRoot } from '../../src/environment/createE2eRunRoot.js';
import { removeE2eRunRoot } from '../../src/environment/removeE2eRunRoot.js';

for (const kind of ['creation', 'import'] as const) {
  test(`DESK-WORKSPACE-COLD-PACKAGED-${kind.toUpperCase()}-001 recovers a published workspace and preserves it across restore restart`, async () => {
    if (process.platform !== 'win32') throw new Error('WORKSPACE_COLD_PACKAGED_REQUIRES_WINDOWS');
    const runRoot = createE2eRunRoot();
    const previous = process.env.EKY_E2E;
    process.env.EKY_E2E = '1';
    let passed = false;
    let prepared: Awaited<ReturnType<typeof prepareWorkspaceColdRecoveryPackagedSmoke>> | undefined;
    try {
      await runPackagedSmoke({ workspaceRecoveryPreparation: {
        async prepare({ smokeToken, smokeRootDirectory }) {
          prepared = await prepareWorkspaceColdRecoveryPackagedSmoke({ kind, runRoot, smokeToken });
          expect(prepared.smokeRoot).toBe(smokeRootDirectory);
        },
        async afterRestoreExit() {
          if (!prepared) throw new Error('WORKSPACE_COLD_PACKAGED_PREPARATION_MISSING');
          await prepared.verifyRecovered();
        },
        async verifySourcePreserved() {
          if (!prepared) throw new Error('WORKSPACE_COLD_PACKAGED_PREPARATION_MISSING');
          await prepared.verifyRecovered();
        },
      } });
      passed = true;
    } finally {
      if (previous === undefined) delete process.env.EKY_E2E;
      else process.env.EKY_E2E = previous;
      if (passed) await removeE2eRunRoot(runRoot);
    }
  });
}
