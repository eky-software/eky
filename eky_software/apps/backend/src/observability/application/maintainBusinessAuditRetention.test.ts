import { describe, expect, it, vi } from 'vitest';

import {
  getBusinessAuditRetentionCutoff,
  maintainBusinessAuditRetention,
} from './maintainBusinessAuditRetention.js';

describe('maintainBusinessAuditRetention', () => {
  it('keeps the event year and seven full UTC calendar years', () => {
    expect(
      getBusinessAuditRetentionCutoff(
        new Date('2026-07-27T20:00:00.000Z'),
      ),
    ).toBe('2019-01-01T00:00:00.000Z');
    expect(
      getBusinessAuditRetentionCutoff(
        new Date('2027-01-01T00:00:00.000Z'),
      ),
    ).toBe('2020-01-01T00:00:00.000Z');
    expect(
      getBusinessAuditRetentionCutoff(
        new Date('2033-12-31T23:59:59.999Z'),
      ),
    ).toBe('2026-01-01T00:00:00.000Z');
    expect(
      getBusinessAuditRetentionCutoff(
        new Date('2034-01-01T00:00:00.000Z'),
      ),
    ).toBe('2027-01-01T00:00:00.000Z');
  });

  it('passes one cutoff to each module-owned retention port', async () => {
    const customerRetention = vi.fn().mockResolvedValue(2);
    const companySettingsRetention = vi.fn().mockResolvedValue(3);
    const invoiceSettingsRetention = vi.fn().mockResolvedValue(4);

    await expect(
      maintainBusinessAuditRetention(
        new Date('2026-07-27T20:00:00.000Z'),
        {
          companySettingsAuditRetention: {
            deleteCompanySettingsAuditEventsBefore:
              companySettingsRetention,
          },
          customerAuditRetention: {
            deleteCustomerAuditEventsBefore: customerRetention,
          },
          invoiceSettingsAuditRetention: {
            deleteInvoiceSettingsAuditEventsBefore: invoiceSettingsRetention,
          },
        },
      ),
    ).resolves.toEqual({
      cutoff: '2019-01-01T00:00:00.000Z',
      deletedEventCount: 9,
    });
    expect(customerRetention).toHaveBeenCalledWith(
      '2019-01-01T00:00:00.000Z',
    );
    expect(companySettingsRetention).toHaveBeenCalledWith(
      '2019-01-01T00:00:00.000Z',
    );
    expect(invoiceSettingsRetention).toHaveBeenCalledWith(
      '2019-01-01T00:00:00.000Z',
    );
  });
});
