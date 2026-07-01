import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type {
  CompanySettingsRow,
  CustomerRow,
} from '../../../database/schema.js';
import { ApproveInvoiceDraftError } from '../application/approveInvoiceDraftError.js';
import type {
  InvoiceApprovalSnapshotData,
  InvoiceApprovalSnapshotReader,
  InvoiceApprovalSnapshotRequest,
} from '../ports/invoiceApprovalSnapshotReader.js';

export class SqliteInvoiceApprovalSnapshotReader
  implements InvoiceApprovalSnapshotReader
{
  constructor(private readonly database: DatabaseConnection) {}

  getSnapshotData(
    input: InvoiceApprovalSnapshotRequest,
  ): InvoiceApprovalSnapshotData {
    const customer = this.getCustomer(input.companyId, input.customerId);

    if (customer === undefined) {
      throw new ApproveInvoiceDraftError(
        'Invoice customer snapshot could not be created.',
      );
    }

    const recipientCustomerId = input.billingRecipientCustomerId ?? input.customerId;
    const billingRecipient = this.getCustomer(input.companyId, recipientCustomerId);

    if (billingRecipient === undefined) {
      throw new ApproveInvoiceDraftError(
        'Invoice customer snapshot could not be created.',
      );
    }

    const companySettings = this.getCompanySettings(input.companyId);

    return {
      companyBusinessId: companySettings?.business_id ?? '',
      companyVatNumber: companySettings?.vat_number ?? '',
      companyStreetAddress: companySettings?.street_address ?? '',
      companyPostalCode: companySettings?.postal_code ?? '',
      companyCity: companySettings?.city ?? '',
      companyEmail: companySettings?.email ?? '',
      companyPhone: companySettings?.phone ?? '',
      companyIban: companySettings?.iban ?? '',
      companyBic: companySettings?.bic ?? '',
      companyBankName: companySettings?.bank_name ?? '',
      companyName: companySettings?.company_name ?? '',
      customerBusinessId: customer.business_id,
      customerCity: customer.city,
      customerEmail: customer.email,
      customerName: customer.name,
      customerNumber: customer.customer_number,
      customerPhone: customer.phone,
      customerPostalCode: customer.postal_code,
      customerStreetAddress: customer.street_address,
      customerType: customer.customer_type,
      billingRecipientBusinessId: billingRecipient.business_id,
      billingRecipientCity: billingRecipient.city,
      billingRecipientCustomerId: billingRecipient.id,
      billingRecipientCustomerNumber: billingRecipient.customer_number,
      billingRecipientCustomerType: billingRecipient.customer_type,
      billingRecipientEmail: billingRecipient.email,
      billingRecipientName: billingRecipient.name,
      billingRecipientPhone: billingRecipient.phone,
      billingRecipientPostalCode: billingRecipient.postal_code,
      billingRecipientStreetAddress: billingRecipient.street_address,
    };
  }

  private getCustomer(
    companyId: string,
    customerId: string,
  ): CustomerRow | undefined {
    return this.database
      .prepare<[string, string], CustomerRow>(
        `
          SELECT *
          FROM customers
          WHERE company_id = ? AND id = ?
        `,
      )
      .get(companyId, customerId);
  }

  private getCompanySettings(companyId: string): CompanySettingsRow | undefined {
    return this.database
      .prepare<[string], CompanySettingsRow>(
        `
          SELECT *
          FROM company_settings
          WHERE company_id = ?
        `,
      )
      .get(companyId);
  }
}
