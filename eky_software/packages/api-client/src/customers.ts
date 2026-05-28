export interface Customer {
  id: string;
  companyId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCustomerRequest {
  name: string;
}

export interface EkyApiClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
}

export interface EkyApiClient {
  createCustomer(input: CreateCustomerRequest): Promise<Customer>;
  listCustomers(): Promise<Customer[]>;
}

export class EkyApiError extends Error {
  readonly responseBody: unknown | undefined;
  readonly status: number | undefined;

  constructor(message: string, options: { responseBody?: unknown; status?: number } = {}) {
    super(message);
    this.name = 'EkyApiError';
    this.responseBody = options.responseBody;
    this.status = options.status;
  }
}

export function createEkyApiClient(options: EkyApiClientOptions): EkyApiClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetchImplementation = options.fetch ?? fetch;

  return {
    async createCustomer(input): Promise<Customer> {
      const responseBody = await requestJson(fetchImplementation, baseUrl, '/customers', {
        body: JSON.stringify(input),
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'POST',
      });

      if (!isRecord(responseBody)) {
        throw new EkyApiError('Invalid customer response.', { responseBody });
      }

      return parseCustomer(responseBody.customer);
    },

    async listCustomers(): Promise<Customer[]> {
      const responseBody = await requestJson(fetchImplementation, baseUrl, '/customers');

      if (!isRecord(responseBody) || !Array.isArray(responseBody.customers)) {
        throw new EkyApiError('Invalid customers response.', { responseBody });
      }

      return responseBody.customers.map(parseCustomer);
    },
  };
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

async function requestJson(
  fetchImplementation: typeof fetch,
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const response = await fetchImplementation(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...init?.headers,
    },
  });
  const responseBody = await readJsonResponse(response);

  if (!response.ok) {
    throw new EkyApiError(getErrorMessage(responseBody), {
      responseBody,
      status: response.status,
    });
  }

  return responseBody;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new EkyApiError('Invalid JSON response.', { status: response.status });
  }
}

function getErrorMessage(responseBody: unknown): string {
  if (isRecord(responseBody) && typeof responseBody.error === 'string') {
    return responseBody.error;
  }

  return 'API request failed.';
}

function parseCustomer(value: unknown): Customer {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.companyId !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    throw new EkyApiError('Invalid customer response.', { responseBody: value });
  }

  return {
    id: value.id,
    companyId: value.companyId,
    name: value.name,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
