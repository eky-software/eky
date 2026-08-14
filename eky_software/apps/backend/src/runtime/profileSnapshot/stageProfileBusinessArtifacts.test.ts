import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type {
  InvoiceBackupArtifactCatalog,
  InvoiceBackupArtifactCatalogItem,
} from '../../modules/invoicing/ports/invoiceBackupArtifactCatalog.js';
import { ProfileMaintenanceState } from '../profileMaintenance/profileMaintenanceState.js';
import { ProfileBusinessArtifactStager } from './stageProfileBusinessArtifacts.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) =>
      rm(path, { force: true, recursive: true }),
    ),
  );
});

describe('profile business artifact staging', () => {
  it('copies and catalogs every verified invoice PDF', async () => {
    const fixture = await createFixture();
    const first = await fixture.addPdf('document-b', '%PDF-1.7 second');
    const second = await fixture.addPdf('document-a', '%PDF-1.7 first');
    fixture.catalog.items = [first, second];

    const metadata = await fixture.stager.stageArtifacts({
      operationId: fixture.operationId,
      signal: new AbortController().signal,
    });
    const catalogPath = join(
      fixture.operationRoot,
      'snapshot-catalog-v1.json',
    );
    const catalogBytes = await readFile(catalogPath);
    const catalog = JSON.parse(catalogBytes.toString('utf8')) as {
      artifacts: Array<{
        logicalPath: string;
        owner: string;
        restoreValidationIdentity: {
          documentId: string;
          invoiceId: string;
        };
        sha256: string;
      }>;
      formatVersion: number;
    };

    expect(metadata).toEqual({
      artifactCount: 2,
      artifactTotalByteSize:
        first.sizeBytes + second.sizeBytes,
      catalogByteSize: catalogBytes.byteLength,
      logicalPath: 'snapshot-catalog-v1.json',
      sha256: sha256(catalogBytes),
    });
    expect(catalog.formatVersion).toBe(1);
    expect(catalog.artifacts).toHaveLength(2);
    expect(catalog.artifacts.map((artifact) => artifact.owner)).toEqual([
      'invoicing',
      'invoicing',
    ]);

    for (const artifact of catalog.artifacts) {
      const staged = await readFile(
        join(fixture.operationRoot, ...artifact.logicalPath.split('/')),
      );
      expect(staged.subarray(0, 5).toString('ascii')).toBe('%PDF-');
      expect(sha256(staged)).toBe(artifact.sha256);
      expect(
        ['document-a', 'document-b'],
      ).toContain(artifact.restoreValidationIdentity.documentId);
    }

    fixture.maintenanceState.end(fixture.operationId);
  });

  it('supports an empty catalog without requiring a storage directory', async () => {
    const fixture = await createFixture({ createStorageRoot: false });

    await expect(
      fixture.stager.stageArtifacts({
        operationId: fixture.operationId,
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({
      artifactCount: 0,
      artifactTotalByteSize: 0,
    });
    await expect(
      readFile(
        join(fixture.operationRoot, 'snapshot-catalog-v1.json'),
        'utf8',
      ),
    ).resolves.toBe('{"artifacts":[],"formatVersion":1}\n');
    await expect(
      lstat(join(fixture.operationRoot, 'artifacts')),
    ).rejects.toMatchObject({ code: 'ENOENT' });

    fixture.maintenanceState.end(fixture.operationId);
  });

  it.each([
    ['missing source', 'missing.pdf', undefined],
    ['traversal source', '../outside.pdf', '%PDF-1.7 outside'],
    ['invalid signature', 'invalid.pdf', 'not-a-pdf'],
  ])('rejects %s', async (_name, storagePath, content) => {
    const fixture = await createFixture();
    const bytes = Buffer.from(content ?? '%PDF-1.7 missing', 'utf8');
    if (content !== undefined && !storagePath.startsWith('..')) {
      await writeFile(join(fixture.storageRoot, storagePath), bytes);
    }
    fixture.catalog.items = [
      createCatalogItem('document-a', storagePath, bytes),
    ];

    await expect(
      fixture.stager.stageArtifacts({
        operationId: fixture.operationId,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow();

    fixture.maintenanceState.end(fixture.operationId);
  });

  it('rejects metadata hash and size mismatches', async () => {
    const fixture = await createFixture();
    const item = await fixture.addPdf('document-a', '%PDF-1.7 valid');
    fixture.catalog.items = [
      { ...item, sha256: '0'.repeat(64), sizeBytes: item.sizeBytes + 1 },
    ];

    await expect(
      fixture.stager.stageArtifacts({
        operationId: fixture.operationId,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('PROFILE_SNAPSHOT_ARTIFACT_METADATA_MISMATCH');

    fixture.maintenanceState.end(fixture.operationId);
  });

  it.skipIf(process.platform === 'win32')(
    'rejects symbolic-link invoice documents',
    async () => {
      const fixture = await createFixture();
      const target = join(fixture.storageRoot, 'target.pdf');
      const link = join(fixture.storageRoot, 'linked.pdf');
      const bytes = Buffer.from('%PDF-1.7 target', 'utf8');
      await writeFile(target, bytes);
      await symlink(target, link);
      fixture.catalog.items = [
        createCatalogItem('document-a', 'linked.pdf', bytes),
      ];

      await expect(
        fixture.stager.stageArtifacts({
          operationId: fixture.operationId,
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow('PROFILE_SNAPSHOT_ARTIFACT_PATH_INVALID');

      fixture.maintenanceState.end(fixture.operationId);
    },
  );

  it('does not overwrite an existing staged artifact', async () => {
    const fixture = await createFixture();
    const item = await fixture.addPdf('document-a', '%PDF-1.7 valid');
    fixture.catalog.items = [item];
    const logicalFileName = `${sha256(
      Buffer.from(item.documentId, 'utf8'),
    )}.pdf`;
    const artifactDirectory = join(
      fixture.operationRoot,
      'artifacts',
      'invoicing',
      'invoice-documents',
    );
    await mkdir(artifactDirectory, { mode: 0o700, recursive: true });
    const existingPath = join(artifactDirectory, logicalFileName);
    await writeFile(existingPath, 'keep', 'utf8');

    await expect(
      fixture.stager.stageArtifacts({
        operationId: fixture.operationId,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('PROFILE_SNAPSHOT_DESTINATION_EXISTS');
    await expect(readFile(existingPath, 'utf8')).resolves.toBe('keep');

    fixture.maintenanceState.end(fixture.operationId);
  });

  it('requires active matching maintenance and honors cancellation', async () => {
    const fixture = await createFixture();
    fixture.maintenanceState.end(fixture.operationId);

    await expect(
      fixture.stager.stageArtifacts({
        operationId: fixture.operationId,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('PROFILE_MAINTENANCE_OPERATION_MISMATCH');

    await fixture.maintenanceState.begin(fixture.operationId, 1_000);
    const controller = new AbortController();
    controller.abort();
    await expect(
      fixture.stager.stageArtifacts({
        operationId: fixture.operationId,
        signal: controller.signal,
      }),
    ).rejects.toThrow('PROFILE_SNAPSHOT_CANCELLED');

    fixture.maintenanceState.end(fixture.operationId);
  });
});

async function createFixture(
  options: { createStorageRoot?: boolean } = {},
): Promise<{
  addPdf(
    documentId: string,
    content: string,
  ): Promise<InvoiceBackupArtifactCatalogItem>;
  catalog: MutableCatalog;
  maintenanceState: ProfileMaintenanceState;
  operationId: string;
  operationRoot: string;
  stager: ProfileBusinessArtifactStager;
  storageRoot: string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'eky-artifact-staging-'));
  temporaryRoots.push(root);
  const stagingRoot = join(root, 'staging');
  const storageRoot = join(root, 'storage');
  const operationId = randomUUID();
  const operationRoot = join(stagingRoot, operationId);
  await mkdir(operationRoot, { mode: 0o700, recursive: true });
  await chmod(stagingRoot, 0o700);
  await chmod(operationRoot, 0o700);
  if (options.createStorageRoot !== false) {
    await mkdir(storageRoot, { mode: 0o700 });
  }

  const maintenanceState = new ProfileMaintenanceState();
  await maintenanceState.begin(operationId, 1_000);
  const catalog = new MutableCatalog();

  return {
    async addPdf(documentId, content) {
      const bytes = Buffer.from(content, 'utf8');
      const storagePath = `${documentId}.pdf`;
      await writeFile(join(storageRoot, storagePath), bytes);
      return createCatalogItem(documentId, storagePath, bytes);
    },
    catalog,
    maintenanceState,
    operationId,
    operationRoot,
    stager: new ProfileBusinessArtifactStager({
      catalog,
      invoiceDocumentStorageRoot: storageRoot,
      maintenanceState,
      stagingRoot,
    }),
    storageRoot,
  };
}

class MutableCatalog implements InvoiceBackupArtifactCatalog {
  items: readonly InvoiceBackupArtifactCatalogItem[] = [];

  async listAuthoritativeArtifacts(): Promise<
    readonly InvoiceBackupArtifactCatalogItem[]
  > {
    return this.items;
  }
}

function createCatalogItem(
  documentId: string,
  storagePath: string,
  bytes: Buffer,
): InvoiceBackupArtifactCatalogItem {
  return {
    companyId: 'company-1',
    documentId,
    documentType: 'approved_invoice_pdf',
    fileName: `${documentId}.pdf`,
    invoiceId: `invoice-${documentId}`,
    mediaType: 'application/pdf',
    sha256: sha256(bytes),
    sizeBytes: bytes.byteLength,
    storagePath,
  };
}

function sha256(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}
