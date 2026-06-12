import type { InvoiceDraft } from '../domain/invoiceDraft.js';

export interface InvoiceDraftRepository {
  saveDraft(draft: InvoiceDraft): Promise<InvoiceDraft>;
}
