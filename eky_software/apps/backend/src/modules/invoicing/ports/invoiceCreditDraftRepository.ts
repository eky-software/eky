import type { InvoiceDraft } from '../domain/invoiceDraft.js';
import type { PreviousCreditAllocation } from '../domain/calculateCreditInvoiceDraft.js';

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
  ): Promise<PreviousCreditAllocation[]>;
}
