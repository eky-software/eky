import { createActorContext } from '@eky/auth';
import { describe, expect, it } from 'vitest';

import type { CustomerDetailReader } from '../ports/customerDetailReader.js';
import type {
  CustomerHistoryCriteria,
  CustomerHistoryReader,
} from '../ports/customerHistoryReader.js';
import { CustomerNotFoundError } from './customerReadErrors.js';
import { listCustomerHistory } from './listCustomerHistory.js';

describe('listCustomerHistory', () => {
  it('returns a bounded newest-first page for the actor company and customer', async () => {
    let criteria: CustomerHistoryCriteria | undefined;
    const dependencies = {
      customerDetailReader: existingCustomerReader(),
      customerHistoryReader: {
        async listCustomerHistory(input) {
          criteria = input;
          return [
            createEntry('event-3'),
            createEntry('event-2'),
            createEntry('event-1'),
          ];
        },
      } satisfies CustomerHistoryReader,
    };

    const result = await listCustomerHistory(
      {
        actorContext: createTestActorContext(['viewActivity']),
        customerId: 'customer-1',
        page: 2,
        pageSize: 20,
      },
      dependencies,
    );

    expect(criteria).toEqual({
      companyId: 'company-1',
      customerId: 'customer-1',
      limit: 21,
      offset: 20,
    });
    expect(result).toEqual({
      activityEntries: [
        createEntry('event-3'),
        createEntry('event-2'),
        createEntry('event-1'),
      ],
      hasNextPage: false,
      hasPreviousPage: true,
      page: 2,
      pageSize: 20,
    });
  });

  it('checks permission before reading customer or audit data', async () => {
    let detailRead = false;
    let historyRead = false;

    await expect(
      listCustomerHistory(
        {
          actorContext: createTestActorContext([]),
          customerId: 'customer-1',
        },
        {
          customerDetailReader: {
            async findById() {
              detailRead = true;
              return undefined;
            },
          },
          customerHistoryReader: {
            async listCustomerHistory() {
              historyRead = true;
              return [];
            },
          },
        },
      ),
    ).rejects.toThrow('Permission denied.');
    expect(detailRead).toBe(false);
    expect(historyRead).toBe(false);
  });

  it('does not query history when the scoped customer is not found', async () => {
    let historyRead = false;

    await expect(
      listCustomerHistory(
        {
          actorContext: createTestActorContext(['viewActivity']),
          customerId: 'customer-in-another-company',
        },
        {
          customerDetailReader: {
            async findById() {
              return undefined;
            },
          },
          customerHistoryReader: {
            async listCustomerHistory() {
              historyRead = true;
              return [];
            },
          },
        },
      ),
    ).rejects.toEqual(expect.any(CustomerNotFoundError));
    expect(historyRead).toBe(false);
  });

  it.each([
    { page: 0, pageSize: 20 },
    { page: 101, pageSize: 20 },
    { page: 1, pageSize: 10 },
  ])('rejects invalid pagination: $page/$pageSize', async (input) => {
    await expect(
      listCustomerHistory(
        {
          actorContext: createTestActorContext(['viewActivity']),
          customerId: 'customer-1',
          ...input,
        },
        {
          customerDetailReader: existingCustomerReader(),
          customerHistoryReader: {
            async listCustomerHistory() {
              return [];
            },
          },
        },
      ),
    ).rejects.toThrow(/Customer history/);
  });
});

function createTestActorContext(
  permissions: readonly 'viewActivity'[],
) {
  return createActorContext({
    actorId: 'actor-1',
    authenticationMode: 'local',
    companyId: 'company-1',
    permissions,
  });
}

function existingCustomerReader(): CustomerDetailReader {
  return {
    async findById(companyId, customerId) {
      return {
        id: customerId,
        businessId: '',
        city: '',
        comment: '',
        companyId,
        createdAt: '2026-07-01T00:00:00.000Z',
        customerNumber: '1001',
        customerType: 'company',
        email: '',
        hourlyRateOverrideCents: null,
        managedByCustomerId: '',
        name: 'Synthetic Customer',
        phone: '',
        postalCode: '',
        status: 'active',
        streetAddress: '',
        updatedAt: '2026-07-01T00:00:00.000Z',
      };
    },
  };
}

function createEntry(id: string) {
  return {
    action: 'customer.updated' as const,
    changeCategories: ['contact'] as const,
    id,
    occurredAt: '2026-07-01T00:00:00.000Z',
  };
}
