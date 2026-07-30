import { createActorContext } from '@eky/auth';
import { describe, expect, it } from 'vitest';

import type { Customer } from '../domain/customer.js';
import type { CustomerDetailReader } from '../ports/customerDetailReader.js';
import { CustomerNotFoundError } from './customerReadErrors.js';
import { getCustomer } from './getCustomer.js';

describe('getCustomer', () => {
  it('reads the customer with the company id from ActorContext', async () => {
    const customer = createCustomer();
    const requests: Array<{ companyId: string; customerId: string }> = [];
    const reader: CustomerDetailReader = {
      async findById(companyId, customerId) {
        requests.push({ companyId, customerId });
        return customer;
      },
    };

    await expect(
      getCustomer(
        {
          actorContext: createTestActorContext(),
          customerId: 'customer-1',
        },
        reader,
      ),
    ).resolves.toBe(customer);
    expect(requests).toEqual([
      { companyId: 'company-1', customerId: 'customer-1' },
    ]);
  });

  it('uses the same not-found error for unknown and another-company customers', async () => {
    const reader: CustomerDetailReader = {
      async findById() {
        return undefined;
      },
    };

    await expect(
      getCustomer(
        {
          actorContext: createTestActorContext(),
          customerId: 'customer-in-another-company',
        },
        reader,
      ),
    ).rejects.toEqual(expect.any(CustomerNotFoundError));
  });
});

function createTestActorContext() {
  return createActorContext({
    actorId: 'actor-1',
    authenticationMode: 'local',
    companyId: 'company-1',
    permissions: [],
  });
}

function createCustomer(): Customer {
  return {
    id: 'customer-1',
    businessId: '1234567-8',
    city: 'Helsinki',
    comment: '',
    companyId: 'company-1',
    createdAt: '2026-07-01T00:00:00.000Z',
    customerNumber: '1001',
    customerType: 'company',
    email: 'synthetic@example.invalid',
    hourlyRateOverrideCents: null,
    managedByCustomerId: '',
    name: 'Synthetic Customer Oy',
    phone: '',
    postalCode: '00100',
    status: 'active',
    streetAddress: 'Testikatu 1',
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}
