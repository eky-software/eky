import { describe, expect, it } from 'vitest';

import { createInvoiceEmailSendRequestFingerprint } from './invoiceEmailSendRequestFingerprint.js';
import type { InvoiceDocumentBinding } from '../domain/invoiceDocumentBinding.js';
import { createEmailDocument } from './loadInvoiceEmailDeliveryDocument.fixture.js';

describe('createInvoiceEmailSendRequestFingerprint', () => {
  it.each<InvoiceDocumentBinding>([
    { kind: 'revision', revisionId: 'other-revision' },
    { kind: 'preservedLegacy', sourceDocumentId: 'revision-1' },
    { kind: 'preservedLegacy', sourceDocumentId: 'other-source' },
  ])('distinguishes binding identity with otherwise identical bytes: %j', binding => {
    const base = {
      document: createEmailDocument().metadata,
      body: 'Synthetic', subject: 'Synthetic', cc: '', to: 'customer@example.invalid',
      recipient: 'customer@example.invalid', sender: { address: 'sender@example.invalid', name: 'Synthetic' },
    };
    expect(createInvoiceEmailSendRequestFingerprint({ ...base, document: { ...base.document, binding } }))
      .not.toBe(createInvoiceEmailSendRequestFingerprint(base));
  });

  it('distinguishes preserved source IDs independently of the binding kind', () => {
    const base = {
      document: { ...createEmailDocument().metadata, binding: { kind: 'preservedLegacy' as const, sourceDocumentId: 'source-1' } },
      body: 'Synthetic', subject: 'Synthetic', cc: '', to: 'customer@example.invalid',
      recipient: 'customer@example.invalid', sender: { address: 'sender@example.invalid', name: 'Synthetic' },
    };
    expect(createInvoiceEmailSendRequestFingerprint({ ...base, document: { ...base.document, binding: { kind: 'preservedLegacy', sourceDocumentId: 'source-2' } } }))
      .not.toBe(createInvoiceEmailSendRequestFingerprint(base));
  });
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
          binding: { kind: 'revision', revisionId: 'revision-1' },
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
          binding: { kind: 'revision', revisionId: 'revision-1' },
          sizeBytes: 2048,
        },
      },
    ],
    [
      'document filename',
      {
        document: {
          fileName: 'changed.pdf',
          binding: { kind: 'revision', revisionId: 'revision-1' },
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
          binding: { kind: 'revision', revisionId: 'revision-1' },
        },
      },
    ],
  ] as const)('changes when the %s changes', (_label, overrides) => {
    const baseInput = {
      body: 'Hei, liitteenä lasku.',
      cc: '',
      document: {
        binding: { kind: 'revision' as const, revisionId: 'revision-1' },
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
