import { describe, expect, it, vi } from 'vitest';

import { getInvoiceIssuanceReadinessWithClient } from './useInvoiceIssuanceReadiness.js';

describe('getInvoiceIssuanceReadinessWithClient', () => {
  it('uses the feature-scoped API client method', async () => {
    const client = {
      getInvoiceIssuanceReadiness: vi.fn(async () => ({
        isReady: false,
        issues: ['companyIbanMissing'] as ['companyIbanMissing'],
      })),
    };

    await expect(
      getInvoiceIssuanceReadinessWithClient(client, 'draft-1'),
    ).resolves.toEqual({
      isReady: false,
      issues: ['companyIbanMissing'],
    });
    expect(client.getInvoiceIssuanceReadiness).toHaveBeenCalledWith('draft-1');
  });
});
