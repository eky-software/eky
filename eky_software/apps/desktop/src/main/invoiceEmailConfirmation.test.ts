import { describe, expect, it } from 'vitest';

import {
  createInvoiceEmailConfirmationDetail,
  readInvoiceEmailPreparationConfirmation,
} from './invoiceEmailConfirmation.js';

describe('readInvoiceEmailPreparationConfirmation', () => {
  it('accepts only the safe fields needed by the native confirmation dialog', () => {
    expect(
      readInvoiceEmailPreparationConfirmation({
        preparation: {
          attachment: { documentId: 'document-1', fileName: 'lasku-20260001.pdf', sizeBytes: 2048 },
          documentTarget: { kind: 'revision', documentId: 'document-1' },
          attemptId: 'secret-attempt-id-is-not-forwarded',
          authorizationToken: 'secret-token-is-not-forwarded',
          body: 'Hei,\n\nLiitteenä lasku.',
          cc: 'copy@example.fi',
          invoiceId: 'invoice-1',
          invoiceNumber: '20260001',
          recipient: 'customer@example.fi',
          resend: false,
          sender: 'Example Oy <billing@example.fi>',
          subject: 'Lasku 20260001',
        },
      }),
    ).toEqual({
      attachmentFileName: 'lasku-20260001.pdf',
      attachmentSizeBytes: 2048,
      documentTarget: { kind: 'revision', documentId: 'document-1' },
      body: 'Hei,\n\nLiitteenä lasku.',
      cc: 'copy@example.fi',
      invoiceId: 'invoice-1',
      invoiceNumber: '20260001',
      recipient: 'customer@example.fi',
      resend: false,
      sender: 'Example Oy <billing@example.fi>',
      subject: 'Lasku 20260001',
    });
  });

  it.each([
    { recipient: 'customer@example.fi\nBcc: attacker@example.fi' },
    { subject: 'Lasku\r\nBcc: attacker@example.fi' },
    { invoiceId: '../invoice-1' },
    { attachment: { documentId: 'document-1', fileName: 'invoice.pdf', sizeBytes: -1 } },
  ])('rejects malformed or control-character data: %o', (override) => {
    const preparation = {
      attachment: { documentId: 'document-1', fileName: 'lasku-20260001.pdf', sizeBytes: 2048 },
      documentTarget: { kind: 'revision', documentId: 'document-1' },
      body: 'Hei,\n\nLiitteenä lasku.',
      cc: '',
      invoiceId: 'invoice-1',
      invoiceNumber: '20260001',
      recipient: 'customer@example.fi',
      resend: false,
      sender: 'Example Oy <billing@example.fi>',
      subject: 'Lasku 20260001',
      ...override,
    };

    expect(
      readInvoiceEmailPreparationConfirmation({ preparation }),
    ).toBeUndefined();
  });

  it('keeps the complete safe multiline body and rejects unsafe controls', () => {
    const safeBody = `Hei,\n\n${'Laskurivi '.repeat(100)}\n\nYstävällisin terveisin`;
    const value = {
      preparation: {
        attachment: { documentId: 'document-1', fileName: 'lasku-20260001.pdf', sizeBytes: 2048 },
        documentTarget: { kind: 'revision', documentId: 'document-1' },
        body: safeBody,
        cc: '',
        invoiceId: 'invoice-1',
        invoiceNumber: '20260001',
        recipient: 'customer@example.fi',
        resend: true,
        sender: 'Example Oy <billing@example.fi>',
        subject: 'Lasku 20260001',
      },
    };

    expect(readInvoiceEmailPreparationConfirmation(value)?.body).toBe(safeBody);
    value.preparation.body = 'Hei\u0000salaisuus';
    expect(readInvoiceEmailPreparationConfirmation(value)).toBeUndefined();
  });

  it('shows every trusted delivery field and the full body for a resend', () => {
    const detail = createInvoiceEmailConfirmationDetail({
      documentTarget: { kind: 'revision', documentId: 'document-1' },
      attachmentFileName: 'lasku-20260001.pdf',
      attachmentSizeBytes: 2048,
      body: 'Hei,\n\nKoko viesti näkyy tässä.\n\nTerveisin',
      cc: 'copy@example.fi',
      invoiceId: 'invoice-1',
      invoiceNumber: '20260001',
      recipient: 'customer@example.fi',
      resend: true,
      sender: 'Example Oy <billing@example.fi>',
      subject: 'Lasku 20260001',
    });

    expect(detail).toContain('Lasku: 20260001');
    expect(detail).toContain('Lähettäjä: Example Oy <billing@example.fi>');
    expect(detail).toContain('Vastaanottaja: customer@example.fi');
    expect(detail).toContain('Kopio: copy@example.fi');
    expect(detail).toContain('Otsikko: Lasku 20260001');
    expect(detail).toContain('Liite: lasku-20260001.pdf (2,0 kt)');
    expect(detail).toContain('Tämä on laskun uudelleenlähetys.');
    expect(detail).toContain('Hei,\n\nKoko viesti näkyy tässä.\n\nTerveisin');
  });
});
