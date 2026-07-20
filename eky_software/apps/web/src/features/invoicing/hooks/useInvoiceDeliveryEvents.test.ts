import { EkyApiError, type EkyApiClient } from '@eky/api-client';
import { describe, expect, it, vi } from 'vitest';

import {
  getInvoiceDeliveryEventsErrorMessage,
  listInvoiceDeliveryEventsWithClient,
} from './useInvoiceDeliveryEvents.js';
import { uiText } from '../../../i18n/fi.js';

describe('listInvoiceDeliveryEventsWithClient', () => {
  it('loads the company-scoped safe history through the API client', async () => {
    const events = [
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
    ];
    const client = {
      listInvoiceDeliveryEvents: vi.fn(async () => events),
    } as Pick<EkyApiClient, 'listInvoiceDeliveryEvents'>;

    await expect(
      listInvoiceDeliveryEventsWithClient(client, 'invoice-1'),
    ).resolves.toEqual(events);
    expect(client.listInvoiceDeliveryEvents).toHaveBeenCalledWith('invoice-1');
  });

  it('maps API failures to a safe Finnish message without response details', () => {
    const error = new EkyApiError('Internal delivery history failure', {
      responseBody: {
        providerResponse: 'must-not-leak',
        technicalErrorCode: 'PRIVATE_CODE',
      },
      status: 500,
    });

    const message = getInvoiceDeliveryEventsErrorMessage(error);

    expect(message).toBe(uiText.invoicing.invoiceDeliveryHistoryError);
    expect(message).not.toContain('providerResponse');
    expect(message).not.toContain('PRIVATE_CODE');
  });
});
