export interface InvoiceApprovalSnapshotRequest {
  companyId: string;
  customerId: string;
  billingRecipientCustomerId: string | null;
}

export interface InvoiceApprovalSnapshotData {
  companyBusinessId: string;
  companyVatNumber: string;
  companyStreetAddress: string;
  companyPostalCode: string;
  companyCity: string;
  companyEmail: string;
  companyPhone: string;
  companyWebsite: string;
  companyIban: string;
  companyBic: string;
  companyBankName: string;
  companyName: string;
  customerBusinessId: string;
  customerCity: string;
  customerEmail: string;
  customerName: string;
  customerNumber: string;
  customerPhone: string;
  customerPostalCode: string;
  customerStreetAddress: string;
  customerType: string;
  billingRecipientBusinessId: string;
  billingRecipientCity: string;
  billingRecipientCustomerId: string;
  billingRecipientCustomerNumber: string;
  billingRecipientCustomerType: string;
  billingRecipientEmail: string;
  billingRecipientName: string;
  billingRecipientPhone: string;
  billingRecipientPostalCode: string;
  billingRecipientStreetAddress: string;
}

export interface InvoiceApprovalSnapshotReader {
  getSnapshotData(
    input: InvoiceApprovalSnapshotRequest,
  ): InvoiceApprovalSnapshotData;
}
