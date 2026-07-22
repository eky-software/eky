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
