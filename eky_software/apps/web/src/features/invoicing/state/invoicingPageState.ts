export type InvoicingPageMode = 'draftList' | 'editInvoice' | 'newInvoice';

export type InvoicingPageAction =
  | { type: 'openEditInvoice' }
  | { type: 'openNewInvoice' }
  | { type: 'showDraftList' };

export function reduceInvoicingPageMode(
  currentMode: InvoicingPageMode,
  action: InvoicingPageAction,
): InvoicingPageMode {
  switch (action.type) {
    case 'openEditInvoice':
      return 'editInvoice';
    case 'openNewInvoice':
      return 'newInvoice';
    case 'showDraftList':
      return 'draftList';
    default:
      return currentMode;
  }
}
