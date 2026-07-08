import { requestJson } from '../../http.js';
import { readInvoiceDraftResponse } from '../invoiceDrafts/invoiceDraftsResponse.js';
import {
  readApprovedInvoiceDocumentMetadataResponse,
  readApprovedInvoiceListResponse,
  readApprovedInvoiceResponse,
  readReopenedApprovedInvoiceResponse,
} from './approvedInvoicesResponse.js';
import type {
  ApprovedInvoiceDocumentMetadata,
  ApprovedInvoicesApi,
  ApprovedInvoiceSummary,
  ApprovedInvoiceView,
  ReopenedApprovedInvoice,
} from './approvedInvoicesTypes.js';
import type { InvoiceDraft } from '../invoiceDrafts/index.js';

export function createApprovedInvoicesApi(
  fetchImplementation: typeof fetch,
  baseUrl: string,
): ApprovedInvoicesApi {
  return {
    async copyApprovedInvoiceToDraft(id): Promise<InvoiceDraft> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        `/invoices/${encodeURIComponent(id)}/copy-to-draft`,
        { method: 'POST' },
      );

      return readInvoiceDraftResponse(responseBody);
    },

    async createApprovedInvoicePdf(
      id,
    ): Promise<ApprovedInvoiceDocumentMetadata> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        `/invoices/${encodeURIComponent(id)}/pdf`,
        { method: 'POST' },
      );

      return readApprovedInvoiceDocumentMetadataResponse(responseBody);
    },

    async getApprovedInvoicePdfMetadata(
      id,
    ): Promise<ApprovedInvoiceDocumentMetadata> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        `/invoices/${encodeURIComponent(id)}/pdf/metadata`,
      );

      return readApprovedInvoiceDocumentMetadataResponse(responseBody);
    },

    async getApprovedInvoice(id): Promise<ApprovedInvoiceView> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        `/invoices/${encodeURIComponent(id)}`,
      );

      return readApprovedInvoiceResponse(responseBody);
    },

    getApprovedInvoicePdfUrl(id): string {
      return `${baseUrl}/invoices/${encodeURIComponent(id)}/pdf`;
    },

    async listApprovedInvoices(): Promise<ApprovedInvoiceSummary[]> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        '/invoices',
      );

      return readApprovedInvoiceListResponse(responseBody);
    },

    async markApprovedInvoiceSent(id): Promise<ApprovedInvoiceView> {
      const responseBody = await requestJson(
        fetchImplementation,
        baseUrl,
        `/invoices/${encodeURIComponent(id)}/mark-sent`,
        { method: 'POST' },
      );

      return readApprovedInvoiceResponse(responseBody);
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
