import { isAbsolute, relative, resolve } from 'node:path';

export const maximumBackendRequestBodyBytes = 1_048_576;
export const localRuntimeSessionHeaderName = 'x-eky-local-session';

const resourceId = '[A-Za-z0-9_-]{1,100}';
const resourceIdPattern = new RegExp(`^${resourceId}$`);

export function isValidResourceId(value: unknown): value is string {
  return typeof value === 'string' && resourceIdPattern.test(value);
}

const backendRoutes: ReadonlyArray<{
  methods: ReadonlySet<string>;
  pathname: RegExp;
}> = [
  { methods: new Set(['GET']), pathname: /^\/health$/ },
  { methods: new Set(['GET']), pathname: /^\/activity$/ },
  { methods: new Set(['GET']), pathname: /^\/diagnostics\/events$/ },
  { methods: new Set(['GET']), pathname: /^\/diagnostics\/summary$/ },
  { methods: new Set(['GET', 'POST']), pathname: /^\/customers$/ },
  {
    methods: new Set(['GET', 'PUT']),
    pathname: new RegExp(`^/customers/${resourceId}$`),
  },
  {
    methods: new Set(['GET']),
    pathname: new RegExp(`^/customers/${resourceId}/activity$`),
  },
  { methods: new Set(['GET', 'PUT']), pathname: /^\/company-settings$/ },
  {
    methods: new Set(['DELETE', 'GET', 'PUT']),
    pathname: /^\/company-settings\/email-secret$/,
  },
  { methods: new Set(['GET', 'POST']), pathname: /^\/invoice-drafts$/ },
  {
    methods: new Set(['DELETE', 'GET', 'PUT']),
    pathname: new RegExp(`^/invoice-drafts/${resourceId}$`),
  },
  {
    methods: new Set(['POST']),
    pathname: new RegExp(`^/invoice-drafts/${resourceId}/approve$`),
  },
  {
    methods: new Set(['GET', 'PUT']),
    pathname: new RegExp(`^/invoice-drafts/${resourceId}/credit$`),
  },
  {
    methods: new Set(['POST']),
    pathname: new RegExp(`^/invoice-drafts/${resourceId}/approve-credit$`),
  },
  { methods: new Set(['GET']), pathname: /^\/invoices$/ },
  { methods: new Set(['GET']), pathname: /^\/sent-invoice-groups$/ },
  {
    methods: new Set(['GET']),
    pathname: new RegExp(`^/invoices/${resourceId}$`),
  },
  {
    methods: new Set(['GET']),
    pathname: new RegExp(`^/invoices/${resourceId}/credit-context$`),
  },
  {
    methods: new Set(['GET']),
    pathname: new RegExp(`^/invoices/${resourceId}/delivery-events$`),
  },
  {
    methods: new Set(['GET', 'POST']),
    pathname: new RegExp(`^/invoices/${resourceId}/pdf$`),
  },
  {
    methods: new Set(['GET']),
    pathname: new RegExp(`^/invoices/${resourceId}/pdf/metadata$`),
  },
  {
    methods: new Set(['POST']),
    pathname: new RegExp(
      `^/invoices/${resourceId}/(?:cancel|credit-draft|reopen-for-edit|mark-sent|copy-to-draft)$`,
    ),
  },
  {
    methods: new Set(['POST']),
    pathname: new RegExp(
      `^/invoices/${resourceId}/email/dry-run(?:/send)?$`,
    ),
  },
  {
    methods: new Set(['POST']),
    pathname: new RegExp(
      `^/invoices/${resourceId}/email/smtp-test/(?:prepare|send)$`,
    ),
  },
  {
    methods: new Set(['POST']),
    pathname: new RegExp(
      `^/invoices/${resourceId}/email/smtp/(?:prepare|send)$`,
    ),
  },
  {
    methods: new Set(['GET', 'PUT']),
    pathname: /^\/invoice-numbering-settings$/,
  },
  {
    methods: new Set(['GET', 'PUT']),
    pathname: /^\/invoice-payment-settings$/,
  },
  {
    methods: new Set(['GET', 'PUT']),
    pathname: /^\/invoice-vat-rates$/,
  },
];

export function isAllowedBackendRequest(method: string, pathname: string): boolean {
  if (pathname.length > 256 || pathname.includes('%')) {
    return false;
  }

  const normalizedMethod = method.toUpperCase();

  return backendRoutes.some(
    (route) =>
      route.methods.has(normalizedMethod) && route.pathname.test(pathname),
  );
}

export function createBackendRequestHeaders(
  source: Headers,
  runtimeSessionSecret: string,
): Headers {
  const headers = new Headers();

  for (const headerName of ['accept', 'content-type']) {
    const value = source.get(headerName);

    if (value !== null) {
      headers.set(headerName, value);
    }
  }

  headers.set(localRuntimeSessionHeaderName, runtimeSessionSecret);

  return headers;
}

export function createBackendResponseHeaders(source: Headers): Headers {
  const headers = new Headers();

  for (const headerName of ['content-disposition', 'content-length', 'content-type']) {
    const value = source.get(headerName);

    if (value !== null) {
      headers.set(headerName, value);
    }
  }

  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');

  return headers;
}

export function resolveStaticResourcePath(
  webRoot: string,
  pathname: string,
): string | undefined {
  let decodedPathname: string;

  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }

  const resourcePathname = decodedPathname === '/' ? '/index.html' : decodedPathname;

  if (
    resourcePathname.includes('\0') ||
    resourcePathname.includes('\\') ||
    !resourcePathname.startsWith('/')
  ) {
    return undefined;
  }

  const rootPath = resolve(webRoot);
  const resourcePath = resolve(rootPath, `.${resourcePathname}`);
  const relativePath = relative(rootPath, resourcePath);

  if (
    relativePath === '' ||
    relativePath.startsWith('..') ||
    isAbsolute(relativePath)
  ) {
    return undefined;
  }

  return resourcePath;
}

export function getStaticContentType(filePath: string): string {
  const extension = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();

  return (
    {
      '.css': 'text/css; charset=utf-8',
      '.html': 'text/html; charset=utf-8',
      '.ico': 'image/x-icon',
      '.js': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
      '.woff2': 'font/woff2',
    }[extension] ?? 'application/octet-stream'
  );
}
