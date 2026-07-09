import { describe, expect, it } from 'vitest';

import type { InvoiceDeliveryEvent } from '../domain/invoiceDeliveryEvent.js';
import { InvoiceDeliveryEventValidationError } from '../domain/invoiceDeliveryEventRules.js';
import type { InvoiceDeliveryEventRepository } from '../ports/invoiceDeliveryEventRepository.js';
import {
  recordInvoiceDeliveryEvent,
  type RecordInvoiceDeliveryEventInput,
} from './recordInvoiceDeliveryEvent.js';

class FakeInvoiceDeliveryEventRepository
  implements InvoiceDeliveryEventRepository
{
  events: InvoiceDeliveryEvent[] = [];

  async saveDeliveryEvent(
    event: InvoiceDeliveryEvent,
  ): Promise<InvoiceDeliveryEvent> {
    this.events.push(event);

    return event;
  }
}

describe('recordInvoiceDeliveryEvent', () => {
  it('records a normalized delivery event through the repository', async () => {
    const repository = new FakeInvoiceDeliveryEventRepository();

    await expect(
      recordInvoiceDeliveryEvent(createInput(), {
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
      status: 'prepared',
      subject: 'Lasku 20260001',
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
  });

  it('rejects invalid delivery enums before writing', async () => {
    const repository = new FakeInvoiceDeliveryEventRepository();

    await expect(
      recordInvoiceDeliveryEvent(
        createInput({ provider: 'webmailAutomation' }),
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
    companyId: ' dev-company ',
    createdAt: '2026-07-10T10:00:00.000Z',
    createdBy: ' user-1 ',
    deliveryMethod: 'email',
    documentId: ' document-1 ',
    invoiceId: ' invoice-1 ',
    provider: 'dryRun',
    recipientEmail: ' customer@example.fi ',
    status: 'prepared',
    subject: ' Lasku 20260001 ',
    ...overrides,
  };
}
