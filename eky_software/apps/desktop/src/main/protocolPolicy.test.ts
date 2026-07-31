import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createBackendRequestHeaders,
  isAllowedBackendRequest,
  isValidResourceId,
  resolveStaticResourcePath,
} from './protocolPolicy.js';

describe('desktop protocol policy', () => {
  it('shares one strict resource id policy with privileged desktop actions', () => {
    expect(isValidResourceId('invoice_2026-1')).toBe(true);
    expect(isValidResourceId('../invoice-1')).toBe(false);
    expect(isValidResourceId('invoice/1')).toBe(false);
    expect(isValidResourceId('invoice%2f1')).toBe(false);
    expect(isValidResourceId('x'.repeat(101))).toBe(false);
    expect(isValidResourceId(123)).toBe(false);
  });

  it('allows only explicitly named backend routes and methods', () => {
    expect(isAllowedBackendRequest('GET', '/customers')).toBe(true);
    expect(isAllowedBackendRequest('GET', '/customers/customer-1')).toBe(true);
    expect(
      isAllowedBackendRequest('GET', '/customers/customer-1/activity'),
    ).toBe(true);
    expect(
      isAllowedBackendRequest('POST', '/customers/customer-1/activity'),
    ).toBe(false);
    expect(isAllowedBackendRequest('GET', '/activity')).toBe(true);
    expect(isAllowedBackendRequest('POST', '/activity')).toBe(false);
    expect(isAllowedBackendRequest('GET', '/diagnostics/events')).toBe(true);
    expect(isAllowedBackendRequest('GET', '/diagnostics/summary')).toBe(true);
    expect(isAllowedBackendRequest('POST', '/diagnostics/events')).toBe(false);
    expect(
      isAllowedBackendRequest(
        'GET',
        '/diagnostics/support-bundle-data',
      ),
    ).toBe(false);
    expect(isAllowedBackendRequest('PUT', '/invoice-drafts/draft-1')).toBe(true);
    expect(isAllowedBackendRequest('DELETE', '/invoice-drafts/draft-1')).toBe(
      true,
    );
    expect(isAllowedBackendRequest('DELETE', '/invoice-drafts')).toBe(false);
    expect(
      isAllowedBackendRequest('DELETE', '/invoice-drafts/draft-1/extra'),
    ).toBe(false);
    expect(isAllowedBackendRequest('POST', '/invoices/invoice-1/email/dry-run/send')).toBe(
      true,
    );
    expect(
      isAllowedBackendRequest(
        'POST',
        '/invoices/invoice-1/email/smtp-test/prepare',
      ),
    ).toBe(true);
    expect(
      isAllowedBackendRequest(
        'POST',
        '/invoices/invoice-1/email/smtp-test/send',
      ),
    ).toBe(true);
    expect(
      isAllowedBackendRequest(
        'POST',
        '/invoices/invoice-1/email/smtp/prepare',
      ),
    ).toBe(true);
    expect(
      isAllowedBackendRequest(
        'POST',
        '/invoices/invoice-1/email/smtp/send',
      ),
    ).toBe(true);
    expect(
      isAllowedBackendRequest('GET', '/invoices/invoice-1/delivery-events'),
    ).toBe(true);
    expect(
      isAllowedBackendRequest('POST', '/invoices/invoice-1/delivery-events'),
    ).toBe(false);
    expect(
      isAllowedBackendRequest('PUT', '/invoices/invoice-1/payment'),
    ).toBe(true);
    expect(
      isAllowedBackendRequest('DELETE', '/invoices/invoice-1/payment'),
    ).toBe(true);
    expect(
      isAllowedBackendRequest('GET', '/invoices/invoice-1/payment'),
    ).toBe(false);
    expect(
      isAllowedBackendRequest('PUT', '/invoices/invoice%2F1/payment'),
    ).toBe(false);
    expect(
      isAllowedBackendRequest('PUT', '/invoices/invoice-1/payment/extra'),
    ).toBe(false);
    expect(
      isAllowedBackendRequest(
        'POST',
        '/invoices/invoice-1/email/smtp/send/extra',
      ),
    ).toBe(false);
    expect(isAllowedBackendRequest('GET', '/company-settings/email-secret')).toBe(true);
    expect(isAllowedBackendRequest('PUT', '/company-settings/email-secret')).toBe(true);
    expect(isAllowedBackendRequest('DELETE', '/company-settings/email-secret')).toBe(
      true,
    );
    expect(isAllowedBackendRequest('POST', '/company-settings/email-secret')).toBe(false);
    expect(isAllowedBackendRequest('DELETE', '/company-settings')).toBe(false);
    expect(isAllowedBackendRequest('GET', '/invoice-vat-rates')).toBe(true);
    expect(isAllowedBackendRequest('PUT', '/invoice-vat-rates')).toBe(true);
    expect(isAllowedBackendRequest('POST', '/invoice-vat-rates')).toBe(false);
    expect(isAllowedBackendRequest('GET', '/unknown')).toBe(false);
    expect(isAllowedBackendRequest('GET', '/customers/%2e%2e/secret')).toBe(false);
  });

  it('allows only POST for the exact invoice cancellation path', () => {
    expect(
      isAllowedBackendRequest('POST', '/invoices/invoice-1/cancel'),
    ).toBe(true);
    expect(
      isAllowedBackendRequest('GET', '/invoices/invoice-1/cancel'),
    ).toBe(false);
    expect(
      isAllowedBackendRequest('POST', '/invoices/invoice-1/cancel/extra'),
    ).toBe(false);
    expect(
      isAllowedBackendRequest('POST', '/invoices/invoice%2F1/cancel'),
    ).toBe(false);
  });

  it('allows only the exact credit draft routes and methods', () => {
    expect(
      isAllowedBackendRequest('POST', '/invoices/invoice-1/credit-draft'),
    ).toBe(true);
    expect(
      isAllowedBackendRequest('GET', '/invoices/invoice-1/credit-draft'),
    ).toBe(false);
    expect(
      isAllowedBackendRequest('GET', '/invoice-drafts/draft-1/credit'),
    ).toBe(true);
    expect(
      isAllowedBackendRequest('PUT', '/invoice-drafts/draft-1/credit'),
    ).toBe(true);
    expect(
      isAllowedBackendRequest('POST', '/invoice-drafts/draft-1/credit'),
    ).toBe(false);
    expect(
      isAllowedBackendRequest(
        'POST',
        '/invoice-drafts/draft-1/approve-credit',
      ),
    ).toBe(true);
    expect(
      isAllowedBackendRequest(
        'GET',
        '/invoice-drafts/draft-1/approve-credit',
      ),
    ).toBe(false);
    expect(
      isAllowedBackendRequest(
        'POST',
        '/invoice-drafts/draft-1/approve-credit/extra',
      ),
    ).toBe(false);
    expect(
      isAllowedBackendRequest('PUT', '/invoice-drafts/draft%2F1/credit'),
    ).toBe(false);
    expect(
      isAllowedBackendRequest('PUT', '/invoice-drafts/draft-1/credit/extra'),
    ).toBe(false);
  });

  it('allows only GET for the exact invoice credit context path', () => {
    expect(
      isAllowedBackendRequest('GET', '/invoices/invoice-1/credit-context'),
    ).toBe(true);
    expect(
      isAllowedBackendRequest('POST', '/invoices/invoice-1/credit-context'),
    ).toBe(false);
    expect(
      isAllowedBackendRequest(
        'GET',
        '/invoices/invoice-1/credit-context/extra',
      ),
    ).toBe(false);
  });

  it('does not forward renderer-owned credentials or tenant headers', () => {
    const runtimeSessionSecret = 'a'.repeat(43);
    const headers = new Headers({
      accept: 'application/json',
      authorization: 'Bearer renderer-value',
      'content-type': 'application/json',
      cookie: 'session=renderer-value',
      'x-company-id': 'other-company',
      'x-eky-local-session': 'renderer-controlled-value',
    });

    expect(
      Object.fromEntries(
        createBackendRequestHeaders(headers, runtimeSessionSecret),
      ),
    ).toEqual({
      accept: 'application/json',
      'content-type': 'application/json',
      'x-eky-local-session': runtimeSessionSecret,
    });
  });

  it('keeps static resources inside the packaged web root', () => {
    const webRoot = resolve('desktop-test-resources', 'app.asar', 'web');

    expect(resolveStaticResourcePath(webRoot, '/assets/index.js')).toBe(
      join(webRoot, 'assets', 'index.js'),
    );
    expect(resolveStaticResourcePath(webRoot, '/../secret.txt')).toBeUndefined();
    expect(resolveStaticResourcePath(webRoot, '/%2e%2e/secret.txt')).toBeUndefined();
  });
});
