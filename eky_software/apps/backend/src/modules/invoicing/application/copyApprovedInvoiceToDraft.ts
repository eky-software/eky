import { randomUUID } from 'node:crypto';

import type { InvoiceDraft } from '../domain/invoiceDraft.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import type { ApprovedInvoiceReader } from '../ports/approvedInvoiceReader.js';
import type { CustomerAccessReader } from '../ports/customerAccessReader.js';
import type { InvoiceDraftRepository } from '../ports/invoiceDraftRepository.js';
import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import { prepareInvoiceDraftContent } from './prepareInvoiceDraftContent.js';

export interface CopyApprovedInvoiceToDraftInput {
  companyId: string;
  copiedAt: string;
  invoiceId: string;
}

export interface CopyApprovedInvoiceToDraftDependencies {
  approvedInvoiceReader: ApprovedInvoiceReader;
  customerAccessReader: CustomerAccessReader;
  invoiceDraftRepository: InvoiceDraftRepository;
}

export async function copyApprovedInvoiceToDraft(
  input: CopyApprovedInvoiceToDraftInput,
  dependencies: CopyApprovedInvoiceToDraftDependencies,
): Promise<InvoiceDraft> {
  const companyId = requireIdentifier(input.companyId, 'Company id');
  const invoiceId = requireIdentifier(input.invoiceId, 'Invoice id');
  const copiedAt = parseCopyTimestamp(input.copiedAt);
  const invoice = await dependencies.approvedInvoiceReader.getApprovedInvoiceById(
    companyId,
    invoiceId,
  );

  if (invoice === undefined) {
    throw new ApprovedInvoiceNotFoundError();
  }

  if (invoice.invoiceKind !== 'standard') {
    throw new InvoiceDraftValidationError(
      'Only standard invoices can be copied to a standard invoice draft.',
    );
  }

  const customerBelongsToCompany =
    await dependencies.customerAccessReader.belongsToCompany(
      invoice.customerId,
      companyId,
    );

  if (!customerBelongsToCompany) {
    throw new InvoiceDraftValidationError(
      'Customer is not available for invoicing.',
    );
  }

  if (invoice.billingRecipientCustomerId !== null) {
    const billingRecipientBelongsToCompany =
      await dependencies.customerAccessReader.belongsToCompany(
        invoice.billingRecipientCustomerId,
        companyId,
      );

    if (!billingRecipientBelongsToCompany) {
      throw new InvoiceDraftValidationError(
        'Billing recipient is not available for invoicing.',
      );
    }
  }

  const invoiceDate = copiedAt.toISOString().slice(0, 10);
  const content = prepareInvoiceDraftContent({
    billingRecipientCustomerId: invoice.billingRecipientCustomerId,
    customerId: invoice.customerId,
    deliveryAddressText: invoice.deliveryAddressText,
    invoiceDate,
    latePaymentInterestBasisPoints: invoice.latePaymentInterestBasisPoints,
    lines: invoice.lines.map((line) => ({
      code: line.code,
      description: line.description,
      discount: line.discount,
      quantityHundredths: line.quantityHundredths,
      unit: line.unit,
      unitPriceCents: line.unitPriceCents,
      vatRateBasisPoints: line.vatRateBasisPoints,
    })),
    note: invoice.note,
    orderNumber: invoice.orderNumber,
    paymentTermDays: invoice.paymentTermDays,
    priceInputMode: invoice.priceInputMode,
    reminderPeriodDays: invoice.reminderPeriodDays,
    subject: invoice.subject,
  });
  const now = input.copiedAt;
  const draft: InvoiceDraft = {
    ...content,
    companyId,
    createdAt: now,
    creditedInvoiceId: null,
    id: randomUUID(),
    invoiceKind: 'standard',
    refundIban: '',
    status: 'draft',
    updatedAt: now,
  };

  return dependencies.invoiceDraftRepository.saveDraft(draft);
}

function parseCopyTimestamp(value: string): Date {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new InvoiceDraftValidationError('Copy timestamp must be valid.');
  }

  return date;
}
