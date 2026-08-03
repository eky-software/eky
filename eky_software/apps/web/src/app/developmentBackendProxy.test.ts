import { describe, expect, it } from 'vitest';

import {
  createDevelopmentBackendProxy,
  developmentBackendProxyPaths,
} from './developmentBackendProxy.js';

describe('developmentBackendProxy', () => {
  it('proxies business and operational views to the local backend', () => {
    const proxy = createDevelopmentBackendProxy('http://127.0.0.1:3000');

    expect(proxy['/activity']).toEqual({
      changeOrigin: true,
      target: 'http://127.0.0.1:3000',
    });
    expect(proxy['/diagnostics']).toEqual({
      changeOrigin: true,
      target: 'http://127.0.0.1:3000',
    });
    expect(proxy['/sent-invoice-groups']).toEqual({
      changeOrigin: true,
      target: 'http://127.0.0.1:3000',
    });
    expect(proxy['/invoice-numbering-series']).toEqual({
      changeOrigin: true,
      target: 'http://127.0.0.1:3000',
    });
  });

  it('defines every proxy path only once', () => {
    expect(new Set(developmentBackendProxyPaths).size).toBe(
      developmentBackendProxyPaths.length,
    );
  });
});
