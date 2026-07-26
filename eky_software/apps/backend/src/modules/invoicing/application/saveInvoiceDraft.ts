import { randomUUID } from 'node:crypto';

import type { InvoiceDraft } from '../domain/invoiceDraft.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import type { CustomerAccessReader } from '../ports/customerAccessReader.js';
import type { InvoiceDraftRepository } from '../ports/invoiceDraftRepository.js';
import type { InvoiceCustomerTaxProfileReader } from '../ports/invoiceCustomerTaxProfileReader.js';
import type { InvoicePaymentSettingsRepository } from '../ports/invoicePaymentSettingsRepository.js';
import { requireReverseChargeCustomerEligibility } from '../domain/invoiceTaxTreatment.js';
import {
  type InvoiceDraftContentInput,
  type InvoiceDraftLineInput,
  prepareInvoiceDraftContent,
} from './prepareInvoiceDraftContent.js';
import {
  resolveInvoiceDraftLatePaymentInterestBasisPoints,
  resolveInvoiceDraftReminderPeriodDays,
} from './resolveInvoiceDraftLatePaymentInterest.js';

export type SaveInvoiceDraftLineInput = InvoiceDraftLineInput;

export interface SaveInvoiceDraftInput extends InvoiceDraftContentInput {
  companyId: string;
}

export interface SaveInvoiceDraftDependencies {
  customerAccessReader: CustomerAccessReader;
  invoiceCustomerTaxProfileReader: InvoiceCustomerTaxProfileReader;
  invoiceDraftRepository: InvoiceDraftRepository;
  invoicePaymentSettingsRepository: InvoicePaymentSettingsRepository;
}

export async function saveInvoiceDraft(
  input: SaveInvoiceDraftInput,
  dependencies: SaveInvoiceDraftDependencies,
): Promise<InvoiceDraft> {
  const companyId = requireIdentifier(input.companyId, 'Company id');
  const customerId = requireIdentifier(input.customerId, 'Customer id');
  const billingRecipientCustomerId =
    input.billingRecipientCustomerId?.trim() ?? '';
  const customerBelongsToCompany =
    await dependencies.customerAccessReader.belongsToCompany(
      customerId,
      companyId,
    );

  if (!customerBelongsToCompany) {
    throw new InvoiceDraftValidationError(
      'Customer is not available for invoicing.',
    );
  }

  if (billingRecipientCustomerId !== '') {
    const billingRecipientBelongsToCompany =
      await dependencies.customerAccessReader.belongsToCompany(
        billingRecipientCustomerId,
        companyId,
      );

    if (!billingRecipientBelongsToCompany) {
      throw new InvoiceDraftValidationError(
        'Billing recipient is not available for invoicing.',
      );
    }
  }

  const latePaymentInterestBasisPoints =
    await resolveInvoiceDraftLatePaymentInterestBasisPoints(
      companyId,
      input.latePaymentInterestBasisPoints,
      dependencies,
    );
  const reminderPeriodDays = await resolveInvoiceDraftReminderPeriodDays(
    companyId,
    input.reminderPeriodDays,
    dependencies,
  );
  const content = prepareInvoiceDraftContent({
    ...input,
    latePaymentInterestBasisPoints,
    reminderPeriodDays,
  });
  if (content.taxTreatment === 'reverseChargeConstruction') {
    const taxProfile =
      await dependencies.invoiceCustomerTaxProfileReader.getTaxProfile(
        customerId,
        companyId,
      );

    if (taxProfile === undefined) {
      throw new InvoiceDraftValidationError(
        'Customer is not available for invoicing.',
      );
    }

    requireReverseChargeCustomerEligibility(taxProfile);
  }
  const now = new Date().toISOString();
  const draft: InvoiceDraft = {
    ...content,
    id: randomUUID(),
    companyId,
    invoiceKind: 'standard',
    creditedInvoiceId: null,
    refundIban: '',
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  };

  return dependencies.invoiceDraftRepository.saveDraft(draft);
}
