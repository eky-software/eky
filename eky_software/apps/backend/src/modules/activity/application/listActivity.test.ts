import { AuthorizationError } from '@eky/permissions';
import { describe, expect, it, vi } from 'vitest';

import {
  ActivityValidationError,
  listActivity,
  type ListActivityDependencies,
} from './listActivity.js';

const actorContext = {
  actorId: 'actor-1',
  authenticationMode: 'local' as const,
  companyId: 'company-1',
  permissions: ['viewActivity'] as const,
};

describe('listActivity', () => {
  it('requires viewActivity before invoking readers', async () => {
    const dependencies = createDependencies();

    await expect(
      listActivity(
        {
          actorContext: {
            ...actorContext,
            permissions: [],
          },
          month: '2026-07',
        },
        dependencies,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(
      dependencies.customerActivityReader.listCustomerActivity,
    ).not.toHaveBeenCalled();
  });

  it('merges safe monthly projections in stable newest-first order', async () => {
    const dependencies = createDependencies();

    await expect(
      listActivity(
        {
          actorContext,
          month: '2026-07',
          pageSize: 20,
        },
        dependencies,
      ),
    ).resolves.toEqual({
      activityItems: [
        {
          id: 'invoicing:invoice-event',
          module: 'invoicing',
          occurredAt: '2026-07-27T12:00:00.000Z',
          outcome: 'success',
          reference: { kind: 'invoiceNumber', value: '20260001' },
          type: 'invoice.delivered',
        },
        {
          id: 'customers:customer-event',
          module: 'customers',
          occurredAt: '2026-07-27T11:00:00.000Z',
          outcome: 'success',
          reference: { kind: 'customerNumber', value: '1001' },
          type: 'customer.updated',
        },
        {
          id: 'companySettings:settings-event',
          module: 'companySettings',
          occurredAt: '2026-07-27T10:00:00.000Z',
          outcome: 'success',
          reference: null,
          type: 'companySettings.updated',
        },
      ],
      hasNextPage: false,
      hasPreviousPage: false,
      month: '2026-07',
      page: 1,
      pageSize: 20,
    });
    expect(
      dependencies.invoiceActivityReader.listInvoiceActivity,
    ).toHaveBeenCalledWith({
      companyId: 'company-1',
      limit: 21,
      occurredAtFrom: '2026-07-01T00:00:00.000Z',
      occurredAtTo: '2026-08-01T00:00:00.000Z',
      outcomes: ['success', 'failure', 'unknown'],
    });
  });

  it('reads only the selected category and outcome', async () => {
    const dependencies = createDependencies();

    await listActivity(
      {
        actorContext,
        category: 'invoicing',
        month: '2026-07',
        outcome: 'failure',
      },
      dependencies,
    );

    expect(
      dependencies.customerActivityReader.listCustomerActivity,
    ).not.toHaveBeenCalled();
    expect(
      dependencies.companySettingsActivityReader.listCompanySettingsActivity,
    ).not.toHaveBeenCalled();
    expect(
      dependencies.invoiceActivityReader.listInvoiceActivity,
    ).toHaveBeenCalledWith(expect.objectContaining({ outcomes: ['failure'] }));
  });

  it('maps invoice settings audit to a safe item without a reference', async () => {
    const dependencies = createDependencies();
    dependencies.invoiceActivityReader.listInvoiceActivity = vi
      .fn()
      .mockResolvedValue([
        {
          action: 'invoiceVatRates.updated',
          id: 'settings-event',
          invoiceNumber: null,
          occurredAt: '2026-07-27T12:00:00.000Z',
          outcome: 'success',
        },
      ]);

    await expect(
      listActivity(
        {
          actorContext,
          category: 'invoicing',
          month: '2026-07',
        },
        dependencies,
      ),
    ).resolves.toMatchObject({
      activityItems: [
        {
          id: 'invoicing:settings-event',
          module: 'invoicing',
          reference: null,
          type: 'invoiceVatRates.updated',
        },
      ],
    });
  });

  it('returns a stable later page without repeating previous items', async () => {
    const dependencies = createDependencies();
    dependencies.customerActivityReader.listCustomerActivity = vi
      .fn()
      .mockResolvedValue(
        Array.from({ length: 25 }, (_, index) => ({
          action: 'customer.updated',
          customerNumber: String(1000 + index),
          id: `event-${String(index).padStart(2, '0')}`,
          occurredAt: new Date(
            Date.UTC(2026, 6, 27, 12, 0, 25 - index),
          ).toISOString(),
        })),
      );

    const result = await listActivity(
      {
        actorContext,
        category: 'customers',
        month: '2026-07',
        page: 2,
        pageSize: 20,
      },
      dependencies,
    );

    expect(result.activityItems).toHaveLength(5);
    expect(result.activityItems[0]?.id).toBe('customers:event-20');
    expect(result.hasNextPage).toBe(false);
    expect(result.hasPreviousPage).toBe(true);
  });

  it('rejects invalid query boundaries before reading data', async () => {
    const dependencies = createDependencies();

    await expect(
      listActivity(
        {
          actorContext,
          month: '2026-13',
        },
        dependencies,
      ),
    ).rejects.toBeInstanceOf(ActivityValidationError);
    expect(
      dependencies.invoiceActivityReader.listInvoiceActivity,
    ).not.toHaveBeenCalled();
  });
});

function createDependencies(): ListActivityDependencies {
  return {
    companySettingsActivityReader: {
      listCompanySettingsActivity: vi.fn().mockResolvedValue([
        {
          action: 'companySettings.updated',
          id: 'settings-event',
          occurredAt: '2026-07-27T10:00:00.000Z',
        },
      ]),
    },
    customerActivityReader: {
      listCustomerActivity: vi.fn().mockResolvedValue([
        {
          action: 'customer.updated',
          customerNumber: '1001',
          id: 'customer-event',
          occurredAt: '2026-07-27T11:00:00.000Z',
        },
      ]),
    },
    invoiceActivityReader: {
      listInvoiceActivity: vi.fn().mockResolvedValue([
        {
          action: 'invoice.delivered',
          id: 'invoice-event',
          invoiceNumber: '20260001',
          occurredAt: '2026-07-27T12:00:00.000Z',
          outcome: 'success',
        },
      ]),
    },
  };
}
