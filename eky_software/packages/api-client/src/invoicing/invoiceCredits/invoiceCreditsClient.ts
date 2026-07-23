import { requestJson } from '../../http.js';
import {
  readApproveCreditInvoiceDraftResponse,
  readCreditInvoiceDraftResponse,
} from './invoiceCreditsResponse.js';
import { serializeUpdateCreditInvoiceDraftInput } from './invoiceCreditsSerialization.js';
import type {
  ApprovedCreditInvoiceResult,
  CreditInvoiceDraft,
  InvoiceCreditsApi,
  UpdateCreditInvoiceDraftInput,
} from './invoiceCreditsTypes.js';

export function createInvoiceCreditsApi(
  fetchImplementation: typeof fetch,
  baseUrl: string,
): InvoiceCreditsApi {
  return {
    async approveCreditInvoiceDraft(
      invoiceDraftId,
    ): Promise<ApprovedCreditInvoiceResult> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        `/invoice-drafts/${encodeURIComponent(invoiceDraftId)}/approve-credit`,
        { method: 'POST' },
      );

      return readApproveCreditInvoiceDraftResponse(responseBody);
    },

    async createCreditInvoiceDraft(
      invoiceId,
    ): Promise<CreditInvoiceDraft> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        `/invoices/${encodeURIComponent(invoiceId)}/credit-draft`,
        { method: 'POST' },
      );

      return readCreditInvoiceDraftResponse(responseBody);
    },

    async getCreditInvoiceDraft(
      invoiceDraftId,
    ): Promise<CreditInvoiceDraft> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        `/invoice-drafts/${encodeURIComponent(invoiceDraftId)}/credit`,
      );

      return readCreditInvoiceDraftResponse(responseBody);
    },

    async updateCreditInvoiceDraft(
      invoiceDraftId,
      input: UpdateCreditInvoiceDraftInput,
    ): Promise<CreditInvoiceDraft> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        `/invoice-drafts/${encodeURIComponent(invoiceDraftId)}/credit`,
        {
          body: JSON.stringify(serializeUpdateCreditInvoiceDraftInput(input)),
          headers: { 'Content-Type': 'application/json' },
          method: 'PUT',
        },
      );

      return readCreditInvoiceDraftResponse(responseBody);
    },
  };
}
