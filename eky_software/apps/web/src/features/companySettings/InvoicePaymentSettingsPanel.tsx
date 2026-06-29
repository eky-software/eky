import type { EkyApiClient } from '@eky/api-client';
import { useEffect, useState } from 'react';

import { InvoicePaymentSettingsForm } from './InvoicePaymentSettingsForm.js';
import {
  hasInvoicePaymentSettingsValidationErrors,
  initialInvoicePaymentSettingsForm,
  toInvoicePaymentSettingsForm,
  toUpdateInvoicePaymentSettingsRequest,
  validateInvoicePaymentSettingsForm,
  type InvoicePaymentSettingsForm as InvoicePaymentSettingsFormModel,
  type InvoicePaymentSettingsValidationErrors,
} from './invoicePaymentSettingsFormModel.js';
import { useInvoicePaymentSettings } from './hooks/useInvoicePaymentSettings.js';
import { uiText } from '../../i18n/fi.js';

interface InvoicePaymentSettingsPanelProps {
  apiClient: Pick<
    EkyApiClient,
    'getInvoicePaymentSettings' | 'updateInvoicePaymentSettings'
  >;
}

export function InvoicePaymentSettingsPanel({
  apiClient,
}: InvoicePaymentSettingsPanelProps): React.JSX.Element {
  const paymentSettingsState = useInvoicePaymentSettings(apiClient);
  const [form, setForm] = useState<InvoicePaymentSettingsFormModel>(
    initialInvoicePaymentSettingsForm,
  );
  const [validationErrors, setValidationErrors] =
    useState<InvoicePaymentSettingsValidationErrors>({});

  useEffect(() => {
    if (paymentSettingsState.settings) {
      setForm(toInvoicePaymentSettingsForm(paymentSettingsState.settings));
      setValidationErrors({});
    }
  }, [paymentSettingsState.settings]);

  function handleFieldChange(
    fieldName: keyof InvoicePaymentSettingsFormModel,
    value: string,
  ): void {
    setForm((currentForm) => ({
      ...currentForm,
      [fieldName]: value,
    }));
    setValidationErrors((currentErrors) => ({
      ...currentErrors,
      [fieldName]: undefined,
    }));
  }

  async function handleSubmit(): Promise<void> {
    const nextValidationErrors = validateInvoicePaymentSettingsForm(
      form,
      uiText.companySettings.invoicePaymentValidation,
    );

    setValidationErrors(nextValidationErrors);

    if (hasInvoicePaymentSettingsValidationErrors(nextValidationErrors)) {
      return;
    }

    const updatedSettings = await paymentSettingsState.save(
      toUpdateInvoicePaymentSettingsRequest(form),
    );

    if (updatedSettings) {
      setForm(toInvoicePaymentSettingsForm(updatedSettings));
      setValidationErrors({});
    }
  }

  if (paymentSettingsState.isLoading) {
    return <p className="message">{uiText.companySettings.invoicePaymentLoading}</p>;
  }

  if (paymentSettingsState.errorMessage) {
    return (
      <p className="message error-message">
        {paymentSettingsState.errorMessage}
      </p>
    );
  }

  return (
    <InvoicePaymentSettingsForm
      errorMessage={paymentSettingsState.saveErrorMessage}
      form={form}
      isSaving={paymentSettingsState.isSaving}
      onFieldChange={handleFieldChange}
      onSubmit={() => void handleSubmit()}
      settings={paymentSettingsState.settings}
      successMessage={paymentSettingsState.successMessage}
      validationErrors={validationErrors}
    />
  );
}
