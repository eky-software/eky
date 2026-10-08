import { describe, expect, it } from 'vitest';

import { EkyApiError } from '../../http.js';
import { readApprovedInvoiceEmailPreviewResponse } from './approvedInvoiceDeliveryResponse.js';
import type { ApprovedInvoiceEmailPreview } from './approvedInvoicesTypes.js';

describe('approved invoice email preview document target', () => {
  it.each(['revision', 'preservedLegacy'] as const)(
    'projects the matching %s target without extra metadata',
    (kind) => {
      const email = createEmailPreview(kind);
      const result = readApprovedInvoiceEmailPreviewResponse({
        email: {
          ...email,
          attachment: { ...email.attachment, storagePath: 'internal/path' },
          metadata: { internal: true },
        },
        metadata: { internal: true },
      });

      expect(result).toEqual(email);
      expect(result.documentTarget).not.toBe(email.documentTarget);
    },
  );

  it('rejects a missing document target instead of inferring a revision', () => {
    const email: Record<string, unknown> = { ...createEmailPreview() };
    delete email.documentTarget;

    expectInvalidPreview(email);
  });

  it.each([
    { name: 'null target', target: null },
    { name: 'string target', target: 'revision' },
    { name: 'array target', target: [] },
    { name: 'empty target', target: {} },
    { name: 'missing kind', target: { documentId: 'document-1' } },
    { name: 'null kind', target: { kind: null, documentId: 'document-1' } },
    { name: 'non-string kind', target: { kind: 1, documentId: 'document-1' } },
    { name: 'unknown kind', target: { kind: 'futureKind', documentId: 'document-1' } },
    { name: 'legacy original', target: { kind: 'legacyOriginal', documentId: 'document-1' } },
    { name: 'wrong case', target: { kind: 'Revision', documentId: 'document-1' } },
    { name: 'padded kind', target: { kind: ' preservedLegacy ', documentId: 'document-1' } },
  ])('rejects $name', ({ target }) => {
    expectInvalidPreview({ ...createEmailPreview(), documentTarget: target });
  });

  describe.each(['revision', 'preservedLegacy'] as const)('%s target', (kind) => {
    it('rejects extra target keys instead of silently dropping them', () => {
      const email = createEmailPreview(kind);
      expectInvalidPreview({
        ...email,
        documentTarget: { ...email.documentTarget, sourceDocumentId: 'internal-source' },
      });
    });

    it('accepts a 100-character identifier with the permitted characters unchanged', () => {
      const email = createEmailPreview(kind);
      const documentId = 'Az09_-'.padEnd(100, 'a');
      email.documentTarget.documentId = documentId;
      email.attachment.documentId = documentId;

      expect(readApprovedInvoiceEmailPreviewResponse({ email })).toEqual(email);
    });

    it.each([
      { name: 'missing', documentId: undefined },
      { name: 'null', documentId: null },
      { name: 'numeric', documentId: 1 },
      { name: 'object', documentId: {} },
      { name: 'empty', documentId: '' },
      { name: 'whitespace-only', documentId: ' \t\n' },
      { name: 'mismatched', documentId: 'other-document' },
      { name: 'padded', documentId: ' document-1 ' },
    ])('rejects a $name document id', ({ documentId }) => {
      expectInvalidPreview({ ...createEmailPreview(kind), documentTarget: { kind, documentId } });
    });

    it.each([
      '', ' \t\n', ' document-1 ', 'document 1', 'document-1\n',
      'document/1', 'document\\1', 'document.1', 'x'.repeat(101),
    ])(
      'rejects matching invalid document ids (%j)',
      (documentId) => {
        const email = createEmailPreview(kind);

        expectInvalidPreview({
          ...email,
          attachment: { ...email.attachment, documentId },
          documentTarget: { kind, documentId },
        });
      },
    );

    it.each([undefined, null, 1, '', 'other-document'])(
      'rejects an invalid or mismatched attachment id (%j)',
      (documentId) => {
        const email = createEmailPreview(kind);

        expectInvalidPreview({ ...email, attachment: { ...email.attachment, documentId } });
      },
    );
  });
});

function expectInvalidPreview(email: unknown): void {
  const parse = () => readApprovedInvoiceEmailPreviewResponse({ email });
  expect(parse).toThrow(EkyApiError);
  expect(parse).toThrow('Invalid approved invoice response.');
}

function createEmailPreview(
  kind: ApprovedInvoiceEmailPreview['documentTarget']['kind'] = 'revision',
): ApprovedInvoiceEmailPreview {
  return {
    attachment: {
      documentId: 'document-1',
      fileName: 'invoice.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1234,
    },
    body: 'Invoice attached.',
    documentTarget: { kind, documentId: 'document-1' },
    invoiceId: 'invoice-1',
    invoiceNumber: '20260001',
    provider: 'dryRun',
    subject: 'Invoice',
    to: 'recipient@example.invalid',
  };
}
