import type {
  ApprovedInvoiceResult,
  InvoiceDraft,
} from '@eky/api-client';

import {
  NewInvoiceForm,
  type NewInvoiceFormClient,
} from './NewInvoiceForm.js';
import styles from './InvoicingPage.module.css';
import type { InvoiceCompanySettingsState } from '../hooks/useInvoiceCompanySettings.js';
import type { InvoiceCustomerListState } from '../hooks/useInvoiceCustomers.js';
import type { InvoicePaymentDefaultsState } from '../hooks/useInvoicePaymentDefaults.js';
import type { InvoiceVatRatesState } from '../hooks/useInvoiceVatRates.js';
import { uiText } from '../../../i18n/fi.js';

interface InvoiceDraftEditorViewProps {
  apiClient: NewInvoiceFormClient;
  companySettingsState: InvoiceCompanySettingsState;
  customerListState: InvoiceCustomerListState;
  draft: InvoiceDraft | null;
  draftErrorMessage: string | null;
  editorMode: 'create' | 'edit';
  invoicePaymentDefaultsState: InvoicePaymentDefaultsState;
  invoiceVatRatesState: InvoiceVatRatesState;
  initialCustomerId: string | null;
  isDraftLoading: boolean;
  onBack(): void;
  onDraftApproved(approvedInvoice: ApprovedInvoiceResult): void;
  onDraftSaved(savedDraft: InvoiceDraft): void;
  onOpenApprovedInvoice(id: string): void;
}

export function InvoiceDraftEditorView({
  apiClient,
  companySettingsState,
  customerListState,
  draft,
  draftErrorMessage,
  editorMode,
  invoicePaymentDefaultsState,
  invoiceVatRatesState,
  initialCustomerId,
  isDraftLoading,
  onBack,
  onDraftApproved,
  onDraftSaved,
  onOpenApprovedInvoice,
}: InvoiceDraftEditorViewProps): React.JSX.Element {
  if (editorMode === 'edit' && isDraftLoading) {
    return (
      <section className={`panel ${styles.editorState}`}>
        <p className={styles.state}>{uiText.invoicing.openingDraft}</p>
      </section>
    );
  }

  if (editorMode === 'edit' && draftErrorMessage !== null) {
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

  if (editorMode === 'edit' && draft === null) {
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
      apiClient={apiClient}
      companySettingsState={companySettingsState}
      customerListState={customerListState}
      invoicePaymentDefaultsState={invoicePaymentDefaultsState}
      invoiceVatRatesState={invoiceVatRatesState}
      initialCustomerId={initialCustomerId}
      mode={
        editorMode === 'create'
          ? { type: 'create' }
          : { draft: draft as InvoiceDraft, type: 'edit' }
      }
      onBack={onBack}
      onDraftApproved={onDraftApproved}
      onDraftSaved={onDraftSaved}
      onOpenApprovedInvoice={onOpenApprovedInvoice}
    />
  );
}
