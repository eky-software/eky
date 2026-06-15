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
import { uiText } from '../../../i18n/fi.js';

interface NewInvoiceFormProps {
  onBack(): void;
}

export function NewInvoiceForm({
  onBack,
}: NewInvoiceFormProps): React.JSX.Element {
  const [form, setForm] = useState(createInitialNewInvoiceForm);
  const customerListState = useInvoiceCustomers();

  function handleFieldChange<FieldName extends NewInvoiceBasicInfoField>(
    fieldName: FieldName,
    value: NewInvoiceFormState[FieldName],
  ): void {
    setForm((currentForm) =>
      updateNewInvoiceFormField(currentForm, fieldName, value),
    );
  }

  function handleAddRow(): void {
    setForm((currentForm) => ({
      ...currentForm,
      lines: addInvoiceRow(currentForm.lines),
    }));
  }

  function handleRemoveRow(rowId: string): void {
    setForm((currentForm) => ({
      ...currentForm,
      lines: removeInvoiceRow(currentForm.lines, rowId),
    }));
  }

  function handleRowChange<FieldName extends InvoiceRowFormField>(
    rowId: string,
    fieldName: FieldName,
    value: InvoiceRowForm[FieldName],
  ): void {
    setForm((currentForm) => ({
      ...currentForm,
      lines: updateInvoiceRow(
        currentForm.lines,
        rowId,
        fieldName,
        value,
      ),
    }));
  }

  return (
    <form
      className="panel new-invoice-form"
      onSubmit={(event) => event.preventDefault()}
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

      <InvoiceBasicInfoSection
        customerListState={customerListState}
        form={form}
        onFieldChange={handleFieldChange}
      />
      <InvoiceRowsEditor
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
        <button
          disabled
          title={uiText.invoicing.saveDraftLater}
          type="submit"
        >
          {uiText.invoicing.saveDraft}
        </button>
      </footer>
    </form>
  );
}
