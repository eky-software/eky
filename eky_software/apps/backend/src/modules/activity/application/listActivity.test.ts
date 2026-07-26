import { AuthorizationError } from '@eky/permissions';
import { describe, expect, it, vi } from 'vitest';

import {
  ActivityValidationError,
  listActivity,
  type ListActivityDependencies,
} from './listActivity.js';

describe('listActivity', () => {
  it('requires viewActivity before invoking readers', async () => {
    const dependencies = createDependencies();

    await expect(
      listActivity(
        {
          actorContext: {
            actorId: 'actor-1',
            authenticationMode: 'local',
            companyId: 'company-1',
            permissions: [],
          },
        },
        dependencies,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(
      dependencies.customerActivityReader.listCustomerActivity,
    ).not.toHaveBeenCalled();
  });

  it('merges safe projections in newest-first order and applies the limit', async () => {
    const dependencies = createDependencies();

    await expect(
      listActivity(
        {
          actorContext: {
            actorId: 'actor-1',
            authenticationMode: 'local',
            companyId: 'company-1',
            permissions: ['viewActivity'],
          },
          limit: 2,
        },
        dependencies,
      ),
    ).resolves.toEqual([
      {
        id: 'invoicing:invoice-event',
        module: 'invoicing',
        occurredAt: '2026-07-27T12:00:00.000Z',
        reference: { kind: 'invoiceNumber', value: '20260001' },
        type: 'invoice.delivered',
      },
      {
        id: 'customers:customer-event',
        module: 'customers',
        occurredAt: '2026-07-27T11:00:00.000Z',
        reference: { kind: 'customerNumber', value: '1001' },
        type: 'customer.updated',
      },
    ]);
    expect(
      dependencies.invoiceActivityReader.listInvoiceActivity,
    ).toHaveBeenCalledWith('company-1', 2);
  });

  it('rejects limits outside the public boundary before reading data', async () => {
    const dependencies = createDependencies();

    await expect(
      listActivity(
        {
          actorContext: {
            actorId: 'actor-1',
            authenticationMode: 'local',
            companyId: 'company-1',
            permissions: ['viewActivity'],
          },
          limit: 101,
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
        },
      ]),
    },
  };
}
