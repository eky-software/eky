import type { InvoiceDraft } from '../domain/invoiceDraft.js';

export interface InvoiceDraftRepository {
  saveDraft(draft: InvoiceDraft): Promise<InvoiceDraft>;
  getDraftById(
    companyId: string,
    invoiceDraftId: string,
  ): Promise<InvoiceDraft | undefined>;
}
