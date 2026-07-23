import type { ApprovedInvoiceSummary } from './approvedInvoiceSummary.js';
import type { SentInvoiceCreditStatus } from './sentInvoiceGroup.js';

export interface InvoiceCreditContext {
  sourceInvoiceId: string;
  creditInvoices: ApprovedInvoiceSummary[];
  creditStatus: SentInvoiceCreditStatus;
  remainingCreditableGrossCents: number;
  activeCreditDraftId: string | null;
}
