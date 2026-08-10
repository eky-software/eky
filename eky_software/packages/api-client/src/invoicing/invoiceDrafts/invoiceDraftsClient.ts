import { requestJson } from '../../http.js';
import {
  readApproveInvoiceDraftResponse,
  readDeleteInvoiceDraftResponse,
  readInvoiceDraftListResponse,
  readInvoiceDraftResponse,
  readInvoiceIssuanceReadinessResponse,
} from './invoiceDraftsResponse.js';
import { serializeInvoiceDraftInput } from './invoiceDraftsSerialization.js';
import type {
  ApprovedInvoiceResult,
  InvoiceDraft,
  InvoiceDraftInput,
  InvoiceIssuanceReadiness,
  InvoiceDraftsApi,
  InvoiceDraftSummary,
} from './invoiceDraftsTypes.js';

export function createInvoiceDraftsApi(
  fetchImplementation: typeof fetch,
  baseUrl: string,
): InvoiceDraftsApi {
  return {
    async approveInvoiceDraft(id, input = {}): Promise<ApprovedInvoiceResult> {
      const hasBody = input.reverseChargeEligibilityConfirmed !== undefined;
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        `/invoice-drafts/${encodeURIComponent(id)}/approve`,
        hasBody
          ? {
              body: JSON.stringify({
                reverseChargeEligibilityConfirmed:
                  input.reverseChargeEligibilityConfirmed,
              }),
              headers: {
                'Content-Type': 'application/json',
              },
              method: 'POST',
            }
          : { method: 'POST' },
      );

      return readApproveInvoiceDraftResponse(responseBody);
    },

    async createInvoiceDraft(input): Promise<InvoiceDraft> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        '/invoice-drafts',
        createWriteRequest(input, 'POST'),
      );

      return readInvoiceDraftResponse(responseBody);
    },

    async deleteInvoiceDraft(id): Promise<void> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        `/invoice-drafts/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      );

      readDeleteInvoiceDraftResponse(responseBody);
    },

    async getInvoiceDraft(id): Promise<InvoiceDraft> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        `/invoice-drafts/${encodeURIComponent(id)}`,
      );

      return readInvoiceDraftResponse(responseBody);
    },

    async getInvoiceIssuanceReadiness(
      id,
    ): Promise<InvoiceIssuanceReadiness> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        `/invoice-drafts/${encodeURIComponent(id)}/issuance-readiness`,
      );

      return readInvoiceIssuanceReadinessResponse(responseBody);
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

      return readInvoiceDraftListResponse(responseBody);
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
    body: JSON.stringify(serializeInvoiceDraftInput(input)),
    headers: {
      'Content-Type': 'application/json',
    },
    method,
  };
}
