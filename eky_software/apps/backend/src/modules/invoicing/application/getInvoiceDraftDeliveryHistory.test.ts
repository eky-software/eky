import { createActorContext } from '@eky/auth';
import { AuthorizationError } from '@eky/permissions';
import { describe, expect, it, vi } from 'vitest';

import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import type { InvoiceDraftDeliveryHistoryReader } from '../ports/invoiceDraftDeliveryHistoryReader.js';
import { getInvoiceDraftDeliveryHistory } from './getInvoiceDraftDeliveryHistory.js';
import { InvoiceDraftDeliveryHistoryIntegrityError } from './invoiceDraftDeliveryHistoryIntegrityError.js';
import { InvoiceDraftNotFoundError } from './invoiceDraftNotFoundError.js';

const actorContext = createActorContext({
  actorId: 'synthetic-user', authenticationMode: 'local',
  companyId: 'company-1', permissions: ['sendInvoices'],
});
const input = { actorContext, invoiceDraftId: 'draft-1' };

function reader() {
  const findDeliveryHistory = vi.fn<InvoiceDraftDeliveryHistoryReader['findDeliveryHistory']>();
  return { findDeliveryHistory, dependencies: { invoiceDraftDeliveryHistoryReader: { findDeliveryHistory } } };
}

describe('getInvoiceDraftDeliveryHistory', () => {
  it.each([null, 'independent-invoice-identity'])('returns the reader result for invoice %s without inferring identity', async invoiceId => {
    const f = reader();
    const history = { invoiceId, events: [] };
    f.findDeliveryHistory.mockResolvedValue(history);
    await expect(getInvoiceDraftDeliveryHistory(input, f.dependencies)).resolves.toBe(history);
    expect(f.findDeliveryHistory).toHaveBeenCalledExactlyOnceWith({ companyId: 'company-1', invoiceDraftId: 'draft-1' });
  });

  it('denies permission before validation or any lookup', async () => {
    const f = reader();
    await expect(getInvoiceDraftDeliveryHistory({
      actorContext: { ...actorContext, permissions: [], companyId: '' }, invoiceDraftId: '',
    }, f.dependencies)).rejects.toBeInstanceOf(AuthorizationError);
    expect(f.findDeliveryHistory).not.toHaveBeenCalled();
  });

  it.each(['', '   ', 'x'.repeat(201)])('validates draft id %j before lookup', async invoiceDraftId => {
    const f = reader();
    await expect(getInvoiceDraftDeliveryHistory({ ...input, invoiceDraftId }, f.dependencies))
      .rejects.toBeInstanceOf(InvoiceDraftValidationError);
    expect(f.findDeliveryHistory).not.toHaveBeenCalled();
  });

  it.each(['', '   ', 'x'.repeat(201)])('validates trusted company id %j before lookup', async companyId => {
    const f = reader();
    await expect(getInvoiceDraftDeliveryHistory({ ...input, actorContext: { ...actorContext, companyId } }, f.dependencies))
      .rejects.toBeInstanceOf(InvoiceDraftValidationError);
    expect(f.findDeliveryHistory).not.toHaveBeenCalled();
  });

  it('maps an absent or ineligible draft to the same not-found error', async () => {
    const f = reader();
    f.findDeliveryHistory.mockResolvedValue(undefined);
    await expect(getInvoiceDraftDeliveryHistory(input, f.dependencies)).rejects.toEqual(new InvoiceDraftNotFoundError());
  });

  it('does not turn integrity failure into empty history', async () => {
    const f = reader();
    const error = new InvoiceDraftDeliveryHistoryIntegrityError();
    f.findDeliveryHistory.mockRejectedValue(error);
    await expect(getInvoiceDraftDeliveryHistory(input, f.dependencies)).rejects.toBe(error);
  });
});
