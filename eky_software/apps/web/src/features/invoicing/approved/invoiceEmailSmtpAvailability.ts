import type { CompanySettings } from '@eky/api-client';

import { uiText } from '../../../i18n/fi.js';

export function getInvoiceEmailSmtpUnavailableMessage(
  settings: CompanySettings | null,
  settingsErrorMessage: string | null,
  isLoading: boolean,
): string | null {
  if (isLoading) {
    return uiText.invoicing.invoiceEmailSmtpSettingsLoading;
  }

  if (settingsErrorMessage !== null || settings === null) {
    return uiText.invoicing.invoiceEmailSmtpSettingsUnavailable;
  }

  if (settings.emailDeliveryProvider !== 'dnaSmtp') {
    return uiText.invoicing.invoiceEmailSmtpProfileMissing;
  }

  if (!settings.emailSecretConfigured) {
    return uiText.invoicing.invoiceEmailSmtpSecretMissing;
  }

  if (
    settings.emailSenderAddress.trim().length === 0 ||
    settings.emailUsername.trim().length === 0
  ) {
    return uiText.invoicing.invoiceEmailSmtpSettingsIncomplete;
  }

  return null;
}
