import { describe, expect, it } from 'vitest';

import type { InvoiceContentRevision } from '../domain/invoiceContentRevision.js';
import { InvoiceContentRevisionIntegrityError } from './invoiceContentRevisionIntegrityError.js';
import { InvoiceDeliveryConflictError } from './invoiceDeliveryConflictError.js';
import { createUnexpectedLegacyRevisionPromoter } from './prepareInvoiceDeliveryRevision.fixture.js';
import { prepareInvoiceDeliveryRevision } from './prepareInvoiceDeliveryRevision.js';
import { createInvoiceRevisionPdfContentFixture } from './toInvoiceRevisionPdfContent.fixture.js';

const authoritative = createInvoiceRevisionPdfContentFixture();
const scope = { companyId: authoritative.companyId, invoiceId: authoritative.invoiceId };
const legacy: InvoiceContentRevision = {
  ...authoritative, origin: 'legacySnapshot', vatBreakdownState: 'unavailable', vatBreakdown: null,
};
const promoted: InvoiceContentRevision = {
  ...authoritative, origin: 'validatedLegacySnapshot', revisionId: 'promoted-revision',
};

describe('prepareInvoiceDeliveryRevision', () => {
  it.each([authoritative, promoted])('keeps an authoritative exact revision without promotion', async revision => {
    const promoter = createUnexpectedLegacyRevisionPromoter();
    await expect(prepareInvoiceDeliveryRevision(revision, scope, promoter)).resolves.toEqual({
      ...scope, revisionId: revision.revisionId,
    });
    expect(promoter.promoteLegacyRevisionIfCurrent).not.toHaveBeenCalled();
  });

  it('returns only the exact promoted key and passes the observed key to the transaction', async () => {
    const promoter = createUnexpectedLegacyRevisionPromoter();
    promoter.promoteLegacyRevisionIfCurrent.mockResolvedValue(promoted);
    await expect(prepareInvoiceDeliveryRevision(legacy, scope, promoter)).resolves.toEqual({
      ...scope, revisionId: promoted.revisionId,
    });
    expect(promoter.promoteLegacyRevisionIfCurrent).toHaveBeenCalledExactlyOnceWith({
      ...scope, revisionId: legacy.revisionId,
    });
  });

  it.each(['companyId', 'invoiceId'] as const)('rejects a foreign input %s before writing', async field => {
    const promoter = createUnexpectedLegacyRevisionPromoter();
    await expect(prepareInvoiceDeliveryRevision({ ...legacy, [field]: 'foreign' }, scope, promoter))
      .rejects.toBeInstanceOf(InvoiceContentRevisionIntegrityError);
    expect(promoter.promoteLegacyRevisionIfCurrent).not.toHaveBeenCalled();
  });

  it.each([
    { ...promoted, companyId: 'foreign' },
    { ...promoted, invoiceId: 'foreign' },
    { ...promoted, revisionId: legacy.revisionId },
    { ...promoted, revisionId: '' },
    authoritative,
    legacy,
  ])('rejects an incorrectly bound or unvalidated promotion result', async result => {
    const promoter = createUnexpectedLegacyRevisionPromoter();
    promoter.promoteLegacyRevisionIfCurrent.mockResolvedValue(result);
    await expect(prepareInvoiceDeliveryRevision(legacy, scope, promoter))
      .rejects.toBeInstanceOf(InvoiceContentRevisionIntegrityError);
  });

  it('preserves a transaction conflict without selecting a newer revision or retrying', async () => {
    const promoter = createUnexpectedLegacyRevisionPromoter();
    const error = new InvoiceDeliveryConflictError();
    promoter.promoteLegacyRevisionIfCurrent.mockRejectedValue(error);
    await expect(prepareInvoiceDeliveryRevision(legacy, scope, promoter)).rejects.toBe(error);
    expect(promoter.promoteLegacyRevisionIfCurrent).toHaveBeenCalledOnce();
  });
});
