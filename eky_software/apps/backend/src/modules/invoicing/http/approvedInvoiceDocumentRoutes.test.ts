import { createActorContext } from '@eky/auth';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import type { BackendEnvironment } from '../../../http/runtimeTrust.js';
import { ApprovedInvoiceDocumentNotFoundError } from '../application/approvedInvoiceDocumentNotFoundError.js';
import { InvoiceDocumentIntegrityError } from '../application/invoiceDocumentIntegrityError.js';
import { InvoiceDocumentPublicationConflictError } from '../application/invoiceDocumentPublicationConflictError.js';
import { InvoiceDocumentReadConflictError } from '../application/invoiceDocumentReadConflictError.js';
import type { GenerateApprovedInvoicePdfDocumentInput } from '../application/generateApprovedInvoicePdfDocument.js';
import type {
  ApprovedInvoicePdfDocumentFile,
  GetApprovedInvoicePdfDocumentInput,
} from '../application/getApprovedInvoicePdfDocument.js';
import type { GetApprovedInvoicePdfMetadataInput } from '../application/getApprovedInvoicePdfMetadata.js';
import type { ApprovedInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import { createApprovedInvoiceDocumentRoutes } from './approvedInvoiceDocumentRoutes.js';

describe('approved invoice document routes', () => {
  it.each(['', '/metadata'])('distinguishes a stale PDF read from integrity failure (%s)', async (suffix) => {
    for (const [documentError, status] of [
      [new InvoiceDocumentReadConflictError(), 409],
      [new InvoiceDocumentIntegrityError(), 500],
    ] as const) {
      const { app } = createTestApp({ documentError });
      const response = await app.request(`/invoices/invoice-1/pdf${suffix}`);
      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toStrictEqual({ error: documentError.message });
    }
  });
  it.each([false, true])('returns a safe conflict without internal cleanup details (%s)', async (cleanupFailed) => {
    const { app } = createTestApp({
      generateError: new InvoiceDocumentPublicationConflictError(cleanupFailed),
    });
    const response = await app.request('/invoices/invoice-1/pdf', { method: 'POST' });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toStrictEqual({
      error: 'Invoice changed before the PDF operation completed.',
    });
  });
  it.each([
    { kind: 'revision', revisionId: 'internal-revision' },
    { kind: 'preservedLegacy', sourceDocumentId: 'internal-source' },
    { kind: 'legacyOriginal' },
  ])('keeps $kind binding and arbitrary internal fields out of both metadata responses', async (binding) => {
    const publicDocument = createDocumentMetadata();
    const document = { ...publicDocument, binding, internalOnly: 'not-a-public-field' };
    const { app } = createTestApp({ document });
    const generated = await app.request('/invoices/invoice-1/pdf', { method: 'POST' });
    const stored = await app.request('/invoices/invoice-1/pdf/metadata');

    expect(generated.status).toBe(200);
    expect(stored.status).toBe(200);
    await expect(generated.json()).resolves.toStrictEqual({ document: publicDocument });
    await expect(stored.json()).resolves.toStrictEqual({ document: publicDocument });
  });

  it('creates PDF metadata in the trusted company scope', async () => {
    const document = createDocumentMetadata();
    const { app, getGenerateInput } = createTestApp({ document });

    const response = await app.request('/invoices/invoice-1/pdf', {
      method: 'POST',
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ document });
    expect(getGenerateInput()).toMatchObject({
      actorContext: { actorId: 'dev-user', companyId: 'dev-company', permissions: [] },
      companyId: 'dev-company',
      invoiceId: 'invoice-1',
    });
  });

  it('rejects a body when generating PDF metadata', async () => {
    const { app, getGenerateInput } = createTestApp({});

    const response = await app.request('/invoices/invoice-1/pdf', {
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Request body is not allowed.',
    });
    expect(getGenerateInput()).toBeUndefined();
  });

  it('returns PDF bytes with the existing inline content headers', async () => {
    const pdfDocument = createPdfDocument();
    const { app, getPdfInput } = createTestApp({ pdfDocument });

    const response = await app.request('/invoices/invoice-1/pdf');

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toBe(
      'inline; filename="lasku-20260001.pdf"',
    );
    expect(response.headers.get('Content-Length')).toBe('8');
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    await expect(response.arrayBuffer()).resolves.toEqual(
      pdfDocument.content.buffer,
    );
    expect(getPdfInput()).toEqual({
      companyId: 'dev-company',
      invoiceId: 'invoice-1',
    });
  });

  it('returns stored PDF metadata in the trusted company scope', async () => {
    const document = createDocumentMetadata();
    const { app, getMetadataInput } = createTestApp({ document });

    const response = await app.request('/invoices/invoice-1/pdf/metadata');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ document });
    expect(getMetadataInput()).toEqual({
      companyId: 'dev-company',
      invoiceId: 'invoice-1',
    });
  });

  it('returns the existing safe 404 when PDF bytes are missing', async () => {
    const { app } = createTestApp({
      documentError: new ApprovedInvoiceDocumentNotFoundError(),
    });

    const response = await app.request('/invoices/missing/pdf');

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'Approved invoice document was not found.',
    });
  });

  it('returns the existing safe 404 when PDF metadata is missing', async () => {
    const { app } = createTestApp({
      documentError: new ApprovedInvoiceDocumentNotFoundError(),
    });

    const response = await app.request('/invoices/missing/pdf/metadata');

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'Approved invoice document was not found.',
    });
  });

  it('maps document validation failures to the existing safe 400 response', async () => {
    const { app } = createTestApp({
      generateError: new InvoiceDraftValidationError('Invalid invoice id.'),
    });

    const response = await app.request('/invoices/invalid/pdf', {
      method: 'POST',
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid invoice id.',
    });
  });
});

function createTestApp(options: {
  document?: ApprovedInvoiceDocumentMetadata;
  documentError?: Error;
  generateError?: Error;
  pdfDocument?: ApprovedInvoicePdfDocumentFile;
}) {
  let generateInput: GenerateApprovedInvoicePdfDocumentInput | undefined;
  let metadataInput: GetApprovedInvoicePdfMetadataInput | undefined;
  let pdfInput: GetApprovedInvoicePdfDocumentInput | undefined;
  const routes = createApprovedInvoiceDocumentRoutes({
    async generateApprovedInvoicePdfDocument(input) {
      generateInput = input;

      if (options.generateError !== undefined) {
        throw options.generateError;
      }

      return options.document ?? createDocumentMetadata();
    },
    async getApprovedInvoicePdfDocument(input) {
      pdfInput = input;

      if (options.documentError !== undefined) {
        throw options.documentError;
      }

      return options.pdfDocument ?? createPdfDocument();
    },
    async getApprovedInvoicePdfMetadata(input) {
      metadataInput = input;

      if (options.documentError !== undefined) {
        throw options.documentError;
      }

      return options.document ?? createDocumentMetadata();
    },
  });
  const app = new Hono<BackendEnvironment>();
  app.use('*', async (context, next) => {
    context.set(
      'actorContext',
      createActorContext({
        actorId: 'dev-user',
        authenticationMode: 'local',
        companyId: 'dev-company',
        permissions: [],
      }),
    );
    await next();
  });
  app.route('/', routes);

  return {
    app,
    getGenerateInput: () => generateInput,
    getMetadataInput: () => metadataInput,
    getPdfInput: () => pdfInput,
  };
}

function createDocumentMetadata(): ApprovedInvoiceDocumentMetadata {
  return {
    companyId: 'dev-company',
    createdAt: '2026-07-05T10:00:00.000Z',
    documentType: 'approved_invoice_pdf',
    fileName: 'lasku-20260001.pdf',
    id: 'document-1',
    invoiceId: 'invoice-1',
    mimeType: 'application/pdf',
    sha256:
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    sizeBytes: 8,
    storagePath: 'dev-company/invoice-1/approved-invoice.pdf',
  };
}

function createPdfDocument(): ApprovedInvoicePdfDocumentFile {
  return {
    content: new Uint8Array([37, 80, 68, 70, 45, 116, 101, 115]),
    metadata: createDocumentMetadata(),
  };
}
