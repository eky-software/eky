import type {
  ApprovedInvoiceResult,
  InvoiceDraft,
} from '@eky/api-client';

import { NewInvoiceForm } from './NewInvoiceForm.js';
import styles from './InvoicingPage.module.css';
import type { InvoiceCompanySettingsState } from '../hooks/useInvoiceCompanySettings.js';
import type { InvoiceCustomerListState } from '../hooks/useInvoiceCustomers.js';
import type { InvoicePaymentDefaultsState } from '../hooks/useInvoicePaymentDefaults.js';
import { uiText } from '../../../i18n/fi.js';

interface InvoiceDraftEditorViewProps {
  companySettingsState: InvoiceCompanySettingsState;
  customerListState: InvoiceCustomerListState;
  draft: InvoiceDraft | null;
  draftErrorMessage: string | null;
  invoicePaymentDefaultsState: InvoicePaymentDefaultsState;
  isDraftLoading: boolean;
  onBack(): void;
  onDraftApproved(approvedInvoice: ApprovedInvoiceResult): void;
  onDraftSaved(savedDraft: InvoiceDraft): void;
  onOpenApprovedInvoice(id: string): void;
}

export function InvoiceDraftEditorView({
  companySettingsState,
  customerListState,
  draft,
  draftErrorMessage,
  invoicePaymentDefaultsState,
  isDraftLoading,
  onBack,
  onDraftApproved,
  onDraftSaved,
  onOpenApprovedInvoice,
}: InvoiceDraftEditorViewProps): React.JSX.Element {
  if (isDraftLoading) {
    return (
      <section className={`panel ${styles.editorState}`}>
        <p className={styles.state}>{uiText.invoicing.openingDraft}</p>
      </section>
    );
  }

  if (draftErrorMessage !== null) {
    return (
      <section className={`panel ${styles.editorState}`}>
        <p className="message error-message" role="alert">
          {draftErrorMessage}
        </p>
        <button className="ghost-button" onClick={onBack} type="button">
          {uiText.invoicing.backToDrafts}
        </button>
      </section>
    );
  }

  if (draft === null) {
    return (
      <section className={`panel ${styles.editorState}`}>
        <p className={styles.state}>{uiText.invoicing.openDraftPrompt}</p>
        <button className="ghost-button" onClick={onBack} type="button">
          {uiText.invoicing.backToDrafts}
        </button>
      </section>
    );
  }

  return (
    <NewInvoiceForm
      key={draft.id}
      companySettingsState={companySettingsState}
      customerListState={customerListState}
      invoicePaymentDefaultsState={invoicePaymentDefaultsState}
      mode={{
        draft,
        type: 'edit',
      }}
      onBack={onBack}
      onDraftApproved={onDraftApproved}
      onDraftSaved={onDraftSaved}
      onOpenApprovedInvoice={onOpenApprovedInvoice}
    />
  );
}
