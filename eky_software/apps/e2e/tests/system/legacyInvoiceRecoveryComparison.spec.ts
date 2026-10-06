import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { createDatabaseConnection } from '../../../backend/src/database/connection/createDatabaseConnection.js';
import { runMigrations } from '../../../backend/src/database/migration/runMigrations.js';
import { createLegacyInvoiceProfile } from '../../src/data/createLegacyInvoiceProfile.js';
import { assertLegacyInvoiceRecoveryPreserved, readLegacyInvoiceRecoverySnapshot } from '../../src/data/legacyInvoiceRecoveryComparison.js';
import { createE2eRunRoot } from '../../src/environment/createE2eRunRoot.js';
import { removeE2eRunRoot } from '../../src/environment/removeE2eRunRoot.js';

for (const changed of [false, true]) {
  test(`SYS-LEGACY-COMPARISON-00${changed ? 2 : 1} @critical @recovery ${changed ? 'rejects changed historical timestamps' : 'accepts preserved legacy rows with added revision columns'}`, async () => {
    const runRoot = createE2eRunRoot();
    const userDataPath = join(runRoot, 'user-data');
    mkdirSync(userDataPath);
    const priorMarker = process.env.EKY_E2E;
    process.env.EKY_E2E = '1';
    let passed = false;
    try {
      await createLegacyInvoiceProfile({ runRoot, userDataPath });
      const sourcePath = join(userDataPath, 'runtime/data/eky.sqlite');
      const original = readLegacyInvoiceRecoverySnapshot(sourcePath);
      const destination = join(runRoot, 'restored.sqlite');
      copyFileSync(sourcePath, destination);
      const database = createDatabaseConnection({ databaseFilePath: destination });
      try {
        if (changed) database.exec("UPDATE invoice_delivery_events SET created_at = '2026-06-14T12:00:00.000Z'");
        await runMigrations(database);
      } finally { database.close(); }
      const restored = readLegacyInvoiceRecoverySnapshot(destination);
      if (changed) expect(() => assertLegacyInvoiceRecoveryPreserved(original, restored))
        .toThrow('PACKAGED_LEGACY_BUSINESS_CONTENT_CHANGED');
      else assertLegacyInvoiceRecoveryPreserved(original, restored);
      assertLegacyInvoiceRecoveryPreserved(original, readLegacyInvoiceRecoverySnapshot(sourcePath));
      passed = true;
    } finally {
      if (priorMarker === undefined) delete process.env.EKY_E2E;
      else process.env.EKY_E2E = priorMarker;
      if (passed) await removeE2eRunRoot(runRoot);
    }
  });
}
