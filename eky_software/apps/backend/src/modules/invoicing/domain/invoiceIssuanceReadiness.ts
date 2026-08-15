export interface InvoiceIssuanceReadinessData {
  billingRecipientCity: string;
  billingRecipientName: string;
  billingRecipientPostalCode: string;
  billingRecipientStreetAddress: string;
  companyBusinessId: string;
  companyCity: string;
  companyIban: string;
  companyName: string;
  companyPostalCode: string;
  companyStreetAddress: string;
  companyVatNumber: string;
  customerCity: string;
  customerName: string;
  customerPostalCode: string;
  customerStreetAddress: string;
  hasActiveInvoiceNumberingSettings: boolean;
}

export type InvoiceIssuanceReadinessIssue =
  | 'billingRecipientAddressMissing'
  | 'billingRecipientNameMissing'
  | 'companyAddressMissing'
  | 'companyBusinessIdMissing'
  | 'companyIbanMissing'
  | 'companyNameMissing'
  | 'companyVatNumberMissing'
  | 'customerAddressMissing'
  | 'customerNameMissing'
  | 'invoiceNumberingSettingsMissing';

export interface InvoiceIssuanceReadiness {
  isReady: boolean;
  issues: InvoiceIssuanceReadinessIssue[];
}

export function findInvoiceIssuanceReadinessIssues(
  data: Omit<
    InvoiceIssuanceReadinessData,
    'hasActiveInvoiceNumberingSettings'
  >,
): InvoiceIssuanceReadinessIssue[] {
  const issues: InvoiceIssuanceReadinessIssue[] = [];

  requireValue(data.companyName, 'companyNameMissing', issues);
  requireValue(data.companyBusinessId, 'companyBusinessIdMissing', issues);
  requireValue(data.companyVatNumber, 'companyVatNumberMissing', issues);
  requireAddress(
    data.companyStreetAddress,
    data.companyPostalCode,
    data.companyCity,
    'companyAddressMissing',
    issues,
  );
  requireValue(data.companyIban, 'companyIbanMissing', issues);
  requireValue(data.customerName, 'customerNameMissing', issues);
  requireAddress(
    data.customerStreetAddress,
    data.customerPostalCode,
    data.customerCity,
    'customerAddressMissing',
    issues,
  );
  requireValue(
    data.billingRecipientName,
    'billingRecipientNameMissing',
    issues,
  );
  requireAddress(
    data.billingRecipientStreetAddress,
    data.billingRecipientPostalCode,
    data.billingRecipientCity,
    'billingRecipientAddressMissing',
    issues,
  );

  return issues;
}

function requireAddress(
  streetAddress: string,
  postalCode: string,
  city: string,
  issue: InvoiceIssuanceReadinessIssue,
  issues: InvoiceIssuanceReadinessIssue[],
): void {
  if (
    !hasValue(streetAddress) ||
    !hasValue(postalCode) ||
    !hasValue(city)
  ) {
    issues.push(issue);
  }
}

function requireValue(
  value: string,
  issue: InvoiceIssuanceReadinessIssue,
  issues: InvoiceIssuanceReadinessIssue[],
): void {
  if (!hasValue(value)) {
    issues.push(issue);
  }
}

function hasValue(value: string): boolean {
  return value.trim().length > 0;
}
