import { requestJson } from '../http.js';
import {
  readApprovedInvoiceListResponse,
  readApprovedInvoiceResponse,
  readReopenedApprovedInvoiceResponse,
} from './approvedInvoicesResponse.js';
import type {
  ApprovedInvoicesApi,
  ApprovedInvoiceSummary,
  ApprovedInvoiceView,
  ReopenedApprovedInvoice,
} from './approvedInvoicesTypes.js';

export function createApprovedInvoicesApi(
  fetchImplementation: typeof fetch,
  baseUrl: string,
): ApprovedInvoicesApi {
  return {
    async getApprovedInvoice(id): Promise<ApprovedInvoiceView> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        `/invoices/${encodeURIComponent(id)}`,
      );

      return readApprovedInvoiceResponse(responseBody);
    },

    async listApprovedInvoices(): Promise<ApprovedInvoiceSummary[]> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        '/invoices',
      );

      return readApprovedInvoiceListResponse(responseBody);
    },

    async reopenApprovedInvoiceForEditing(
      id,
    ): Promise<ReopenedApprovedInvoice> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        `/invoices/${encodeURIComponent(id)}/reopen-for-edit`,
        { method: 'POST' },
      );

      return readReopenedApprovedInvoiceResponse(responseBody);
    },
  };
}
