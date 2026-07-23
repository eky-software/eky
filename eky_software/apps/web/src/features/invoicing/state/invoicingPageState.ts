export type InvoicingPageMode =
  | 'approvedInvoice'
  | 'creditInvoice'
  | 'draftList'
  | 'editInvoice'
  | 'newInvoice';

export type InvoicingPageAction =
  | { type: 'draftSaved' }
  | { type: 'openEditInvoice' }
  | { type: 'openApprovedInvoice' }
  | { type: 'openCreditInvoice' }
  | { type: 'openNewInvoice' }
  | { type: 'showDraftList' };

export function reduceInvoicingPageMode(
  currentMode: InvoicingPageMode,
  action: InvoicingPageAction,
): InvoicingPageMode {
  switch (action.type) {
    case 'draftSaved':
      return 'editInvoice';
    case 'openEditInvoice':
      return 'editInvoice';
    case 'openApprovedInvoice':
      return 'approvedInvoice';
    case 'openCreditInvoice':
      return 'creditInvoice';
    case 'openNewInvoice':
      return 'newInvoice';
    case 'showDraftList':
      return 'draftList';
    default:
      return currentMode;
  }
}
