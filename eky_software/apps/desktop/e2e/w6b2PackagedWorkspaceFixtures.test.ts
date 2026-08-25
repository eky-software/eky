import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { InvoicePdfArchiveConfigStore } from '../src/invoicePdfArchive/invoicePdfArchiveConfig.js';
import { InvoicePdfArchiveJournalStore } from '../src/invoicePdfArchive/invoicePdfArchiveJournal.js';
import { validateWorkspaceId } from '../src/workspaces/registry/workspaceIdValidation.js';
import { readW6b2BusinessAmounts } from './w6b2PackagedWorkspaceBusinessFixture.js';
import { createW6b2PackagedWorkspaceRuntimeNamespaces } from './w6b2PackagedWorkspaceRuntimeNamespaces.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('W6B.2 packaged workspace fixture amounts', () => {
  it('keeps each workspace distinct and all invoice totals coherent', () => {
    const fixtures = ['A', 'B', 'C'] as const;
    const amounts = fixtures.map(readW6b2BusinessAmounts);

    expect(new Set(amounts.map((value) => value.netCents)).size).toBe(3);
    for (const value of amounts) {
      expect(value.netCents + value.vatCents).toBe(value.grossCents);
      expect(value.vatCents).toBe(
        Math.round((value.netCents * 2_550) / 10_000),
      );
    }
    expect(amounts).toEqual([
      { grossCents: 12_550, netCents: 10_000, vatCents: 2_550 },
      { grossCents: 25_100, netCents: 20_000, vatCents: 5_100 },
      { grossCents: 37_650, netCents: 30_000, vatCents: 7_650 },
    ]);
  });

  it('creates isolated archive, recovery and secret namespace evidence', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'eky-w6b2-namespaces-'));
    temporaryRoots.push(workspaceRoot);
    const namespaces = await createW6b2PackagedWorkspaceRuntimeNamespaces({
      business: {
        companySettingsId: 'company-settings',
        customerId: 'customer',
        customerNumber: 'W6B2-1',
        documentId: 'document',
        draftId: 'draft',
        draftLineId: 'draft-line',
        grossCents: 12_550,
        invoiceId: 'invoice',
        invoiceLineId: 'invoice-line',
        invoiceNumber: '620001',
        netCents: 10_000,
        pdfSha256: 'a'.repeat(64),
        pdfSize: 100,
        vatCents: 2_550,
      },
      fixture: {
        artifactRoot: join(workspaceRoot, 'runtime', 'storage', 'invoices'),
        businessArtifactPath: join(workspaceRoot, 'invoice.pdf'),
        databaseFilePath: join(workspaceRoot, 'runtime', 'data', 'eky.sqlite'),
        profileId: 'a'.repeat(64),
        workspaceId: validateWorkspaceId(
          '11111111-1111-4111-8111-111111111111',
        ),
        workspaceRoot,
      },
      fixtureKey: 'A',
    });

    await expect(
      Promise.all([
        readFile(namespaces.archiveSentinelFilePath, 'utf8'),
        readFile(namespaces.recoverySentinelFilePath, 'utf8'),
        readFile(namespaces.secretSentinelFilePath, 'utf8'),
      ]),
    ).resolves.toEqual([
      'w6b2-archive-A\n',
      'w6b2-recovery-A\n',
      'w6b2-secret-A\n',
    ]);
    await expect(
      new InvoicePdfArchiveConfigStore(
        namespaces.archiveConfigFilePath,
      ).readDisplayName(),
    ).resolves.toBe('synthetic-pdf-archive-a');
    await expect(
      new InvoicePdfArchiveJournalStore(
        namespaces.archiveJournalFilePath,
      ).get(),
    ).resolves.toMatchObject({
      tasks: [
        {
          documentId: 'document',
          expectedPdfSha256: 'a'.repeat(64),
          expectedPdfSize: 100,
          invoiceId: 'invoice',
          invoiceNumber: '620001',
        },
      ],
    });
  });
});
