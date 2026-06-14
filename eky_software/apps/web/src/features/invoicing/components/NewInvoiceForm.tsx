import { useState } from 'react';

import { InvoiceBasicInfoSection } from './InvoiceBasicInfoSection.js';
import { InvoiceRowsPlaceholder } from './InvoiceRowsPlaceholder.js';
import { InvoiceTotalsPlaceholder } from './InvoiceTotalsPlaceholder.js';
import {
  createInitialNewInvoiceForm,
  type NewInvoiceFormState,
  updateNewInvoiceFormField,
} from '../newInvoiceFormState.js';
import { uiText } from '../../../i18n/fi.js';

interface NewInvoiceFormProps {
  onBack(): void;
}

export function NewInvoiceForm({
  onBack,
}: NewInvoiceFormProps): React.JSX.Element {
  const [form, setForm] = useState(createInitialNewInvoiceForm);

  function handleFieldChange<FieldName extends keyof NewInvoiceFormState>(
    fieldName: FieldName,
    value: NewInvoiceFormState[FieldName],
  ): void {
    setForm((currentForm) =>
      updateNewInvoiceFormField(currentForm, fieldName, value),
    );
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
        form={form}
        onFieldChange={handleFieldChange}
      />
      <InvoiceRowsPlaceholder />
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
