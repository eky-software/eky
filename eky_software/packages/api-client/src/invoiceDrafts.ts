import { EkyApiError, isRecord, requestJson } from './http.js';

export type InvoicePriceInputMode = 'net' | 'gross';
export type InvoiceDraftStatus = 'draft';
export type InvoiceUnit = 'h' | 'kpl' | 'pv' | 'km' | 'erä';

export type InvoiceLineDiscount =
  | { type: 'none' }
  | { type: 'percentage'; basisPoints: number }
  | { type: 'fixed'; amountCents: number };

export interface InvoiceDraftLineInput {
  code?: string;
  description: string;
  quantityHundredths: number;
  unit: InvoiceUnit;
  unitPriceCents: number;
  vatRateBasisPoints: number;
  discount: InvoiceLineDiscount;
}

export interface InvoiceDraftInput {
  customerId: string;
  invoiceDate: string;
  dueDate?: string;
  paymentTermDays?: number;
  priceInputMode: InvoicePriceInputMode;
  subject?: string;
  orderNumber?: string;
  note?: string;
  lines: InvoiceDraftLineInput[];
}

export interface InvoiceDraftLine {
  id: string;
  position: number;
  code: string;
  description: string;
  quantityHundredths: number;
  unit: InvoiceUnit;
  unitPriceCents: number;
  vatRateBasisPoints: number;
  priceInputMode: InvoicePriceInputMode;
  discount: InvoiceLineDiscount;
  baseCents: number;
  discountCents: number;
  netCents: number;
  vatCents: number;
  grossCents: number;
}

export interface InvoiceVatBreakdown {
  vatRateBasisPoints: number;
  netCents: number;
  vatCents: number;
  grossCents: number;
}

export interface InvoiceTotals {
  netTotalCents: number;
  vatTotalCents: number;
  grossTotalCents: number;
  vatBreakdown: InvoiceVatBreakdown[];
}

export interface InvoiceDraft {
  id: string;
  companyId: string;
  customerId: string;
  status: InvoiceDraftStatus;
  invoiceDate: string;
  dueDate: string;
  paymentTermDays: number;
  priceInputMode: InvoicePriceInputMode;
  subject: string;
  orderNumber: string;
  note: string;
  lines: InvoiceDraftLine[];
  totals: InvoiceTotals;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceDraftSummary {
  id: string;
  customerId: string;
  status: InvoiceDraftStatus;
  invoiceDate: string;
  dueDate: string;
  paymentTermDays: number;
  priceInputMode: InvoicePriceInputMode;
  subject: string;
  netTotalCents: number;
  vatTotalCents: number;
  grossTotalCents: number;
  updatedAt: string;
}

export interface InvoiceDraftListQuery {
  customerId?: string;
}

export interface InvoiceDraftsApi {
  createInvoiceDraft(input: InvoiceDraftInput): Promise<InvoiceDraft>;
  getInvoiceDraft(id: string): Promise<InvoiceDraft>;
  listInvoiceDrafts(query?: InvoiceDraftListQuery): Promise<InvoiceDraftSummary[]>;
  updateInvoiceDraft(id: string, input: InvoiceDraftInput): Promise<InvoiceDraft>;
}

export function createInvoiceDraftsApi(
  fetchImplementation: typeof fetch,
  baseUrl: string,
): InvoiceDraftsApi {
  return {
    async createInvoiceDraft(input): Promise<InvoiceDraft> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        '/invoice-drafts',
        createWriteRequest(input, 'POST'),
      );

      return readInvoiceDraftResponse(responseBody);
    },

    async getInvoiceDraft(id): Promise<InvoiceDraft> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        `/invoice-drafts/${encodeURIComponent(id)}`,
      );

      return readInvoiceDraftResponse(responseBody);
    },

    async listInvoiceDrafts(query = {}): Promise<InvoiceDraftSummary[]> {
      const search = query.customerId === undefined
        ? ''
        : `?customerId=${encodeURIComponent(query.customerId)}`;
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        `/invoice-drafts${search}`,
      );

      if (!isRecord(responseBody) || !Array.isArray(responseBody.invoiceDrafts)) {
        throw invalidInvoiceDraftResponse(responseBody);
      }

      return responseBody.invoiceDrafts.map(parseInvoiceDraftSummary);
    },

    async updateInvoiceDraft(id, input): Promise<InvoiceDraft> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        `/invoice-drafts/${encodeURIComponent(id)}`,
        createWriteRequest(input, 'PUT'),
      );

      return readInvoiceDraftResponse(responseBody);
    },
  };
}

function createWriteRequest(
  input: InvoiceDraftInput,
  method: 'POST' | 'PUT',
): RequestInit {
  return {
    body: JSON.stringify(toInvoiceDraftRequestBody(input)),
    headers: {
      'Content-Type': 'application/json',
    },
    method,
  };
}

function toInvoiceDraftRequestBody(input: InvoiceDraftInput): InvoiceDraftInput {
  const body: InvoiceDraftInput = {
    customerId: input.customerId,
    invoiceDate: input.invoiceDate,
    priceInputMode: input.priceInputMode,
    lines: input.lines.map(toInvoiceDraftLineRequestBody),
  };

  if (input.dueDate !== undefined) {
    body.dueDate = input.dueDate;
  }

  if (input.paymentTermDays !== undefined) {
    body.paymentTermDays = input.paymentTermDays;
  }

  if (input.subject !== undefined) {
    body.subject = input.subject;
  }

  if (input.orderNumber !== undefined) {
    body.orderNumber = input.orderNumber;
  }

  if (input.note !== undefined) {
    body.note = input.note;
  }

  return body;
}

function toInvoiceDraftLineRequestBody(
  input: InvoiceDraftLineInput,
): InvoiceDraftLineInput {
  const line: InvoiceDraftLineInput = {
    description: input.description,
    quantityHundredths: input.quantityHundredths,
    unit: input.unit,
    unitPriceCents: input.unitPriceCents,
    vatRateBasisPoints: input.vatRateBasisPoints,
    discount: cloneDiscount(input.discount),
  };

  if (input.code !== undefined) {
    line.code = input.code;
  }

  return line;
}

function cloneDiscount(discount: InvoiceLineDiscount): InvoiceLineDiscount {
  if (discount.type === 'none') {
    return { type: 'none' };
  }

  if (discount.type === 'percentage') {
    return {
      type: 'percentage',
      basisPoints: discount.basisPoints,
    };
  }

  if (discount.type === 'fixed') {
    return {
      type: 'fixed',
      amountCents: discount.amountCents,
    };
  }

  throw new EkyApiError('Invalid invoice draft input.');
}

function readInvoiceDraftResponse(responseBody: unknown): InvoiceDraft {
  if (!isRecord(responseBody)) {
    throw invalidInvoiceDraftResponse(responseBody);
  }

  return parseInvoiceDraft(responseBody.invoiceDraft);
}

function parseInvoiceDraft(value: unknown): InvoiceDraft {
  if (
    !isRecord(value) ||
    !Array.isArray(value.lines) ||
    !isRecord(value.totals)
  ) {
    throw invalidInvoiceDraftResponse(value);
  }

  return {
    id: readString(value, 'id'),
    companyId: readString(value, 'companyId'),
    customerId: readString(value, 'customerId'),
    status: parseInvoiceDraftStatus(value.status),
    invoiceDate: readString(value, 'invoiceDate'),
    dueDate: readString(value, 'dueDate'),
    paymentTermDays: readSafeInteger(value, 'paymentTermDays'),
    priceInputMode: parsePriceInputMode(value.priceInputMode),
    subject: readString(value, 'subject'),
    orderNumber: readString(value, 'orderNumber'),
    note: readString(value, 'note'),
    lines: value.lines.map(parseInvoiceDraftLine),
    totals: parseInvoiceTotals(value.totals),
    createdAt: readString(value, 'createdAt'),
    updatedAt: readString(value, 'updatedAt'),
  };
}

function parseInvoiceDraftLine(value: unknown): InvoiceDraftLine {
  if (!isRecord(value)) {
    throw invalidInvoiceDraftResponse(value);
  }

  return {
    id: readString(value, 'id'),
    position: readSafeInteger(value, 'position'),
    code: readString(value, 'code'),
    description: readString(value, 'description'),
    quantityHundredths: readSafeInteger(value, 'quantityHundredths'),
    unit: parseInvoiceUnit(value.unit),
    unitPriceCents: readSafeInteger(value, 'unitPriceCents'),
    vatRateBasisPoints: readSafeInteger(value, 'vatRateBasisPoints'),
    priceInputMode: parsePriceInputMode(value.priceInputMode),
    discount: parseDiscount(value.discount),
    baseCents: readSafeInteger(value, 'baseCents'),
    discountCents: readSafeInteger(value, 'discountCents'),
    netCents: readSafeInteger(value, 'netCents'),
    vatCents: readSafeInteger(value, 'vatCents'),
    grossCents: readSafeInteger(value, 'grossCents'),
  };
}

function parseInvoiceTotals(value: Record<string, unknown>): InvoiceTotals {
  if (!Array.isArray(value.vatBreakdown)) {
    throw invalidInvoiceDraftResponse(value);
  }

  return {
    netTotalCents: readSafeInteger(value, 'netTotalCents'),
    vatTotalCents: readSafeInteger(value, 'vatTotalCents'),
    grossTotalCents: readSafeInteger(value, 'grossTotalCents'),
    vatBreakdown: value.vatBreakdown.map(parseInvoiceVatBreakdown),
  };
}

function parseInvoiceVatBreakdown(value: unknown): InvoiceVatBreakdown {
  if (!isRecord(value)) {
    throw invalidInvoiceDraftResponse(value);
  }

  return {
    vatRateBasisPoints: readSafeInteger(value, 'vatRateBasisPoints'),
    netCents: readSafeInteger(value, 'netCents'),
    vatCents: readSafeInteger(value, 'vatCents'),
    grossCents: readSafeInteger(value, 'grossCents'),
  };
}

function parseInvoiceDraftSummary(value: unknown): InvoiceDraftSummary {
  if (!isRecord(value)) {
    throw invalidInvoiceDraftResponse(value);
  }

  return {
    id: readString(value, 'id'),
    customerId: readString(value, 'customerId'),
    status: parseInvoiceDraftStatus(value.status),
    invoiceDate: readString(value, 'invoiceDate'),
    dueDate: readString(value, 'dueDate'),
    paymentTermDays: readSafeInteger(value, 'paymentTermDays'),
    priceInputMode: parsePriceInputMode(value.priceInputMode),
    subject: readString(value, 'subject'),
    netTotalCents: readSafeInteger(value, 'netTotalCents'),
    vatTotalCents: readSafeInteger(value, 'vatTotalCents'),
    grossTotalCents: readSafeInteger(value, 'grossTotalCents'),
    updatedAt: readString(value, 'updatedAt'),
  };
}

function parseDiscount(value: unknown): InvoiceLineDiscount {
  if (!isRecord(value)) {
    throw invalidInvoiceDraftResponse(value);
  }

  if (value.type === 'none') {
    return { type: 'none' };
  }

  if (value.type === 'percentage') {
    return {
      type: 'percentage',
      basisPoints: readSafeInteger(value, 'basisPoints'),
    };
  }

  if (value.type === 'fixed') {
    return {
      type: 'fixed',
      amountCents: readSafeInteger(value, 'amountCents'),
    };
  }

  throw invalidInvoiceDraftResponse(value);
}

function parseInvoiceDraftStatus(value: unknown): InvoiceDraftStatus {
  if (value === 'draft') {
    return value;
  }

  throw invalidInvoiceDraftResponse(value);
}

function parsePriceInputMode(value: unknown): InvoicePriceInputMode {
  if (value === 'net' || value === 'gross') {
    return value;
  }

  throw invalidInvoiceDraftResponse(value);
}

function parseInvoiceUnit(value: unknown): InvoiceUnit {
  if (
    value === 'h' ||
    value === 'kpl' ||
    value === 'pv' ||
    value === 'km' ||
    value === 'erä'
  ) {
    return value;
  }

  throw invalidInvoiceDraftResponse(value);
}

function readString(value: Record<string, unknown>, fieldName: string): string {
  const fieldValue = value[fieldName];

  if (typeof fieldValue === 'string') {
    return fieldValue;
  }

  throw invalidInvoiceDraftResponse(value);
}

function readSafeInteger(
  value: Record<string, unknown>,
  fieldName: string,
): number {
  const fieldValue = value[fieldName];

  if (typeof fieldValue === 'number' && Number.isSafeInteger(fieldValue)) {
    return fieldValue;
  }

  throw invalidInvoiceDraftResponse(value);
}

function invalidInvoiceDraftResponse(responseBody: unknown): EkyApiError {
  return new EkyApiError('Invalid invoice draft response.', { responseBody });
}
