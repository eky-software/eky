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
  mode: NewInvoiceFormMode;
  onBack(): void;
  onDraftSaved(savedDraft: InvoiceDraft): void;
}

export function NewInvoiceForm({
  customerListState,
  mode,
  onBack,
  onDraftSaved,
}: NewInvoiceFormProps): React.JSX.Element {
  const [form, setForm] = useState(() => createInitialForm(mode));
  const [formRevision, setFormRevision] = useState(0);
  const [hasValidated, setHasValidated] = useState(false);
  const saveState = useSaveInvoiceDraft(createSaveMode(mode));
  const autosaveState = useInvoiceDraftAutosave({
    form,
    formRevision,
    manualSavedDraft: saveState.savedDraft,
    mode,
    onDraftAutosaved: handleDraftAutosaved,
  });
  const validationResult = prepareInvoiceDraftSaveInput(form);
  const displayedErrors = hasValidated
    ? validationResult.errors
    : undefined;

  function handleFormChange(
    updateForm: (currentForm: NewInvoiceFormState) => NewInvoiceFormState,
  ): void {
    saveState.clearSaveResult();
    setForm(updateForm);
    setFormRevision((currentRevision) => currentRevision + 1);
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
    setForm(toNewInvoiceFormStateFromDraft(savedDraft));
    setFormRevision((currentRevision) => currentRevision + 1);
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
        rows={form.lines}
        onAdd={handleAddRow}
        onChange={handleRowChange}
        onRemove={handleRemoveRow}
      />
      <InvoiceTotalsPreview form={form} />

      <footer className={styles.actions}>
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
