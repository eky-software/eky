import { describe, expect, it } from 'vitest';

import { EkyApiError, requestJson } from './http.js';

describe('API client HTTP error handling', () => {
  it('preserves the safe message, status and response body from a failed response', async () => {
    const responseBody = {
      error: 'The request conflicts with existing data.',
      reference: 'safe-reference',
    };

    await expect(
      requestJson(
        async () => jsonResponse(responseBody, { status: 409 }),
        '',
        '/test',
      ),
    ).rejects.toMatchObject({
      message: 'The request conflicts with existing data.',
      name: 'EkyApiError',
      responseBody,
      status: 409,
    });
  });

  it('uses a generic message when the failed response has no safe error string', async () => {
    const responseBody = {
      error: {
        code: 'internal_detail',
      },
    };

    await expect(
      requestJson(
        async () => jsonResponse(responseBody, { status: 500 }),
        '',
        '/test',
      ),
    ).rejects.toMatchObject({
      message: 'API request failed.',
      name: 'EkyApiError',
      responseBody,
      status: 500,
    });
  });

  it('handles invalid JSON in a successful response as a controlled API error', async () => {
    await expect(
      requestJson(
        async () => new Response('not-json', { status: 200 }),
        '',
        '/test',
      ),
    ).rejects.toMatchObject({
      message: 'Invalid JSON response.',
      name: 'EkyApiError',
      responseBody: undefined,
      status: 200,
    });
  });

  it('handles invalid JSON in a failed response without exposing the raw body', async () => {
    await expect(
      requestJson(
        async () => new Response('internal failure details', { status: 502 }),
        '',
        '/test',
      ),
    ).rejects.toMatchObject({
      message: 'Invalid JSON response.',
      name: 'EkyApiError',
      responseBody: undefined,
      status: 502,
    });
  });

  it('keeps optional error metadata undefined when it is not provided', () => {
    const error = new EkyApiError('Invalid response.');

    expect(error).toMatchObject({
      message: 'Invalid response.',
      name: 'EkyApiError',
      responseBody: undefined,
      status: undefined,
    });
  });
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}
