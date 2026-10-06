import { createActorContext } from '@eky/auth';
import { AuthorizationError } from '@eky/permissions';
import { describe, expect, it, vi } from 'vitest';

import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import { listInvoiceDeliveryEvents } from './listInvoiceDeliveryEvents.js';

describe('listInvoiceDeliveryEvents', () => {
  it('reads safe summaries through company-scoped ports', async () => {
    const listDeliveryEvents = vi.fn(async () => [
      {
        ccEmail: '',
        createdAt: '2026-07-20T20:00:00.000Z',
        deliveryMethod: 'print' as const,
        documentSource: 'revision' as const,
        id: 'event-1',
        provider: 'manual' as const,
        recipientEmail: '',
        safeErrorMessage: null,
        sendMode: 'manual' as const,
        status: 'succeeded' as const,
      },
    ]);

    await expect(
      listInvoiceDeliveryEvents(createInput(), {
        invoiceDeliveryEventReader: {
          hasInvoiceIdentity: vi.fn(async () => true),
          listDeliveryEvents,
        },
      }),
    ).resolves.toEqual([
      expect.objectContaining({ id: 'event-1', status: 'succeeded' }),
    ]);

    expect(listDeliveryEvents).toHaveBeenCalledWith(
      'company-1',
      'invoice-1',
    );
  });

  it('returns a generic not-found error across the company boundary', async () => {
    const listDeliveryEvents = vi.fn();

    await expect(
      listInvoiceDeliveryEvents(createInput(), {
        invoiceDeliveryEventReader: {
          hasInvoiceIdentity: vi.fn(async () => false),
          listDeliveryEvents,
        },
      }),
    ).rejects.toEqual(new ApprovedInvoiceNotFoundError());

    expect(listDeliveryEvents).not.toHaveBeenCalled();
  });

  it('requires sendInvoices permission before reading delivery metadata', async () => {
    const hasInvoiceIdentity = vi.fn();

    await expect(
      listInvoiceDeliveryEvents(
        {
          actorContext: createActorContext({
            actorId: 'user-1',
            authenticationMode: 'local',
            companyId: 'company-1',
            permissions: [],
          }),
          invoiceId: 'invoice-1',
        },
        {
          invoiceDeliveryEventReader: {
            hasInvoiceIdentity,
            listDeliveryEvents: vi.fn(),
          },
        },
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);

    expect(hasInvoiceIdentity).not.toHaveBeenCalled();
  });
});

function createInput() {
  return {
    actorContext: createActorContext({
      actorId: 'user-1',
      authenticationMode: 'local',
      companyId: 'company-1',
      permissions: ['sendInvoices'],
    }),
    invoiceId: 'invoice-1',
  };
}
