import { describe, expect, it } from 'vitest';

import { EkyApiError } from '../../http.js';
import { readApprovedInvoiceEmailSmtpPreparationResponse } from './approvedInvoiceDeliveryResponse.js';
import type { ApprovedInvoiceEmailSmtpPreparation } from './approvedInvoicesTypes.js';

describe('customer SMTP preparation document target', () => {
  describe.each(['revision', 'preservedLegacy'] as const)('%s', (kind) => {
    it('projects the target and matching attachment without internal metadata', () => {
      const preparation = createPreparation(kind);
      const result = readApprovedInvoiceEmailSmtpPreparationResponse({
        preparation: {
          ...preparation,
          attachment: { ...preparation.attachment, storagePath: 'internal/path' },
        },
      });

      expect(result).toEqual(preparation);
      expect(result.documentTarget).not.toBe(preparation.documentTarget);
    });

    it('rejects extra target keys instead of silently dropping them', () => {
      const preparation = createPreparation(kind);
      expectInvalid({
        ...preparation,
        documentTarget: { ...preparation.documentTarget, sourceDocumentId: 'internal-source' },
      });
    });

    it.each([
      undefined, null, 1, {}, '', ' ', ' document-1 ', 'document 1', 'document-1\n',
      'document/1', 'document\\1', 'document.1', 'x'.repeat(101),
    ])(
      'rejects malformed document IDs even when attachment agrees (%j)',
      (documentId) => {
        const preparation = createPreparation(kind);
        expectInvalid({
          ...preparation,
          documentTarget: { kind, documentId },
          attachment: { ...preparation.attachment, documentId },
        });
      },
    );

    it.each([undefined, null, 1, '', 'other-document', ' document-1 '])(
      'rejects a missing, malformed or mismatched attachment ID (%j)',
      (documentId) => {
        const preparation = createPreparation(kind);
        expectInvalid({
          ...preparation,
          attachment: { ...preparation.attachment, documentId },
        });
      },
    );

    it('accepts a 100-character identifier with the permitted characters unchanged', () => {
      const preparation = createPreparation(kind);
      const documentId = 'Az09_-'.padEnd(100, 'a');
      preparation.documentTarget.documentId = documentId;
      preparation.attachment.documentId = documentId;
      expect(readApprovedInvoiceEmailSmtpPreparationResponse({ preparation }))
        .toEqual(preparation);
    });
  });

  it.each([
    undefined, null, 'revision', [], {},
    { documentId: 'document-1' },
    { kind: null, documentId: 'document-1' },
    { kind: 1, documentId: 'document-1' },
    { kind: 'legacyOriginal', documentId: 'document-1' },
    { kind: 'futureKind', documentId: 'document-1' },
    { kind: 'Revision', documentId: 'document-1' },
    { kind: ' preservedLegacy ', documentId: 'document-1' },
  ])('rejects a missing or unknown target without a revision fallback (%j)', (documentTarget) => {
    expectInvalid({ ...createPreparation(), documentTarget });
  });
});

function expectInvalid(preparation: unknown): void {
  const parse = () => readApprovedInvoiceEmailSmtpPreparationResponse({ preparation });
  expect(parse).toThrow(EkyApiError);
  expect(parse).toThrow('Invalid approved invoice response.');
}

function createPreparation(
  kind: ApprovedInvoiceEmailSmtpPreparation['documentTarget']['kind'] = 'revision',
): ApprovedInvoiceEmailSmtpPreparation {
  return {
    attachment: { documentId: 'document-1', fileName: 'invoice.pdf', sizeBytes: 2048 },
    attemptId: 'attempt-1',
    authorizationToken: 'synthetic-one-time-authorization',
    body: 'Invoice attached.',
    cc: '',
    documentTarget: { kind, documentId: 'document-1' },
    expiresAt: '2026-07-17T22:01:00.000Z',
    invoiceId: 'invoice-1',
    invoiceNumber: '20260001',
    recipient: 'recipient@example.invalid',
    resend: kind === 'preservedLegacy',
    sender: 'Example Oy <billing@example.invalid>',
    subject: 'Invoice',
  };
}
