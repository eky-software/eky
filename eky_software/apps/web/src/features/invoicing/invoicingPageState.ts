export type InvoicingPageMode = 'draftList' | 'newInvoice';

export type InvoicingPageAction =
  | { type: 'openNewInvoice' }
  | { type: 'showDraftList' };

export function reduceInvoicingPageMode(
  currentMode: InvoicingPageMode,
  action: InvoicingPageAction,
): InvoicingPageMode {
  switch (action.type) {
    case 'openNewInvoice':
      return 'newInvoice';
    case 'showDraftList':
      return 'draftList';
    default:
      return currentMode;
  }
}
