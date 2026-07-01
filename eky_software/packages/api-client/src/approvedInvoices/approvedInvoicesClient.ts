import { requestJson } from '../http.js';
import { readApprovedInvoiceResponse } from './approvedInvoicesResponse.js';
import type {
  ApprovedInvoicesApi,
  ApprovedInvoiceView,
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
  };
}
