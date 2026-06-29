import { defaultInvoicePaymentSettings } from './invoicePaymentSettingsView.js';
import type { InvoicePaymentSettingsRepository } from '../ports/invoicePaymentSettingsRepository.js';

interface ResolveLatePaymentInterestDependencies {
  invoicePaymentSettingsRepository: InvoicePaymentSettingsRepository;
}

export async function resolveInvoiceDraftLatePaymentInterestBasisPoints(
  companyId: string,
  value: number | undefined,
  dependencies: ResolveLatePaymentInterestDependencies,
): Promise<number> {
  if (value !== undefined) {
    return value;
  }

  const settings =
    await dependencies.invoicePaymentSettingsRepository.getSettings(
      companyId,
    );

  return (
    settings?.defaultLatePaymentInterestBasisPoints ??
    defaultInvoicePaymentSettings.defaultLatePaymentInterestBasisPoints
  );
}
