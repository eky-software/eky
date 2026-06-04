import { createEkyApiClient, EkyApiError } from '@eky/api-client';
import { useEffect, useMemo, useState } from 'react';

import { CompanySettingsForm } from './CompanySettingsForm.js';
import {
  initialCompanySettingsForm,
  toCompanySettingsForm,
  toUpdateCompanySettingsRequest,
  type CompanySettingsForm as CompanySettingsFormModel,
} from './companySettingsFormModel.js';
import { getFinnishApiErrorMessage, uiText } from '../i18n/fi.js';

const apiBaseUrl = import.meta.env.VITE_EKY_API_BASE_URL ?? '';

export function CompanySettingsPage(): React.JSX.Element {
  const apiClient = useMemo(() => createEkyApiClient({ baseUrl: apiBaseUrl }), []);
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
    setForm((currentForm) => ({
      ...currentForm,
      [fieldName]: value,
    }));
  }

  return (
    <div className="settings-workspace">
      <section className="page-intro company-settings-page-header">
        <div>
          <p className="eyebrow">{uiText.companySettings.workspace}</p>
          <h2>{uiText.companySettings.title}</h2>
          <p>{uiText.companySettings.description}</p>
        </div>
      </section>

      {loadErrorMessage ? <p className="message error-message">{loadErrorMessage}</p> : null}
      {successMessage ? <p className="message success-message">{successMessage}</p> : null}
      {isLoading ? <p className="message">{uiText.companySettings.loading}</p> : null}

      {!isLoading ? (
        <div className="settings-view-grid">
          <CompanySettingsForm
            errorMessage={saveErrorMessage}
            form={form}
            isSaving={isSaving}
            onFieldChange={handleFieldChange}
            onSubmit={() => void handleSave()}
          />
        </div>
      ) : null}
    </div>
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof EkyApiError) {
    return getFinnishApiErrorMessage(error.message);
  }

  if (error instanceof Error && error.message === 'Invalid hourly rate.') {
    return uiText.companySettings.invalidHourlyRate;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return uiText.companySettings.fallbackError;
}
