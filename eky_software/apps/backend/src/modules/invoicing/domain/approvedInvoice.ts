import type {
  InvoiceLineDiscount,
  InvoiceTotals,
  PriceInputMode,
} from './invoiceCalculation.js';
import type { InvoiceUnit } from './invoiceDraft.js';
import type { InvoiceNumberingMode } from './invoiceNumbering.js';

export type ApprovedInvoiceStatus = 'approved';
export type InvoiceAuditAction = 'invoice.approved';

export interface ApprovedInvoiceLine {
  id: string;
  invoiceId: string;
  lineOrder: number;
  code: string;
  description: string;
  quantityHundredths: number;
  unit: InvoiceUnit;
  unitPriceCents: number;
  vatRateBasisPoints: number;
  discount: InvoiceLineDiscount;
  baseCents: number;
  discountCents: number;
  netCents: number;
  vatCents: number;
  grossCents: number;
  createdAt: string;
}

export interface ApprovedInvoice {
  id: string;
  companyId: string;
  sourceDraftId: string;
  invoiceNumber: string;
  seriesKey: string;
  sequenceScope: string;
  sequenceNumber: number;
  numberingMode: InvoiceNumberingMode;
  status: ApprovedInvoiceStatus;
  customerId: string;
  customerNumberSnapshot: string;
  customerNameSnapshot: string;
  customerBusinessIdSnapshot: string;
  customerTypeSnapshot: string;
  companyNameSnapshot: string;
  companyBusinessIdSnapshot: string;
  invoiceDate: string;
  dueDate: string;
  paymentTermDays: number;
  priceInputMode: PriceInputMode;
  subject: string;
  orderNumber: string;
  note: string;
  totals: InvoiceTotals;
  lines: ApprovedInvoiceLine[];
  createdAt: string;
  approvedAt: string;
  updatedAt: string;
}

export interface InvoiceAuditEvent {
  id: string;
  companyId: string;
  actorUserId: string;
  action: InvoiceAuditAction;
  draftId: string;
  invoiceId: string;
  invoiceNumber: string;
  createdAt: string;
}
