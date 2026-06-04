export interface EkyApiClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
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

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

export async function requestJson(
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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
