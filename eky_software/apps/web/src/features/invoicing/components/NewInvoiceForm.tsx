import type { ApprovedInvoiceResult, InvoiceDraft } from '@eky/api-client';
import { useEffect, useState } from 'react';

import {
  InvoiceApprovalConfirmation,
  InvoiceApprovalSuccessPanel,
} from './InvoiceApprovalPanel.js';
import { InvoiceBasicInfoSection } from './InvoiceBasicInfoSection.js';
import { InvoiceRowsEditor } from './InvoiceRowsEditor.js';
import { InvoiceTotalsPreview } from './InvoiceTotalsPreview.js';
import styles from './NewInvoiceForm.module.css';
import { toNewInvoiceFormStateFromDraft } from '../form/invoiceDraftFormHydration.js';
import { applyCustomerBillingRecipientDefault } from '../form/invoiceBillingRecipientDefaults.js';
import { createDummyInvoiceForm } from '../form/invoiceDummyForm.js';
import { applyInvoicePaymentDefaults } from '../form/invoicePaymentDefaults.js';
import {
  addInvoiceRow,
  refreshAutoAppliedHourlyRates,
  removeInvoiceRow,
  type InvoiceRowForm,
  type InvoiceRowFormField,
  updateInvoiceRow,
  updateInvoiceRowDescription,
} from '../form/invoiceRowFormState.js';
import { resolveHourlyRateAutofillConfig } from '../form/invoiceHourlyRatePricing.js';
import {
  createInitialNewInvoiceForm,
  type NewInvoiceBasicInfoField,
  type NewInvoiceFormState,
  updateNewInvoiceFormField,
} from '../form/newInvoiceFormState.js';
import type { InvoiceCustomerListState } from '../hooks/useInvoiceCustomers.js';
import type { InvoiceCompanySettingsState } from '../hooks/useInvoiceCompanySettings.js';
import type { InvoicePaymentDefaultsState } from '../hooks/useInvoicePaymentDefaults.js';
import { useApproveInvoiceDraft } from '../hooks/useApproveInvoiceDraft.js';
import { useInvoiceDraftAutosave } from '../hooks/useInvoiceDraftAutosave.js';
import {
  prepareInvoiceDraftSaveInput,
  useSaveInvoiceDraft,
  type InvoiceDraftSaveMode,
} from '../hooks/useSaveInvoiceDraft.js';
import { uiText } from '../../../i18n/fi.js';

export type NewInvoiceFormMode =
  | { type: 'create' }
  | { draft: InvoiceDraft; type: 'edit' };

interface NewInvoiceFormProps {
  customerListState: InvoiceCustomerListState;
  companySettingsState: InvoiceCompanySettingsState;
  invoicePaymentDefaultsState: InvoicePaymentDefaultsState;
  mode: NewInvoiceFormMode;
  onBack(): void;
  onDraftApproved(approvedInvoice: ApprovedInvoiceResult): void;
  onDraftSaved(savedDraft: InvoiceDraft): void;
  onOpenApprovedInvoice(id: string): void;
}

export function NewInvoiceForm({
  customerListState,
  companySettingsState,
  invoicePaymentDefaultsState,
  mode,
  onBack,
  onDraftApproved,
  onDraftSaved,
  onOpenApprovedInvoice,
}: NewInvoiceFormProps): React.JSX.Element {
  const [form, setForm] = useState(() => createInitialForm(mode));
  const [formRevision, setFormRevision] = useState(0);
  const [hasValidated, setHasValidated] = useState(false);
  const [isApprovalConfirmationVisible, setIsApprovalConfirmationVisible] =
    useState(false);
  const [approvalGuardMessage, setApprovalGuardMessage] =
    useState<string | null>(null);
  const saveState = useSaveInvoiceDraft(createSaveMode(mode));
  const approveState = useApproveInvoiceDraft();
  const autosaveState = useInvoiceDraftAutosave({
    form,
    formRevision,
    manualSavedDraft: saveState.savedDraft,
    mode,
    onDraftAutosaved: handleDraftAutosaved,
  });
  const validationResult = prepareInvoiceDraftSaveInput(form);
  const hourlyRateAutofillConfig = resolveHourlyRateAutofillConfig(
    form.customerId,
    customerListState.customers,
    companySettingsState.companySettings,
  );
  const displayedErrors = hasValidated
    ? validationResult.errors
    : undefined;

  useEffect(() => {
    const settings = invoicePaymentDefaultsState.settings;

    if (mode.type !== 'create' || formRevision !== 0 || settings === null) {
      return;
    }

    setForm((currentForm) =>
      applyInvoicePaymentDefaults(currentForm, settings),
    );
  }, [formRevision, invoicePaymentDefaultsState.settings, mode.type]);

  function handleFormChange(
    updateForm: (currentForm: NewInvoiceFormState) => NewInvoiceFormState,
  ): void {
    saveState.clearSaveResult();
    approveState.clearApprovalResult();
    setApprovalGuardMessage(null);
    setIsApprovalConfirmationVisible(false);
    setForm(updateForm);
    setFormRevision((currentRevision) => currentRevision + 1);
  }

  function handleFieldChange<FieldName extends NewInvoiceBasicInfoField>(
    fieldName: FieldName,
    value: NewInvoiceFormState[FieldName],
  ): void {
    handleFormChange((currentForm) => {
      if (fieldName === 'customerId' && typeof value === 'string') {
        const formWithCustomer = applyCustomerBillingRecipientDefault(
          currentForm,
          customerListState.customers,
          value,
        );

        return {
          ...formWithCustomer,
          lines: refreshAutoAppliedHourlyRates(
            formWithCustomer.lines,
            resolveHourlyRateAutofillConfig(
              value,
              customerListState.customers,
              companySettingsState.companySettings,
            ),
          ),
        };
      }

      return updateNewInvoiceFormField(currentForm, fieldName, value);
    });
  }

  function handleFillDummyInvoice(): void {
    handleFormChange(() =>
      createDummyInvoiceForm(
        customerListState.customers,
        companySettingsState.companySettings,
        invoicePaymentDefaultsState.settings,
      ),
    );
    setHasValidated(false);
  }

  function handleAddRow(): void {
    handleFormChange((currentForm) => ({
      ...currentForm,
      lines: addInvoiceRow(currentForm.lines),
    }));
  }

  function handleRemoveRow(rowId: string): void {
    handleFormChange((currentForm) => ({
      ...currentForm,
      lines: removeInvoiceRow(currentForm.lines, rowId),
    }));
  }

  function handleRowChange<FieldName extends InvoiceRowFormField>(
    rowId: string,
    fieldName: FieldName,
    value: InvoiceRowForm[FieldName],
  ): void {
    if (fieldName === 'description') {
      handleFormChange((currentForm) => ({
        ...currentForm,
        lines: updateInvoiceRowDescription(
          currentForm.lines,
          rowId,
          value as InvoiceRowForm['description'],
          hourlyRateAutofillConfig,
        ),
      }));
      return;
    }

    handleFormChange((currentForm) => ({
      ...currentForm,
      lines: updateInvoiceRow(
        currentForm.lines,
        rowId,
        fieldName,
        value,
      ),
    }));
  }

  async function handleSaveDraft(): Promise<void> {
    const preparedInput = prepareInvoiceDraftSaveInput(form);

    setHasValidated(true);

    if (!preparedInput.isValid) {
      saveState.clearSaveResult();
      return;
    }

    const savedDraft = await saveState.saveInvoiceDraft(preparedInput.input);

    if (savedDraft === null) {
      return;
    }

    replaceFormWithDraft(savedDraft);
    onDraftSaved(savedDraft);
  }

  function handleDraftAutosaved(savedDraft: InvoiceDraft): void {
    replaceFormWithDraft(savedDraft);
    onDraftSaved(savedDraft);
  }

  function replaceFormWithDraft(savedDraft: InvoiceDraft): void {
    setForm((currentForm) =>
      toNewInvoiceFormStateFromDraft(savedDraft, currentForm.lines),
    );
    setFormRevision((currentRevision) => currentRevision + 1);
  }

  function handleRequestApproval(): void {
    approveState.clearApprovalResult();
    setApprovalGuardMessage(null);

    if (mode.type !== 'edit') {
      return;
    }

    if (autosaveState.status !== 'saved' || saveState.isSaving) {
      setApprovalGuardMessage(uiText.invoicing.approveDraftUnsavedChanges);
      setIsApprovalConfirmationVisible(false);
      return;
    }

    setIsApprovalConfirmationVisible(true);
  }

  async function handleConfirmApproval(): Promise<void> {
    if (mode.type !== 'edit') {
      return;
    }

    const approvedInvoice = await approveState.approveDraft(mode.draft.id);

    if (approvedInvoice === null) {
      return;
    }

    setIsApprovalConfirmationVisible(false);
    onDraftApproved(approvedInvoice);
  }

  const isSaving =
    saveState.isSaving || autosaveState.status === 'saving';
  const saveButtonText = isSaving
    ? mode.type === 'edit'
      ? uiText.invoicing.savingDraftChanges
      : uiText.invoicing.savingDraft
    : uiText.invoicing.save;
  const shouldShowAutosaveMessage =
    autosaveState.message !== null &&
    saveState.savedDraft === null &&
    (mode.type === 'edit' || formRevision > 0);
  const successMessage =
    mode.type === 'edit'
      ? uiText.invoicing.saveDraftChangesSuccess
      : uiText.invoicing.saveDraftSuccess;
  const canShowApprovalAction = mode.type === 'edit';

  if (approveState.approvedInvoice !== null) {
    return (
      <InvoiceApprovalSuccessPanel
        approvedInvoice={approveState.approvedInvoice}
        onBack={onBack}
        onOpenApprovedInvoice={onOpenApprovedInvoice}
      />
    );
  }

  return (
    <form
      className={`panel ${styles.form}`}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void handleSaveDraft();
      }}
    >
      <header className={styles.header}>
        <div>
          <p className="panel-kicker">
            {mode.type === 'edit'
              ? uiText.invoicing.editInvoiceKicker
              : uiText.invoicing.newInvoiceKicker}
          </p>
          <h2>
            {mode.type === 'edit'
              ? uiText.invoicing.editInvoice
              : uiText.invoicing.newInvoice}
          </h2>
        </div>
        <button
          className="ghost-button"
          onClick={onBack}
          type="button"
        >
          {uiText.invoicing.backToDrafts}
        </button>
      </header>

      {mode.type === 'create' ? (
        <div className={styles.toolRow}>
          <button
            className="ghost-button"
            onClick={handleFillDummyInvoice}
            type="button"
          >
            {uiText.invoicing.fillDummyInvoice}
          </button>
        </div>
      ) : null}

      {hasValidated && !validationResult.isValid ? (
        <p
          className={`message error-message ${styles.validationMessage}`}
          role="alert"
        >
          {uiText.invoicing.validationSummary}
        </p>
      ) : null}

      {saveState.savedDraft !== null ? (
        <p
          className={`message success-message ${styles.validationMessage}`}
          role="status"
        >
          {successMessage}
        </p>
      ) : null}

      {saveState.errorMessage !== null ? (
        <p
          className={`message error-message ${styles.validationMessage}`}
          role="alert"
        >
          {saveState.errorMessage}
        </p>
      ) : null}

      {approvalGuardMessage !== null ? (
        <p
          className={`message error-message ${styles.validationMessage}`}
          role="alert"
        >
          {approvalGuardMessage}
        </p>
      ) : null}

      {approveState.errorMessage !== null ? (
        <p
          className={`message error-message ${styles.validationMessage}`}
          role="alert"
        >
          {approveState.errorMessage}
        </p>
      ) : null}

      {invoicePaymentDefaultsState.errorMessage !== null ? (
        <p
          className={`message error-message ${styles.validationMessage}`}
          role="alert"
        >
          {invoicePaymentDefaultsState.errorMessage}
        </p>
      ) : null}

      {shouldShowAutosaveMessage ? (
        <p
          className={`message ${
            autosaveState.status === 'error'
              ? 'error-message'
              : 'success-message'
          } ${styles.autosaveMessage}`}
          role={autosaveState.status === 'error' ? 'alert' : 'status'}
        >
          {autosaveState.message}
        </p>
      ) : null}

      <InvoiceBasicInfoSection
        customerListState={customerListState}
        errors={displayedErrors}
        form={form}
        onFieldChange={handleFieldChange}
      />
      <InvoiceRowsEditor
        errorsByRowId={displayedErrors?.lines}
        hourlyRateShortcut={hourlyRateAutofillConfig.shortcut}
        hourlyRateShortcutErrorMessage={companySettingsState.errorMessage}
        rows={form.lines}
        onAdd={handleAddRow}
        onChange={handleRowChange}
        onRemove={handleRemoveRow}
      />
      <InvoiceTotalsPreview form={form} />

      {isApprovalConfirmationVisible ? (
        <InvoiceApprovalConfirmation
          isApproving={approveState.isApproving}
          onCancel={() => setIsApprovalConfirmationVisible(false)}
          onConfirm={() => void handleConfirmApproval()}
        />
      ) : null}

      <footer className={styles.actions}>
        {canShowApprovalAction ? (
          <button
            className="ghost-button"
            disabled={isSaving || approveState.isApproving}
            onClick={handleRequestApproval}
            type="button"
          >
            {uiText.invoicing.approveDraft}
          </button>
        ) : null}
        <button className="ghost-button" onClick={onBack} type="button">
          {uiText.invoicing.backToDrafts}
        </button>
        <button
          disabled={isSaving || saveState.savedDraft !== null}
          type="submit"
        >
          {saveButtonText}
        </button>
      </footer>
    </form>
  );
}

function createInitialForm(mode: NewInvoiceFormMode): NewInvoiceFormState {
  if (mode.type === 'edit') {
    return toNewInvoiceFormStateFromDraft(mode.draft);
  }

  return createInitialNewInvoiceForm();
}

function createSaveMode(mode: NewInvoiceFormMode): InvoiceDraftSaveMode {
  if (mode.type === 'edit') {
    return {
      draftId: mode.draft.id,
      type: 'edit',
    };
  }

  return { type: 'create' };
}
