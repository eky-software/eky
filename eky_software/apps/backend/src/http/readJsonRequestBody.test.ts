import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import {
  readJsonRequestBody,
  type JsonRequestBodyRequirement,
} from './readJsonRequestBody.js';

function createTestApp(): Hono {
  const app = new Hono();

  app.post('/:requirement', async (context) => {
    const result = await readJsonRequestBody(
      context.req,
      context.req.param('requirement') as JsonRequestBodyRequirement,
    );

    if (!result.ok) {
      return context.json(
        {
          code: result.code,
          error: result.message,
        },
        result.status,
      );
    }

    return context.json({ body: result.body ?? null });
  });

  return app;
}

describe('readJsonRequestBody', () => {
  it.each([
    'application/json',
    'application/json; charset=utf-8',
    'APPLICATION/JSON; CHARSET=UTF-8',
  ])('accepts the JSON media type %s without changing the body', async (mediaType) => {
    const response = await createTestApp().request('/required', {
      body: '{"value":"safe"}',
      headers: { 'Content-Type': mediaType },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      body: { value: 'safe' },
    });
  });

  it.each([
    'text/plain',
    'application/x-www-form-urlencoded',
    'multipart/form-data; boundary=example',
  ])('rejects the unsupported media type %s', async (mediaType) => {
    const response = await createTestApp().request('/required', {
      body: '{"secret":"must-not-be-echoed"}',
      headers: { 'Content-Type': mediaType },
      method: 'POST',
    });

    expect(response.status).toBe(415);
    const responseText = await response.text();
    expect(responseText).toContain('Content-Type must be application/json.');
    expect(responseText).not.toContain(mediaType);
    expect(responseText).not.toContain('must-not-be-echoed');
  });

  it('rejects a non-empty body without a Content-Type header', async () => {
    const request = new Request('http://localhost/required', {
      body: '{"value":1}',
      method: 'POST',
    });
    const response = await createTestApp().request(request);

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toEqual({
      code: 'unsupportedMediaType',
      error: 'Content-Type must be application/json.',
    });
  });

  it('separates invalid JSON from an unsupported media type', async () => {
    const response = await createTestApp().request('/required', {
      body: '{',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: 'invalidJson',
      error: 'Invalid JSON body.',
    });
  });

  it('requires a body only in required mode', async () => {
    const requiredResponse = await createTestApp().request('/required', {
      method: 'POST',
    });
    const optionalResponse = await createTestApp().request('/optional', {
      method: 'POST',
    });

    expect(requiredResponse.status).toBe(400);
    await expect(requiredResponse.json()).resolves.toEqual({
      code: 'requiredBodyMissing',
      error: 'JSON body is required.',
    });
    expect(optionalResponse.status).toBe(200);
    await expect(optionalResponse.json()).resolves.toEqual({ body: null });
  });

  it('rejects any non-empty body in forbidden mode', async () => {
    const response = await createTestApp().request('/forbidden', {
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: 'bodyForbidden',
      error: 'Request body is not allowed.',
    });
  });
});
