import { InvoiceDraftValidationError } from './invoiceDraftValidationError.js';

export const invoiceTaxTreatments = [
  'normalVat',
  'reverseChargeConstruction',
] as const;

export type InvoiceTaxTreatment = (typeof invoiceTaxTreatments)[number];

export const reverseChargeConstructionLabel =
  'Käännetty verovelvollisuus';
export const reverseChargeConstructionLegalBasis = 'AVL 8 c §';

export interface InvoiceCustomerTaxProfile {
  customerType: string;
  businessId: string;
}

export function resolveInvoiceTaxTreatment(
  value: string | undefined,
): InvoiceTaxTreatment {
  if (value === undefined || value === 'normalVat') {
    return 'normalVat';
  }

  if (value === 'reverseChargeConstruction') {
    return value;
  }

  throw new InvoiceDraftValidationError(
    'Invoice tax treatment is not supported.',
  );
}

export function requireReverseChargeCustomerEligibility(
  profile: InvoiceCustomerTaxProfile,
): void {
  if (profile.customerType === 'privatePerson') {
    throw new InvoiceDraftValidationError(
      'Reverse charge cannot be used for a private customer.',
    );
  }

  if (profile.businessId.trim() === '') {
    throw new InvoiceDraftValidationError(
      'Reverse charge requires the invoice customer business id.',
    );
  }
}

export function getInvoiceTaxTreatmentSnapshot(
  taxTreatment: InvoiceTaxTreatment,
): { label: string; legalBasis: string } {
  if (taxTreatment === 'reverseChargeConstruction') {
    return {
      label: reverseChargeConstructionLabel,
      legalBasis: reverseChargeConstructionLegalBasis,
    };
  }

  return {
    label: '',
    legalBasis: '',
  };
}
