import { describe, expect, it } from 'vitest';

import { InvoiceDeliveryEventValidationError } from '../domain/invoiceDeliveryEventRules.js';
import type { InvoiceDryRunDeliveryEvent } from '../domain/invoiceRecordedDeliveryEvent.js';
import type { InvoiceDeliveryEventRepository } from '../ports/invoiceDeliveryEventRepository.js';
import {
  recordInvoiceDeliveryEvent,
  type RecordInvoiceDeliveryEventInput,
} from './recordInvoiceDeliveryEvent.js';

class FakeInvoiceDeliveryEventRepository
  implements Pick<InvoiceDeliveryEventRepository, 'saveDeliveryEvent'>
{
  events: InvoiceDryRunDeliveryEvent[] = [];

  async saveDeliveryEvent(
    event: InvoiceDryRunDeliveryEvent,
  ): Promise<InvoiceDryRunDeliveryEvent> {
    this.events.push(event);

    return event;
  }
}

describe('recordInvoiceDeliveryEvent', () => {
  it.each(['succeeded', 'failed'] as const)('records a normalized %s dry-run event through the repository', async (status) => {
    const repository = new FakeInvoiceDeliveryEventRepository();
    const input = createInput({ status });

    await expect(
      recordInvoiceDeliveryEvent(input, {
        invoiceDeliveryEventRepository: repository,
      }),
    ).resolves.toEqual({
      id: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
      bodyPreview: 'Liitteenä lasku.',
      ccEmail: 'copy@example.fi',
      companyId: 'dev-company',
      createdAt: '2026-07-10T10:00:00.000Z',
      createdBy: 'user-1',
      deliveryMethod: 'email',
      documentId: 'document-1',
      invoiceId: 'invoice-1',
      provider: 'dryRun',
      providerMessageId: null,
      recipientEmail: 'customer@example.fi',
      safeErrorMessage: null,
      status,
      subject: 'Lasku 20260001',
      target: input.target,
      technicalErrorCode: null,
    });

    expect(repository.events).toHaveLength(1);
  });

  it('stores only a bounded body preview instead of the full message body', async () => {
    const repository = new FakeInvoiceDeliveryEventRepository();
    const longBody = `Hei\n${'x'.repeat(600)}`;
    const { bodyPreview: _bodyPreview, ...inputWithoutPreview } = createInput();

    const event = await recordInvoiceDeliveryEvent(
      { ...inputWithoutPreview, body: longBody },
      { invoiceDeliveryEventRepository: repository },
    );

    expect(event.bodyPreview).toHaveLength(500);
    expect(event.bodyPreview).toBe(longBody.trim().slice(0, 500));
    expect(repository.events[0]).not.toHaveProperty('body');
  });

  it('normalizes the target and flat identity fields together', async () => {
    const repository = new FakeInvoiceDeliveryEventRepository();
    const input = createInput();

    await expect(
      recordInvoiceDeliveryEvent({
        ...input,
        target: {
          ...input.target,
          companyId: ' dev-company ',
          invoiceId: ' invoice-1 ',
          documentId: ' document-1 ',
          revisionId: ' revision-1 ',
        },
      }, { invoiceDeliveryEventRepository: repository }),
    ).resolves.toMatchObject({
      companyId: 'dev-company',
      invoiceId: 'invoice-1',
      documentId: 'document-1',
      target: input.target,
    });
  });

  it.each([
    ['unknown provider', { provider: 'webmailAutomation' }],
    ['SMTP provider', { provider: 'smtp' }],
    ['manual provider', { provider: 'manual' }],
    ['prepared status', { status: 'prepared' }],
    ['attempted status', { status: 'attempted' }],
    ['uncertain outcome', { status: 'outcomeUnknown' }],
    ['manual method', { deliveryMethod: 'manual' }],
    ['print method', { deliveryMethod: 'print' }],
    ['legacy target', { target: { kind: 'legacyOriginal' } }],
    ['missing target', { target: undefined }],
  ] as const)('rejects runtime %s before writing', async (_label, overrides) => {
    const repository = new FakeInvoiceDeliveryEventRepository();

    await expect(
      recordInvoiceDeliveryEvent(
        { ...createInput(), ...overrides } as unknown as RecordInvoiceDeliveryEventInput,
        { invoiceDeliveryEventRepository: repository },
      ),
    ).rejects.toBeInstanceOf(InvoiceDeliveryEventValidationError);

    expect(repository.events).toEqual([]);
  });

  it('rejects oversized safe technical fields before writing', async () => {
    const repository = new FakeInvoiceDeliveryEventRepository();

    await expect(
      recordInvoiceDeliveryEvent(
        createInput({ technicalErrorCode: 'x'.repeat(121) }),
        { invoiceDeliveryEventRepository: repository },
      ),
    ).rejects.toBeInstanceOf(InvoiceDeliveryEventValidationError);

    expect(repository.events).toEqual([]);
  });
});

function createInput(
  overrides: Partial<RecordInvoiceDeliveryEventInput> = {},
): RecordInvoiceDeliveryEventInput {
  return {
    bodyPreview: ' Liitteenä lasku. ',
    ccEmail: ' copy@example.fi ',
    target: {
      kind: 'revision',
      companyId: 'dev-company',
      invoiceId: 'invoice-1',
      revisionId: 'revision-1',
      documentId: 'document-1',
      sha256: '0'.repeat(64),
      sizeBytes: 2048,
    },
    createdAt: '2026-07-10T10:00:00.000Z',
    createdBy: ' user-1 ',
    deliveryMethod: 'email',
    provider: 'dryRun',
    recipientEmail: ' customer@example.fi ',
    status: 'succeeded',
    subject: ' Lasku 20260001 ',
    ...overrides,
  };
}
