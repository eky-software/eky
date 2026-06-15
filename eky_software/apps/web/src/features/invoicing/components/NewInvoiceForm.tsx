import { useState } from 'react';

import { InvoiceBasicInfoSection } from './InvoiceBasicInfoSection.js';
import { InvoiceRowsEditor } from './InvoiceRowsEditor.js';
import { InvoiceTotalsPlaceholder } from './InvoiceTotalsPlaceholder.js';
import {
  addInvoiceRow,
  removeInvoiceRow,
  type InvoiceRowForm,
  type InvoiceRowFormField,
  updateInvoiceRow,
} from '../invoiceRowFormState.js';
import {
  createInitialNewInvoiceForm,
  type NewInvoiceBasicInfoField,
  type NewInvoiceFormState,
  updateNewInvoiceFormField,
} from '../newInvoiceFormState.js';
import { useInvoiceCustomers } from '../useInvoiceCustomers.js';
import {
  prepareInvoiceDraftSaveInput,
  useSaveInvoiceDraft,
} from '../useSaveInvoiceDraft.js';
import { uiText } from '../../../i18n/fi.js';

interface NewInvoiceFormProps {
  onBack(): void;
}

export function NewInvoiceForm({
  onBack,
}: NewInvoiceFormProps): React.JSX.Element {
  const [form, setForm] = useState(createInitialNewInvoiceForm);
  const [hasValidated, setHasValidated] = useState(false);
  const customerListState = useInvoiceCustomers();
  const saveState = useSaveInvoiceDraft();
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
    ? uiText.invoicing.savingDraft
    : uiText.invoicing.saveDraft;

  return (
    <form
      className="panel new-invoice-form"
      onSubmit={(event) => {
        event.preventDefault();
        setHasValidated(true);
      }}
    >
      <header className="new-invoice-form-header">
        <div>
          <p className="panel-kicker">{uiText.invoicing.newInvoiceKicker}</p>
          <h2>{uiText.invoicing.newInvoice}</h2>
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
          } invoice-form-validation-message`}
          role={validationResult.isValid ? 'status' : 'alert'}
        >
          {validationResult.isValid
            ? uiText.invoicing.validationSuccess
            : uiText.invoicing.validationSummary}
        </p>
      ) : null}

      {saveState.savedDraft !== null ? (
        <p
          className="message success-message invoice-form-validation-message"
          role="status"
        >
          {uiText.invoicing.saveDraftSuccess}
        </p>
      ) : null}

      {saveState.errorMessage !== null ? (
        <p
          className="message error-message invoice-form-validation-message"
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
      <InvoiceTotalsPlaceholder />

      <footer className="new-invoice-form-actions">
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
