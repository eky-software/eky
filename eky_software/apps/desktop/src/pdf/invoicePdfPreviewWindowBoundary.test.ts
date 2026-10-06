import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';

import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  InvoicePdfPreviewApi,
  InvoicePdfPreviewTarget,
} from './invoicePdfPreviewTypes.js';

const electronBoundary = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn<(name: string, api: InvoicePdfPreviewApi) => void>(),
  fetch: vi.fn<typeof fetch>(),
  handle: vi.fn<(
    scheme: string,
    handler: (request: Request) => Promise<Response>,
  ) => void>(),
  invoke: vi.fn<(...args: unknown[]) => Promise<void>>(),
}));

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electronBoundary.exposeInMainWorld },
  ipcRenderer: { invoke: electronBoundary.invoke },
  net: { fetch: electronBoundary.fetch },
  protocol: { handle: electronBoundary.handle },
}));

import { registerApplicationProtocol } from '../main/applicationProtocol.js';
import { registerElectronPermissionPolicy } from '../security/electronPermissionPolicy.js';
import { invoicePdfPreviewIpcChannel } from './invoicePdfPreviewTypes.js';

const preservedPdfUrl =
  'eky://app/invoices/invoice-1/preserved-documents/document-1/pdf';
const eventPdfUrl =
  'eky://app/invoices/invoice-1/delivery-events/event-1/pdf';
const exactPdfUrls = [preservedPdfUrl, eventPdfUrl];

beforeAll(async () => {
  // Exercise the real sandboxed preload as CommonJS, without a Vite CTS loader.
  const source = await readFile(new URL('../preload/index.cts', import.meta.url), 'utf8');
  const { outputText } = transpileModule(source, {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
    fileName: 'index.cts',
  });
  new Script(outputText).runInNewContext({
    exports: {},
    require(specifier: string) {
      expect(specifier).toBe('electron');
      return {
        contextBridge: { exposeInMainWorld: electronBoundary.exposeInMainWorld },
        ipcRenderer: { invoke: electronBoundary.invoke },
      };
    },
  });
});

beforeEach(() => {
  electronBoundary.fetch.mockReset();
  electronBoundary.handle.mockReset();
  electronBoundary.invoke.mockReset().mockResolvedValue(undefined);
});

describe('invoice PDF preview desktop boundaries', () => {
  it('extends the existing preload capability without changing its default invocation', async () => {
    const [name, api] = electronBoundary.exposeInMainWorld.mock.calls[0]!;

    expect(name).toBe('ekyDesktop');
    expect(Object.keys(api)).toHaveLength(23);
    expect(Object.isFrozen(api)).toBe(true);
    await api.openInvoicePdf('invoice-1');
    await api.openInvoicePdf('invoice-1', undefined);
    expect(electronBoundary.invoke.mock.calls).toEqual([
      [invoicePdfPreviewIpcChannel, 'invoice-1'],
      [invoicePdfPreviewIpcChannel, 'invoice-1'],
    ]);

    const target: InvoicePdfPreviewTarget = {
      kind: 'preservedLegacy', documentId: 'document-1',
    };
    await api.openInvoicePdf('invoice-1', target);
    expect(electronBoundary.invoke).toHaveBeenLastCalledWith(
      invoicePdfPreviewIpcChannel, 'invoice-1', target,
    );
    const eventTarget: InvoicePdfPreviewTarget = {
      kind: 'deliveryEvent', eventId: 'event-1',
    };
    await api.openInvoicePdf('invoice-1', eventTarget);
    expect(electronBoundary.invoke).toHaveBeenLastCalledWith(
      invoicePdfPreviewIpcChannel, 'invoice-1', eventTarget,
    );
  });

  it.each([
    null,
    { kind: 'unknown', documentId: 'document-1' },
    { kind: 'preservedLegacy', documentId: 'document-1', companyId: 'other' },
    { kind: 'deliveryEvent' },
    { kind: 'deliveryEvent', eventId: 'event-1', documentId: 'document-1' },
    { kind: 'deliveryEvent', eventId: 'event-1', companyId: 'other' },
  ])('does not silently strip or default invalid targets before main validation: %o', async (target) => {
    const api = electronBoundary.exposeInMainWorld.mock.calls[0]![1];
    electronBoundary.invoke.mockRejectedValueOnce(
      new Error('INVOICE_PDF_PREVIEW_INVALID_TARGET'),
    );

    await expect(api.openInvoicePdf('invoice-1', target as InvoicePdfPreviewTarget))
      .rejects.toThrow('INVOICE_PDF_PREVIEW_INVALID_TARGET');
    expect(electronBoundary.invoke).toHaveBeenCalledExactlyOnceWith(
      invoicePdfPreviewIpcChannel, 'invoice-1', target,
    );
  });

  it.each(exactPdfUrls)('proxies %s with main-owned session identity and no body', async (pdfUrl) => {
    const handler = registerProtocol();
    electronBoundary.fetch.mockResolvedValueOnce(new Response('%PDF-synthetic', {
      headers: { 'content-type': 'application/pdf' },
    }));

    const response = await handler(new Request(pdfUrl, {
      headers: {
        accept: 'application/pdf',
        authorization: 'Bearer renderer-synthetic',
        cookie: 'renderer-synthetic',
        'x-company-id': 'other-company',
        'x-eky-local-session': 'renderer-synthetic',
      },
    }));

    expect(electronBoundary.fetch).toHaveBeenCalledExactlyOnceWith(
      `http://127.0.0.1:3000${new URL(pdfUrl).pathname}`,
      {
        headers: expect.any(Headers),
        method: 'GET',
      },
    );
    const requestOptions = electronBoundary.fetch.mock.calls[0]![1];
    expect(Object.fromEntries(new Headers(requestOptions?.headers))).toEqual({
      accept: 'application/pdf',
      'x-eky-local-session': 'synthetic-main-session',
    });
    expect(requestOptions).not.toHaveProperty('body');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.has('x-eky-local-session')).toBe(false);
    expect(await response.text()).toBe('%PDF-synthetic');
  });

  it.each(exactPdfUrls.flatMap((pdfUrl) =>
    [401, 403, 404, 409, 500].map((status) => ({ pdfUrl, status })),
  ))('preserves backend denial $status for $pdfUrl', async ({ pdfUrl, status }) => {
    const handler = registerProtocol();
    electronBoundary.fetch.mockResolvedValueOnce(Response.json(
      { error: 'Document unavailable.' }, { status },
    ));

    const response = await handler(new Request(pdfUrl));

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: 'Document unavailable.' });
    expect(electronBoundary.fetch).toHaveBeenCalledOnce();
  });

  it.each(exactPdfUrls.flatMap((pdfUrl) =>
    ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
      .map((method) => ({ pdfUrl, method })),
  ))('never proxies $method for $pdfUrl', async ({ pdfUrl, method }) => {
    const handler = registerProtocol();
    const response = await handler(new Request(pdfUrl, { method }));

    expect(response.status).toBe(405);
    expect(electronBoundary.fetch).not.toHaveBeenCalled();
  });

  it('propagates a native event preview failure without a fallback IPC call', async () => {
    const api = electronBoundary.exposeInMainWorld.mock.calls[0]![1];
    const target: InvoicePdfPreviewTarget = {
      kind: 'deliveryEvent', eventId: 'event-1',
    };
    electronBoundary.invoke.mockRejectedValueOnce(new Error('INVOICE_PDF_PREVIEW_FAILED'));

    await expect(api.openInvoicePdf('invoice-1', target))
      .rejects.toThrow('INVOICE_PDF_PREVIEW_FAILED');
    expect(electronBoundary.invoke).toHaveBeenCalledExactlyOnceWith(
      invoicePdfPreviewIpcChannel, 'invoice-1', target,
    );
    expect(electronBoundary.fetch).not.toHaveBeenCalled();
  });

  it.each(exactPdfUrls)('keeps Electron permissions denied for %s', (pdfUrl) => {
    type Options = Parameters<typeof registerElectronPermissionPolicy>[0];
    const setPermissionCheckHandler = vi.fn<
      Options['permissionSession']['setPermissionCheckHandler']
    >();
    const setPermissionRequestHandler = vi.fn<
      Options['permissionSession']['setPermissionRequestHandler']
    >();
    const write = vi.fn();
    registerElectronPermissionPolicy({
      operationalIdentity: {
        appVersion: '0.0.0',
        buildRevision: '123456789abc',
        runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
      },
      operationalLogger: { write },
      permissionSession: { setPermissionCheckHandler, setPermissionRequestHandler },
    });
    const check = setPermissionCheckHandler.mock.calls[0]![0];
    const request = setPermissionRequestHandler.mock.calls[0]![0];
    const callback = vi.fn();

    expect(check(null, 'notifications', 'eky://app', { isMainFrame: true })).toBe(false);
    request({} as never, 'notifications', callback, {
      isMainFrame: true,
      requestingUrl: pdfUrl,
    });
    expect(callback).toHaveBeenCalledExactlyOnceWith(false);
    expect(write).toHaveBeenCalledOnce();
    expect(JSON.stringify(write.mock.calls)).not.toContain('document-1');
    expect(JSON.stringify(write.mock.calls)).not.toContain('event-1');
    expect(JSON.stringify(write.mock.calls)).not.toContain(pdfUrl);
  });
});

function registerProtocol() {
  registerApplicationProtocol({
    backendOrigin: 'http://127.0.0.1:3000',
    runtimeSessionSecret: 'synthetic-main-session',
    webRoot: 'synthetic-web-root',
  });
  expect(electronBoundary.handle).toHaveBeenCalledWith('eky', expect.any(Function));
  return electronBoundary.handle.mock.calls[0]![1];
}
