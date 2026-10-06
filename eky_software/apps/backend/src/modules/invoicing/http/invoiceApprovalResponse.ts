import type { ApprovedInvoiceResult } from '../ports/invoiceApprovalRepository.js';
import type { ApprovedCreditInvoiceResult } from '../ports/invoiceCreditApprovalRepository.js';

// Approval revisions are internal; the public response stays an explicit allowlist.
export function toInvoiceApprovalResponse(result: ApprovedInvoiceResult) {
  return {
    invoiceId: result.invoiceId,
    draftId: result.draftId,
    invoiceNumber: result.invoiceNumber,
    referenceNumber: result.referenceNumber,
    referenceNumberType: result.referenceNumberType,
    sequenceNumber: result.sequenceNumber,
    sequenceScope: result.sequenceScope,
    numberingMode: result.numberingMode,
    status: result.status,
  };
}

export function toCreditInvoiceApprovalResponse(result: ApprovedCreditInvoiceResult) {
  return {
    invoiceId: result.invoiceId,
    draftId: result.draftId,
    invoiceNumber: result.invoiceNumber,
    sequenceNumber: result.sequenceNumber,
    sequenceScope: result.sequenceScope,
    numberingMode: result.numberingMode,
    status: result.status,
  };
}
