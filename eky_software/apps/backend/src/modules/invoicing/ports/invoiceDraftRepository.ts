import type { InvoiceDraft } from '../domain/invoiceDraft.js';
import type { InvoiceDraftSummary } from '../domain/invoiceDraftSummary.js';

export interface InvoiceDraftRepository {
  saveDraft(draft: InvoiceDraft): Promise<InvoiceDraft>;
  getDraftById(
    companyId: string,
    invoiceDraftId: string,
  ): Promise<InvoiceDraft | undefined>;
  listDraftSummaries(
    companyId: string,
    customerId?: string,
  ): Promise<InvoiceDraftSummary[]>;
}
