import { EkyApiError, type EkyApiClient } from '@eky/api-client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { CompanySettingsForm } from './CompanySettingsForm.js';
import { CompanyEmailSecretPanel } from './CompanyEmailSecretPanel.js';
import { CompanyOperationsPanel } from './CompanyOperationsPanel.js';
import { InvoiceNumberingSettingsPanel } from './InvoiceNumberingSettingsPanel.js';
import { InvoicePaymentSettingsPanel } from './InvoicePaymentSettingsPanel.js';
import { InvoiceVatRatesPanel } from './InvoiceVatRatesPanel.js';
import { InvoicePdfArchivePanel } from './InvoicePdfArchivePanel.js';
import { ProfileBackupPanel } from './ProfileBackupPanel.js';
import type {
  InvoicePdfArchiveCapability,
  LocalUpdateCapability,
  ProfileProtectionCapability,
} from '../../app/desktopBridge.js';
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
  | 'activateInvoiceNumberingSeries'
  | 'getCompanyEmailSecretStatus'
  | 'getCompanySettings'
  | 'getInvoiceNumberingSeriesOverview'
  | 'getInvoiceNumberingSettings'
  | 'getInvoicePaymentSettings'
  | 'getInvoiceVatRates'
  | 'removeCompanyEmailSecret'
  | 'previewInvoiceNumberingSeriesActivation'
  | 'setCompanyEmailSecret'
  | 'updateCompanySettings'
  | 'updateInvoiceNumberingSettings'
  | 'updateInvoicePaymentSettings'
  | 'updateInvoiceVatRates'
>;

interface CompanySettingsPageProps {
  apiClient: CompanySettingsPageClient;
  invoicePdfArchiveCapability?: InvoicePdfArchiveCapability;
  isEmailSecretManagementAvailable: boolean;
  localUpdateCapability?: LocalUpdateCapability;
  onOpenActivity(): void;
  onOpenDiagnostics(): void;
  profileProtectionCapability?: ProfileProtectionCapability;
}

type CompanySettingsLoadStatus = 'loading' | 'ready' | 'failed';

interface CompanySettingsEditSession {
  apiClient: CompanySettingsPageClient;
  editRevision: number;
  loadAttempt: object | null;
  loadStatus: CompanySettingsLoadStatus;
  savePending: boolean;
}

export function CompanySettingsPage({
  apiClient,
  invoicePdfArchiveCapability,
  isEmailSecretManagementAvailable,
  localUpdateCapability,
  onOpenActivity,
  onOpenDiagnostics,
  profileProtectionCapability,
}: CompanySettingsPageProps): React.JSX.Element {
  const [form, setForm] = useState<CompanySettingsFormModel>(initialCompanySettingsForm);
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [loadStatus, setLoadStatus] = useState<CompanySettingsLoadStatus>('loading');
  const [reloadRevision, setReloadRevision] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const editSession = useRef<CompanySettingsEditSession | null>(null);

  useLayoutEffect(() => {
    editSession.current = {
      apiClient,
      editRevision: 0,
      loadAttempt: null,
      loadStatus: 'loading',
      savePending: false,
    };
    setIsSaving(false);
    setLoadStatus('loading');
    setLoadErrorMessage(null);
    setSaveErrorMessage(null);
    setSuccessMessage(null);

    return () => {
      editSession.current = null;
    };
  }, [apiClient]);

  useEffect(() => {
    const session = editSession.current;
    if (!session || session.apiClient !== apiClient) {
      return;
    }
    const attempt = {};
    session.loadAttempt = attempt;
    session.loadStatus = 'loading';

    const isCurrentAttempt = (): boolean =>
      editSession.current === session && session.loadAttempt === attempt;

    const loadCompanySettings = async (): Promise<void> => {
      setLoadStatus('loading');
      setLoadErrorMessage(null);

      try {
        const companySettings = await apiClient.getCompanySettings();

        if (isCurrentAttempt()) {
          setForm(toCompanySettingsForm(companySettings));
          session.loadStatus = 'ready';
          setLoadStatus('ready');
        }
      } catch (error) {
        if (isCurrentAttempt()) {
          session.loadStatus = 'failed';
          setLoadErrorMessage(getErrorMessage(error));
          setLoadStatus('failed');
        }
      }
    };

    void loadCompanySettings();

    return () => {
      if (session.loadAttempt === attempt) {
        session.loadAttempt = null;
      }
    };
  }, [apiClient, reloadRevision]);

  function handleReload(): void {
    const session = editSession.current;
    if (!session || session.apiClient !== apiClient || session.loadStatus !== 'failed') {
      return;
    }
    session.loadStatus = 'loading';
    setLoadStatus('loading');
    setLoadErrorMessage(null);
    setReloadRevision((currentRevision) => currentRevision + 1);
  }

  async function handleSave(): Promise<void> {
    const session = editSession.current;
    if (
      !session || session.apiClient !== apiClient ||
      session.savePending || session.loadStatus !== 'ready'
    ) {
      return;
    }

    session.savePending = true;
    const savedRevision = session.editRevision;
    setIsSaving(true);
    setSaveErrorMessage(null);
    setSuccessMessage(null);

    try {
      const updatedSettings = await apiClient.updateCompanySettings(
        toUpdateCompanySettingsRequest(form),
      );

      // A committed response acknowledges only the submitted form, not newer edits.
      if (editSession.current === session && session.editRevision === savedRevision) {
        setForm(toCompanySettingsForm(updatedSettings));
        setSuccessMessage(uiText.companySettings.saveSuccess);
      }
    } catch (error) {
      if (editSession.current === session) {
        setSaveErrorMessage(getErrorMessage(error));
      }
    } finally {
      if (editSession.current === session) {
        session.savePending = false;
        setIsSaving(false);
      }
    }
  }

  function handleFieldChange(fieldName: keyof CompanySettingsFormModel, value: string): void {
    const session = editSession.current;
    if (!session || session.apiClient !== apiClient || session.loadStatus !== 'ready') {
      return;
    }
    session.editRevision += 1;
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
      {loadErrorMessage ? (
        <MessageBanner variant="error">{loadErrorMessage}</MessageBanner>
      ) : null}
      {successMessage ? (
        <MessageBanner variant="success">{successMessage}</MessageBanner>
      ) : null}
      {loadStatus === 'loading' ? (
        <MessageBanner variant="info">
          {uiText.companySettings.loading}
        </MessageBanner>
      ) : null}

      {loadStatus === 'failed' ? (
        <div>
          <button className="ghost-button" onClick={handleReload} type="button">
            {uiText.companySettings.reload}
          </button>
        </div>
      ) : null}

      <div className={styles.viewGrid}>
        {loadStatus === 'ready' ? (
          <CompanySettingsForm
            errorMessage={saveErrorMessage}
            form={form}
            isSaving={isSaving}
            onFieldChange={handleFieldChange}
            onSubmit={() => void handleSave()}
          />
        ) : null}
        {isEmailSecretManagementAvailable ? (
          <CompanyEmailSecretPanel apiClient={apiClient} />
        ) : null}
        <InvoiceVatRatesPanel apiClient={apiClient} />
        <InvoiceNumberingSettingsPanel apiClient={apiClient} />
        <InvoicePaymentSettingsPanel apiClient={apiClient} />
        <InvoicePdfArchivePanel
          {...(invoicePdfArchiveCapability === undefined
            ? {}
            : { capability: invoicePdfArchiveCapability })}
        />
        <ProfileBackupPanel
          {...(profileProtectionCapability === undefined
            ? {}
            : { capability: profileProtectionCapability })}
        />
        <CompanyOperationsPanel
          {...(localUpdateCapability === undefined
            ? {}
            : { localUpdateCapability })}
          onOpenActivity={onOpenActivity}
          onOpenDiagnostics={onOpenDiagnostics}
        />
      </div>
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
