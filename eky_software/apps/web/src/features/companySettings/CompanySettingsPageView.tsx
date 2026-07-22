import { EkyApiError, type EkyApiClient } from '@eky/api-client';
import { useEffect, useState } from 'react';

import { CompanySettingsForm } from './CompanySettingsForm.js';
import { CompanyEmailSecretPanel } from './CompanyEmailSecretPanel.js';
import { InvoiceNumberingSettingsPanel } from './InvoiceNumberingSettingsPanel.js';
import { InvoicePaymentSettingsPanel } from './InvoicePaymentSettingsPanel.js';
import { InvoiceVatRatesPanel } from './InvoiceVatRatesPanel.js';
import {
  initialCompanySettingsForm,
  toCompanySettingsForm,
  toUpdateCompanySettingsRequest,
  type CompanySettingsForm as CompanySettingsFormModel,
} from './companySettingsFormModel.js';
import styles from './CompanySettingsPageView.module.css';
import { getFinnishApiErrorMessage, uiText } from '../../i18n/fi.js';
import { MessageBanner } from '../../shared/ui/index.js';

type CompanySettingsPageClient = Pick<
  EkyApiClient,
  | 'getCompanyEmailSecretStatus'
  | 'getCompanySettings'
  | 'getInvoiceNumberingSettings'
  | 'getInvoicePaymentSettings'
  | 'getInvoiceVatRates'
  | 'removeCompanyEmailSecret'
  | 'setCompanyEmailSecret'
  | 'updateCompanySettings'
  | 'updateInvoiceNumberingSettings'
  | 'updateInvoicePaymentSettings'
  | 'updateInvoiceVatRates'
>;

interface CompanySettingsPageProps {
  apiClient: CompanySettingsPageClient;
  isEmailSecretManagementAvailable: boolean;
}

export function CompanySettingsPage({
  apiClient,
  isEmailSecretManagementAvailable,
}: CompanySettingsPageProps): React.JSX.Element {
  const [form, setForm] = useState<CompanySettingsFormModel>(initialCompanySettingsForm);
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let isActive = true;

    async function loadCompanySettings(): Promise<void> {
      setIsLoading(true);
      setLoadErrorMessage(null);

      try {
        const companySettings = await apiClient.getCompanySettings();

        if (isActive) {
          setForm(toCompanySettingsForm(companySettings));
        }
      } catch (error) {
        if (isActive) {
          setLoadErrorMessage(getErrorMessage(error));
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    void loadCompanySettings();

    return () => {
      isActive = false;
    };
  }, [apiClient]);

  async function handleSave(): Promise<void> {
    if (isSaving) {
      return;
    }

    setIsSaving(true);
    setSaveErrorMessage(null);
    setSuccessMessage(null);

    try {
      const updatedSettings = await apiClient.updateCompanySettings(
        toUpdateCompanySettingsRequest(form),
      );

      setForm(toCompanySettingsForm(updatedSettings));
      setSuccessMessage(uiText.companySettings.saveSuccess);
    } catch (error) {
      setSaveErrorMessage(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  function handleFieldChange(fieldName: keyof CompanySettingsFormModel, value: string): void {
    setSuccessMessage(null);
    setForm((currentForm) => {
      if (fieldName === 'emailSenderAddress') {
        const shouldPrefillUsername =
          currentForm.emailUsername === '' ||
          currentForm.emailUsername === currentForm.emailSenderAddress;

        return {
          ...currentForm,
          emailSenderAddress: value,
          emailUsername: shouldPrefillUsername
            ? value
            : currentForm.emailUsername,
        };
      }

      return {
        ...currentForm,
        [fieldName]: value,
      };
    });
  }

  return (
    <div className={styles.workspace}>
      <section className={`page-intro ${styles.pageHeader}`}>
        <div>
          <p className="eyebrow">{uiText.companySettings.workspace}</p>
          <h2>{uiText.companySettings.title}</h2>
          <p>{uiText.companySettings.description}</p>
        </div>
      </section>

      {loadErrorMessage ? (
        <MessageBanner variant="error">{loadErrorMessage}</MessageBanner>
      ) : null}
      {successMessage ? (
        <MessageBanner variant="success">{successMessage}</MessageBanner>
      ) : null}
      {isLoading ? (
        <MessageBanner variant="info">
          {uiText.companySettings.loading}
        </MessageBanner>
      ) : null}

      {!isLoading ? (
        <div className={styles.viewGrid}>
          <CompanySettingsForm
            errorMessage={saveErrorMessage}
            form={form}
            isSaving={isSaving}
            onFieldChange={handleFieldChange}
            onSubmit={() => void handleSave()}
          />
          {isEmailSecretManagementAvailable ? (
            <CompanyEmailSecretPanel apiClient={apiClient} />
          ) : null}
          <InvoiceVatRatesPanel apiClient={apiClient} />
          <InvoiceNumberingSettingsPanel apiClient={apiClient} />
          <InvoicePaymentSettingsPanel apiClient={apiClient} />
        </div>
      ) : null}
    </div>
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof EkyApiError) {
    const translatedMessage = getFinnishApiErrorMessage(error.message);

    return translatedMessage === error.message
      ? uiText.companySettings.fallbackError
      : translatedMessage;
  }

  if (error instanceof Error && error.message === 'Invalid hourly rate.') {
    return uiText.companySettings.invalidHourlyRate;
  }

  if (error instanceof Error && error.message === 'Invalid company IBAN.') {
    return uiText.companySettings.invalidIban;
  }

  if (error instanceof Error && error.message === 'Invalid company BIC.') {
    return uiText.companySettings.invalidBic;
  }

  if (error instanceof Error && error.message === 'Invalid company bank name.') {
    return uiText.companySettings.invalidBankName;
  }

  if (error instanceof Error && error.message === 'Invalid company VAT number.') {
    return uiText.companySettings.invalidVatNumber;
  }

  if (error instanceof Error && error.message === 'Invalid company email sender address.') {
    return uiText.companySettings.invalidEmailSenderAddress;
  }

  if (error instanceof Error && error.message === 'Invalid company email test recipient.') {
    return uiText.companySettings.invalidEmailTestRecipient;
  }

  return uiText.companySettings.fallbackError;
}
