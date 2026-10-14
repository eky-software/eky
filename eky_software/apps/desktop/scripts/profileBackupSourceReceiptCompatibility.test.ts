import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ProfileMaintenanceState } from '../../backend/src/runtime/profileMaintenance/profileMaintenanceState.js';
import { ProfileBusinessArtifactStager } from '../../backend/src/runtime/profileSnapshot/stageProfileBusinessArtifacts.js';
import { assertProfileBackupSourceReceipt, createProfileBackupSourceEntries } from '../src/profileBackup/createProfileBackupSourceEntries.js';
import { createProfileSnapshotArtifactIdentity } from '../src/runtime/profileInspectionArtifactIdentity.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('backup receipt and existing producer compatibility', () => {
  it('accepts the existing document-identity filename from the real PDF snapshot stager', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eky-source-receipt-'));
    roots.push(root);
    const operationId = randomUUID();
    const stagingRoot = join(root, 'staging');
    const operationRoot = join(stagingRoot, operationId);
    const storageRoot = join(root, 'storage');
    await mkdir(operationRoot, { recursive: true, mode: 0o700 });
    await mkdir(storageRoot, { mode: 0o700 });
    const pdf = Buffer.from('%PDF-1.7 synthetic invoice');
    const documentId = 'synthetic-document';
    const sha256 = createHash('sha256').update(pdf).digest('hex');
    await writeFile(join(storageRoot, 'invoice.pdf'), pdf);
    await writeFile(join(operationRoot, 'profile.sqlite'), 'database');
    const maintenanceState = new ProfileMaintenanceState();
    await maintenanceState.begin(operationId, 1_000);
    try {
      await new ProfileBusinessArtifactStager({
        stagingRoot, invoiceDocumentStorageRoot: storageRoot, maintenanceState,
        catalog: { async listAuthoritativeArtifacts() {
          return [{ companyId: 'synthetic-company', documentId, documentType: 'approved_invoice_pdf' as const,
            fileName: 'invoice.pdf', invoiceId: 'synthetic-invoice', mediaType: 'application/pdf' as const,
            sha256, sizeBytes: pdf.byteLength, storagePath: 'invoice.pdf' }];
        } },
      }).stageArtifacts({ operationId, signal: new AbortController().signal });
    } finally { maintenanceState.end(operationId); }
    const source = await createProfileBackupSourceEntries(operationRoot);
    const database = source.find(entry => entry.type === 'database')!;
    const catalog = source.find(entry => entry.type === 'artifactCatalog')!;
    const artifact = source.find(entry => entry.type === 'businessArtifact')!;
    expect(artifact.logicalPath).toBe(`artifacts/invoicing/invoice-documents/${createHash('sha256').update(documentId).digest('hex')}.pdf`);
    expect(artifact.logicalPath).not.toContain(artifact.sha256);
    expect(() => assertProfileBackupSourceReceipt(source, {
      artifactCount: 1, artifactTotalByteSize: pdf.byteLength,
      artifactIdentity: createProfileSnapshotArtifactIdentity([{ logicalPath: artifact.logicalPath,
        byteSize: Number(artifact.contentLength), sha256: artifact.sha256 }]),
      databaseHealth: 'healthy', profileId: 'a'.repeat(64), migrationChainIdentity: 'b'.repeat(64), migrationPolicy: 'restoreCompatible',
      database: { byteSize: Number(database.contentLength), sha256: database.sha256 },
      artifactCatalog: { byteSize: Number(catalog.contentLength), sha256: catalog.sha256 },
    })).not.toThrow();
  });
});
