import { describe, expect, it } from 'vitest';

import {
  createBackendRequestHeaders,
  isAllowedBackendRequest,
  resolveStaticResourcePath,
} from './protocolPolicy.js';

describe('desktop protocol policy', () => {
  it('allows only explicitly named backend routes and methods', () => {
    expect(isAllowedBackendRequest('GET', '/customers')).toBe(true);
    expect(isAllowedBackendRequest('PUT', '/invoice-drafts/draft-1')).toBe(true);
    expect(isAllowedBackendRequest('POST', '/invoices/invoice-1/email/dry-run/send')).toBe(
      true,
    );
    expect(isAllowedBackendRequest('DELETE', '/company-settings')).toBe(false);
    expect(isAllowedBackendRequest('GET', '/unknown')).toBe(false);
    expect(isAllowedBackendRequest('GET', '/customers/%2e%2e/secret')).toBe(false);
  });

  it('does not forward renderer-owned credentials or tenant headers', () => {
    const headers = new Headers({
      accept: 'application/json',
      authorization: 'Bearer renderer-value',
      'content-type': 'application/json',
      cookie: 'session=renderer-value',
      'x-company-id': 'other-company',
    });

    expect(Object.fromEntries(createBackendRequestHeaders(headers))).toEqual({
      accept: 'application/json',
      'content-type': 'application/json',
    });
  });

  it('keeps static resources inside the packaged web root', () => {
    const webRoot = 'C:\\Program Files\\Eky\\resources\\app.asar\\web';

    expect(resolveStaticResourcePath(webRoot, '/assets/index.js')).toBe(
      'C:\\Program Files\\Eky\\resources\\app.asar\\web\\assets\\index.js',
    );
    expect(resolveStaticResourcePath(webRoot, '/../secret.txt')).toBeUndefined();
    expect(resolveStaticResourcePath(webRoot, '/%2e%2e/secret.txt')).toBeUndefined();
  });
});
