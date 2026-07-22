import type { EkyApiClient } from '@eky/api-client';
import { useEffect, useRef, useState } from 'react';

import { InvoiceVatRatesForm } from './InvoiceVatRatesForm.js';
import {
  createEmptyInvoiceVatRateFormRow,
  hasInvoiceVatRatesValidationErrors,
  toInvoiceVatRatesForm,
  toUpdateInvoiceVatRatesRequest,
  validateInvoiceVatRatesForm,
  type InvoiceVatRateFormRow,
  type InvoiceVatRatesValidationErrors,
} from './invoiceVatRatesFormModel.js';
import { useInvoiceVatRates } from './hooks/useInvoiceVatRates.js';
import { uiText } from '../../i18n/fi.js';

interface InvoiceVatRatesPanelProps {
  apiClient: Pick<EkyApiClient, 'getInvoiceVatRates' | 'updateInvoiceVatRates'>;
}

export function InvoiceVatRatesPanel({
  apiClient,
}: InvoiceVatRatesPanelProps): React.JSX.Element {
  const state = useInvoiceVatRates(apiClient);
  const nextRowId = useRef(1);
  const [rows, setRows] = useState<InvoiceVatRateFormRow[]>([]);
  const [validationErrors, setValidationErrors] =
    useState<InvoiceVatRatesValidationErrors>({ rows: {} });

  useEffect(() => {
    if (state.settings !== null) {
      setRows(toInvoiceVatRatesForm(state.settings));
      setValidationErrors({ rows: {} });
    }
  }, [state.settings]);

  if (state.isLoading) {
    return (
      <p className="message">
        {uiText.companySettings.invoiceVatRatesLoading}
      </p>
    );
  }

  if (state.errorMessage !== null) {
    return <p className="message error-message">{state.errorMessage}</p>;
  }

  function handleChange(
    id: string,
    field: keyof Omit<InvoiceVatRateFormRow, 'id'>,
    value: string | boolean,
  ): void {
    setRows((currentRows) =>
      currentRows.map((row) => {
        if (field === 'isDefault' && value === true) {
          return row.id === id
            ? { ...row, isActive: true, isDefault: true }
            : { ...row, isDefault: false };
        }

        return row.id === id
          ? ({ ...row, [field]: value } as InvoiceVatRateFormRow)
          : row;
      }),
    );
    setValidationErrors({ rows: {} });
  }

  async function handleSubmit(): Promise<void> {
    const errors = validateInvoiceVatRatesForm(
      rows,
      uiText.companySettings.invoiceVatRatesValidation,
    );
    setValidationErrors(errors);

    if (hasInvoiceVatRatesValidationErrors(errors)) {
      return;
    }

    const updated = await state.save(toUpdateInvoiceVatRatesRequest(rows));

    if (updated !== null) {
      setRows(toInvoiceVatRatesForm(updated));
    }
  }

  return (
    <InvoiceVatRatesForm
      errorMessage={state.saveErrorMessage}
      isSaving={state.isSaving}
      rows={rows}
      settings={state.settings}
      successMessage={state.successMessage}
      validationErrors={validationErrors}
      onAdd={() =>
        setRows((currentRows) => [
          ...currentRows,
          createEmptyInvoiceVatRateFormRow(
            `new-vat-rate-${nextRowId.current++}`,
          ),
        ])
      }
      onChange={handleChange}
      onRemove={(id) =>
        setRows((currentRows) =>
          currentRows.length > 1
            ? currentRows.filter((row) => row.id !== id)
            : currentRows,
        )
      }
      onSubmit={() => void handleSubmit()}
    />
  );
}
