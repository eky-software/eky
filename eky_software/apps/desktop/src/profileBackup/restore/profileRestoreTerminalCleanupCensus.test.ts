import { describe, expect, it } from 'vitest';

import {
  profileInspectionMaximumCatalogBytes,
  profileInspectionMaximumDocumentCount,
} from '../../runtime/profileInspectionDocumentBindings.js';
import { measureProfileRestoreCleanupEntry } from './profileRestoreTerminalCleanupCensus.js';

describe('profile restore cleanup census accounting', () => {
  it('fits the supported generated document layout without charging repeated absolute prefixes', () => {
    const identity = '18446744073709551615:18446744073709551615';
    const companyName = `id-${'a'.repeat(36)}`;
    const invoiceName = `id-${'b'.repeat(36)}`;
    const documentName = `id-${'c'.repeat(36)}`;
    const fileName = 'approved-invoice.pdf';
    const storagePath = [companyName, invoiceName, documentName, fileName].join('/');
    const binding = { logicalPath: `artifacts/invoicing/invoice-documents/${'d'.repeat(64)}.pdf`,
      storagePath, byteSize: 5, sha256: 'e'.repeat(64) };
    const documentCount = profileInspectionMaximumDocumentCount;
    const bindingsBytes = Buffer.byteLength('{"schemaVersion":1,"documents":[]}') +
      documentCount * (Buffer.byteLength(JSON.stringify(binding)) + 1);
    expect(bindingsBytes).toBeLessThan(profileInspectionMaximumCatalogBytes);

    const entry = (name: string, kind: 'file' | 'directory', children: readonly string[]) => ({
      name, kind, children, identity: kind === 'directory' ? identity : `${identity}:5:18446744073709551615:18446744073709551615`,
    });
    const company = entry(companyName, 'directory', Array(documentCount).fill(invoiceName) as string[]);
    const perDocument = [entry(invoiceName, 'directory', [documentName]),
      entry(documentName, 'directory', [fileName]), entry(fileName, 'file', [])];
    const compactBytes = measureProfileRestoreCleanupEntry(company) + documentCount *
      perDocument.reduce((bytes, row) => bytes + measureProfileRestoreCleanupEntry(row), 0);
    expect(compactBytes).toBeLessThan(profileInspectionMaximumCatalogBytes);

    const root = `/synthetic/${'r'.repeat(240)}/storage/invoices`;
    const previousCompany = Buffer.byteLength(JSON.stringify({ path: `${root}/${companyName}`,
      kind: 'directory', identity, children: company.children }));
    const previousPerDocument = perDocument.reduce((bytes, row, index) => bytes + Buffer.byteLength(JSON.stringify({
      path: [root, companyName, invoiceName, ...(index > 0 ? [documentName] : []),
        ...(index > 1 ? [fileName] : [])].join('/'), kind: row.kind, identity: row.identity, children: row.children,
    })), 0);
    expect(previousCompany + documentCount * previousPerDocument).toBeGreaterThan(profileInspectionMaximumCatalogBytes);
  });

  it('still charges empty directory entries and their child references', () => {
    const row = { name: 'empty', kind: 'directory' as const, identity: '1:2', children: [] };
    expect(measureProfileRestoreCleanupEntry(row)).toBeGreaterThan(0);
    expect(measureProfileRestoreCleanupEntry({ ...row, children: ['child'] }))
      .toBeGreaterThan(measureProfileRestoreCleanupEntry(row));
  });
});
