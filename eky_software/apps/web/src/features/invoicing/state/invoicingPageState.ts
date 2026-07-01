export type InvoicingPageMode =
  | 'approvedInvoice'
  | 'draftList'
  | 'editInvoice'
  | 'newInvoice';

export type InvoicingPageAction =
  | { type: 'draftSaved' }
  | { type: 'openEditInvoice' }
  | { type: 'openApprovedInvoice' }
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
    case 'openNewInvoice':
      return 'newInvoice';
    case 'showDraftList':
      return 'draftList';
    default:
      return currentMode;
  }
}
