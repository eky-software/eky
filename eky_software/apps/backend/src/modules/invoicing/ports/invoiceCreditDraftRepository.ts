import type { InvoiceDraft } from '../domain/invoiceDraft.js';
import type { PriceInputMode } from '../domain/invoiceCalculation.js';

export interface InvoiceCreditAllocation {
  sourceInvoiceLineId: string | null;
  quantityHundredths: number;
  priceInputMode: PriceInputMode;
  vatRateBasisPoints: number | null;
  baseCents: number;
  discountCents: number;
  netCents: number;
  vatCents: number;
  grossCents: number;
}

export interface CreateCreditDraftPersistenceInput {
  actorUserId: string;
  auditEventId: string;
  draft: InvoiceDraft;
  sourceInvoiceId: string;
}

export type CreateCreditDraftPersistenceResult =
  | { outcome: 'created'; draftId: string }
  | { outcome: 'existing'; draftId: string }
  | { outcome: 'notEligible' };

export interface InvoiceCreditDraftRepository {
  createCreditDraft(
    input: CreateCreditDraftPersistenceInput,
  ): Promise<CreateCreditDraftPersistenceResult>;
  listPreviousCreditLineAllocations(
    companyId: string,
    sourceInvoiceId: string,
  ): Promise<InvoiceCreditAllocation[]>;
}
