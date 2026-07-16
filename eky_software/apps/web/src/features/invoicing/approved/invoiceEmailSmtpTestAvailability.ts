import type { CompanySettings } from '@eky/api-client';

import { uiText } from '../../../i18n/fi.js';

export function getInvoiceEmailSmtpTestUnavailableMessage(
  settings: CompanySettings | null,
  settingsErrorMessage: string | null,
  isLoading: boolean,
): string | null {
  if (isLoading) {
    return uiText.invoicing.invoiceEmailSmtpTestSettingsLoading;
  }

  if (settingsErrorMessage !== null || settings === null) {
    return uiText.invoicing.invoiceEmailSmtpTestSettingsUnavailable;
  }

  if (settings.emailDeliveryProvider !== 'dnaSmtp') {
    return uiText.invoicing.invoiceEmailSmtpTestProfileMissing;
  }

  if (!settings.emailSecretConfigured) {
    return uiText.invoicing.invoiceEmailSmtpTestSecretMissing;
  }

  if (
    settings.emailSenderAddress.trim().length === 0 ||
    settings.emailUsername.trim().length === 0 ||
    settings.emailTestRecipientOverride.trim().length === 0
  ) {
    return uiText.invoicing.invoiceEmailSmtpTestSettingsIncomplete;
  }

  return null;
}
