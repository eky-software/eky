import type { EkyApiClient } from '@eky/api-client';
import { useEffect, useState } from 'react';

import { InvoiceNumberingSettingsForm } from './InvoiceNumberingSettingsForm.js';
import {
  hasInvoiceNumberingSettingsValidationErrors,
  initialInvoiceNumberingSettingsForm,
  toInvoiceNumberingSettingsForm,
  toUpdateInvoiceNumberingSettingsRequest,
  validateInvoiceNumberingSettingsForm,
  type InvoiceNumberingSettingsForm as InvoiceNumberingSettingsFormModel,
  type InvoiceNumberingSettingsValidationErrors,
} from './invoiceNumberingSettingsFormModel.js';
import { useInvoiceNumberingSettings } from './hooks/useInvoiceNumberingSettings.js';
import { uiText } from '../../i18n/fi.js';

interface InvoiceNumberingSettingsPanelProps {
  apiClient: Pick<
    EkyApiClient,
    'getInvoiceNumberingSettings' | 'updateInvoiceNumberingSettings'
  >;
}

export function InvoiceNumberingSettingsPanel({
  apiClient,
}: InvoiceNumberingSettingsPanelProps): React.JSX.Element {
  const numberingSettingsState = useInvoiceNumberingSettings(apiClient);
  const [form, setForm] = useState<InvoiceNumberingSettingsFormModel>(
    initialInvoiceNumberingSettingsForm,
  );
  const [validationErrors, setValidationErrors] =
    useState<InvoiceNumberingSettingsValidationErrors>({});

  useEffect(() => {
    if (numberingSettingsState.settings) {
      setForm(toInvoiceNumberingSettingsForm(numberingSettingsState.settings));
      setValidationErrors({});
    }
  }, [numberingSettingsState.settings]);

  function handleFieldChange(
    fieldName: keyof InvoiceNumberingSettingsFormModel,
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
    if (numberingSettingsState.settings?.hasUsedNumbering) {
      return;
    }

    const nextValidationErrors = validateInvoiceNumberingSettingsForm(
      form,
      uiText.companySettings.invoiceNumberingValidation,
    );

    setValidationErrors(nextValidationErrors);

    if (hasInvoiceNumberingSettingsValidationErrors(nextValidationErrors)) {
      return;
    }

    const updatedSettings = await numberingSettingsState.save(
      toUpdateInvoiceNumberingSettingsRequest(form),
    );

    if (updatedSettings) {
      setForm(toInvoiceNumberingSettingsForm(updatedSettings));
      setValidationErrors({});
    }
  }

  if (numberingSettingsState.isLoading) {
    return <p className="message">{uiText.companySettings.invoiceNumberingLoading}</p>;
  }

  if (numberingSettingsState.errorMessage) {
    return (
      <p className="message error-message">
        {numberingSettingsState.errorMessage}
      </p>
    );
  }

  return (
    <InvoiceNumberingSettingsForm
      errorMessage={numberingSettingsState.saveErrorMessage}
      form={form}
      isSaving={numberingSettingsState.isSaving}
      onFieldChange={handleFieldChange}
      onSubmit={() => void handleSubmit()}
      settings={numberingSettingsState.settings}
      successMessage={numberingSettingsState.successMessage}
      validationErrors={validationErrors}
    />
  );
}
