import { join } from 'node:path';

import { createRealPortableWorkspaceBackup } from '../workspaces/workspaceBackupSystemTestSupport.js';
import { createLegacyInvoiceProfile, type LegacyInvoiceProfile } from './createLegacyInvoiceProfile.js';

export interface LegacyInvoiceBackup extends LegacyInvoiceProfile {
  readonly backupPath: string;
  readonly migrationChainIdentity: string;
  readonly profileId: string;
}

// The fixture remains on 038. Only the destination runtime may migrate it.
export async function createLegacyInvoiceBackup(input: {
  readonly runRoot: string;
  readonly userDataPath: string;
  readonly password: string;
}): Promise<Readonly<LegacyInvoiceBackup>> {
  if (process.env.EKY_E2E !== '1') {
    throw new Error('LEGACY_INVOICE_BACKUP_E2E_REQUIRED');
  }
  // Existing fixture admission validates the temp root, links and fresh profile.
  const profile = await createLegacyInvoiceProfile(input);
  const backupPath = join(input.userDataPath, 'legacy-invoice.ekybackup');
  const identity = await createRealPortableWorkspaceBackup({
    backupPath,
    databaseFilePath: join(input.userDataPath, 'runtime', 'data', 'eky.sqlite'),
    invoiceDocumentStorageRoot: join(input.userDataPath, 'runtime', 'storage', 'invoices'),
    migrationPolicy: 'compatibleHistoricalPrefix',
    password: input.password,
    stagingRoot: join(input.userDataPath, 'legacy-backup-staging'),
  });
  return Object.freeze({ ...profile, ...identity, backupPath });
}
