import type { InvoiceDraft } from '@eky/api-client';
import { useState } from 'react';

import { InvoiceBasicInfoSection } from './InvoiceBasicInfoSection.js';
import { InvoiceRowsEditor } from './InvoiceRowsEditor.js';
import { InvoiceTotalsPreview } from './InvoiceTotalsPreview.js';
import styles from './NewInvoiceForm.module.css';
import { toNewInvoiceFormStateFromDraft } from '../form/invoiceDraftFormHydration.js';
import {
  addInvoiceRow,
  removeInvoiceRow,
  type InvoiceRowForm,
  type InvoiceRowFormField,
  updateInvoiceRow,
} from '../form/invoiceRowFormState.js';
import {
  createInitialNewInvoiceForm,
  type NewInvoiceBasicInfoField,
  type NewInvoiceFormState,
  updateNewInvoiceFormField,
} from '../form/newInvoiceFormState.js';
import type { InvoiceCustomerListState } from '../hooks/useInvoiceCustomers.js';
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
  mode: NewInvoiceFormMode;
  onBack(): void;
}

export function NewInvoiceForm({
  customerListState,
  mode,
  onBack,
}: NewInvoiceFormProps): React.JSX.Element {
  const [form, setForm] = useState(() => createInitialForm(mode));
  const [hasValidated, setHasValidated] = useState(false);
  const saveState = useSaveInvoiceDraft(createSaveMode(mode));
  const validationResult = prepareInvoiceDraftSaveInput(form);
  const displayedErrors = hasValidated
    ? validationResult.errors
    : undefined;

  function handleFormChange(
    updateForm: (currentForm: NewInvoiceFormState) => NewInvoiceFormState,
  ): void {
    saveState.clearSaveResult();
    setForm(updateForm);
  }

  function handleFieldChange<FieldName extends NewInvoiceBasicInfoField>(
    fieldName: FieldName,
    value: NewInvoiceFormState[FieldName],
  ): void {
    handleFormChange((currentForm) =>
      updateNewInvoiceFormField(currentForm, fieldName, value),
    );
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

    await saveState.saveInvoiceDraft(preparedInput.input);
  }

  const saveButtonText = saveState.isSaving
    ? mode.type === 'edit'
      ? uiText.invoicing.savingDraftChanges
      : uiText.invoicing.savingDraft
    : mode.type === 'edit'
      ? uiText.invoicing.saveDraftChanges
      : uiText.invoicing.saveDraft;
  const successMessage =
    mode.type === 'edit'
      ? uiText.invoicing.saveDraftChangesSuccess
      : uiText.invoicing.saveDraftSuccess;

  return (
    <form
      className={`panel ${styles.form}`}
      onSubmit={(event) => {
        event.preventDefault();
        setHasValidated(true);
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

      {hasValidated ? (
        <p
          className={`message ${
            validationResult.isValid
              ? 'success-message'
              : 'error-message'
          } ${styles.validationMessage}`}
          role={validationResult.isValid ? 'status' : 'alert'}
        >
          {validationResult.isValid
            ? uiText.invoicing.validationSuccess
            : uiText.invoicing.validationSummary}
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

      <InvoiceBasicInfoSection
        customerListState={customerListState}
        errors={displayedErrors}
        form={form}
        onFieldChange={handleFieldChange}
      />
      <InvoiceRowsEditor
        errorsByRowId={displayedErrors?.lines}
        rows={form.lines}
        onAdd={handleAddRow}
        onChange={handleRowChange}
        onRemove={handleRemoveRow}
      />
      <InvoiceTotalsPreview form={form} />

      <footer className={styles.actions}>
        <button className="ghost-button" onClick={onBack} type="button">
          {uiText.invoicing.cancel}
        </button>
        <button className="ghost-button" type="submit">
          {uiText.invoicing.validateForm}
        </button>
        <button
          disabled={saveState.isSaving || saveState.savedDraft !== null}
          type="button"
          onClick={() => {
            void handleSaveDraft();
          }}
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
