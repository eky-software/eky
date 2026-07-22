import { createActorContext } from '@eky/auth';
import { AuthorizationError } from '@eky/permissions';
import { describe, expect, it } from 'vitest';

import { getInvoiceVatRates } from './getInvoiceVatRates.js';
import { updateInvoiceVatRates } from './updateInvoiceVatRates.js';
import type { StoredInvoiceVatRate } from '../domain/invoiceVatRates.js';
import type { InvoiceVatRateRepository } from '../ports/invoiceVatRateRepository.js';

describe('invoice VAT rate application services', () => {
  it('returns current defaults without persisting them', async () => {
    const repository = new FakeInvoiceVatRateRepository();

    const result = await getInvoiceVatRates(
      { actorContext: createActorContextForCompany('company-1') },
      repository,
    );

    expect(result.isPersisted).toBe(false);
    expect(result.vatRates.map((rate) => rate.rateBasisPoints)).toEqual([
      2550, 1350, 1000, 0,
    ]);
    expect(repository.replaceCalls).toBe(0);
  });

  it('replaces only the trusted actor company rates', async () => {
    const repository = new FakeInvoiceVatRateRepository();
    const actorContext = createActorContextForCompany('company-1');

    const result = await updateInvoiceVatRates(
      {
        actorContext,
        now: '2026-07-22T18:00:00.000Z',
        vatRates: [
          createRate(2600, '26,00 %', true, 0),
          createRate(0, '0,00 %', false, 1),
        ],
      },
      repository,
    );

    expect(result).toMatchObject({ isPersisted: true });
    expect(repository.lastCompanyId).toBe('company-1');
    expect(repository.rates[0]).toMatchObject({
      companyId: 'company-1',
      rateBasisPoints: 2600,
    });
  });

  it('denies access without the invoice settings permission', async () => {
    const actorContext = createActorContext({
      actorId: 'user-1',
      authenticationMode: 'local',
      companyId: 'company-1',
      permissions: [],
    });

    await expect(
      getInvoiceVatRates(
        { actorContext },
        new FakeInvoiceVatRateRepository(),
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

class FakeInvoiceVatRateRepository implements InvoiceVatRateRepository {
  rates: StoredInvoiceVatRate[] = [];
  lastCompanyId: string | null = null;
  replaceCalls = 0;

  async listRates(companyId: string): Promise<StoredInvoiceVatRate[]> {
    return this.rates.filter((rate) => rate.companyId === companyId);
  }

  async replaceRates(
    companyId: string,
    vatRates: readonly StoredInvoiceVatRate[],
  ): Promise<StoredInvoiceVatRate[]> {
    this.replaceCalls += 1;
    this.lastCompanyId = companyId;
    this.rates = vatRates.map((rate) => ({ ...rate }));
    return this.listRates(companyId);
  }
}

function createActorContextForCompany(companyId: string) {
  return createActorContext({
    actorId: 'local-owner',
    authenticationMode: 'local',
    companyId,
    permissions: ['manageInvoiceSettings'],
  });
}

function createRate(
  rateBasisPoints: number,
  label: string,
  isDefault: boolean,
  sortOrder: number,
) {
  return {
    rateBasisPoints,
    label,
    isActive: true,
    isDefault,
    sortOrder,
  };
}
