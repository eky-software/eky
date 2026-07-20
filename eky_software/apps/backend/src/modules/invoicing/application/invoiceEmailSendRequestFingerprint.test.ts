import { describe, expect, it } from 'vitest';

import { createInvoiceEmailSendRequestFingerprint } from './invoiceEmailSendRequestFingerprint.js';

describe('createInvoiceEmailSendRequestFingerprint', () => {
  it.each([
    ['displayed recipient', { to: 'changed@example.fi' }],
    ['actual recipient', { recipient: 'other-test@example.fi' }],
    [
      'sender address',
      { sender: { address: 'other-sender@example.fi', name: 'Example Oy' } },
    ],
    [
      'sender name',
      { sender: { address: 'billing@example.fi', name: 'Changed Oy' } },
    ],
    [
      'document id',
      {
        document: {
          fileName: 'lasku-20260001.pdf',
          id: 'document-2',
          sha256: '0'.repeat(64),
          sizeBytes: 2048,
        },
      },
    ],
    [
      'document hash',
      {
        document: {
          fileName: 'lasku-20260001.pdf',
          id: 'document-1',
          sha256: '1'.repeat(64),
          sizeBytes: 2048,
        },
      },
    ],
    [
      'document filename',
      {
        document: {
          fileName: 'changed.pdf',
          id: 'document-1',
          sha256: '0'.repeat(64),
          sizeBytes: 2048,
        },
      },
    ],
    [
      'document size',
      {
        document: {
          fileName: 'lasku-20260001.pdf',
          id: 'document-1',
          sha256: '0'.repeat(64),
          sizeBytes: 4096,
        },
      },
    ],
  ] as const)('changes when the %s changes', (_label, overrides) => {
    const baseInput = {
      body: 'Hei, liitteenä lasku.',
      cc: '',
      document: {
        fileName: 'lasku-20260001.pdf',
        id: 'document-1',
        sha256: '0'.repeat(64),
        sizeBytes: 2048,
      },
      recipient: 'forced-test@example.fi',
      sender: {
        address: 'billing@example.fi',
        name: 'Example Oy',
      },
      subject: 'Lasku 20260001',
      to: 'customer@example.fi',
    };
    const fingerprint = createInvoiceEmailSendRequestFingerprint(baseInput);

    expect(
      createInvoiceEmailSendRequestFingerprint({
        ...baseInput,
        ...overrides,
      }),
    ).not.toBe(fingerprint);
  });
});
