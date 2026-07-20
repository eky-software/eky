import { createActorContext } from '@eky/auth';
import { AuthorizationError } from '@eky/permissions';
import { describe, expect, it, vi } from 'vitest';

import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import { listInvoiceDeliveryEvents } from './listInvoiceDeliveryEvents.js';
import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';

describe('listInvoiceDeliveryEvents', () => {
  it('reads safe summaries through company-scoped ports', async () => {
    const listDeliveryEvents = vi.fn(async () => [
      {
        ccEmail: '',
        createdAt: '2026-07-20T20:00:00.000Z',
        deliveryMethod: 'print' as const,
        id: 'event-1',
        provider: 'manual' as const,
        recipientEmail: '',
        safeErrorMessage: null,
        status: 'succeeded' as const,
      },
    ]);

    await expect(
      listInvoiceDeliveryEvents(createInput(), {
        approvedInvoiceReader: createReader(createInvoice()),
        invoiceDeliveryEventReader: {
          hasUnresolvedDeliveryEvent: vi.fn(),
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
        approvedInvoiceReader: createReader(undefined),
        invoiceDeliveryEventReader: {
          hasUnresolvedDeliveryEvent: vi.fn(),
          listDeliveryEvents,
        },
      }),
    ).rejects.toEqual(new ApprovedInvoiceNotFoundError());

    expect(listDeliveryEvents).not.toHaveBeenCalled();
  });

  it('requires sendInvoices permission before reading delivery metadata', async () => {
    const getApprovedInvoiceById = vi.fn();

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
          approvedInvoiceReader: {
            getApprovedInvoiceById,
            listApprovedInvoiceSummaries: vi.fn(),
          },
          invoiceDeliveryEventReader: {
            hasUnresolvedDeliveryEvent: vi.fn(),
            listDeliveryEvents: vi.fn(),
          },
        },
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);

    expect(getApprovedInvoiceById).not.toHaveBeenCalled();
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

function createReader(invoice: ApprovedInvoiceView | undefined) {
  return {
    getApprovedInvoiceById: vi.fn(async () => invoice),
    listApprovedInvoiceSummaries: vi.fn(),
  };
}

function createInvoice(): ApprovedInvoiceView {
  return {
    companyId: 'company-1',
    id: 'invoice-1',
    status: 'approved',
  } as ApprovedInvoiceView;
}
