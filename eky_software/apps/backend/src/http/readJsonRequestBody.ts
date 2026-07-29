import type { HonoRequest } from 'hono';

export type JsonRequestBodyRequirement =
  | 'forbidden'
  | 'optional'
  | 'required';

export type JsonRequestBodyErrorCode =
  | 'bodyForbidden'
  | 'invalidJson'
  | 'requiredBodyMissing'
  | 'unsupportedMediaType';

export type JsonRequestBodyResult =
  | {
      body: unknown;
      ok: true;
    }
  | {
      code: JsonRequestBodyErrorCode;
      message: string;
      ok: false;
      status: 400 | 415;
    };

const jsonMediaType = 'application/json';

export async function readJsonRequestBody(
  request: HonoRequest,
  requirement: JsonRequestBodyRequirement,
): Promise<JsonRequestBodyResult> {
  const requestText = await request.text();

  if (requestText.length === 0) {
    if (requirement === 'required') {
      return {
        code: 'requiredBodyMissing',
        message: 'JSON body is required.',
        ok: false,
        status: 400,
      };
    }

    return { body: undefined, ok: true };
  }

  if (requirement === 'forbidden') {
    return {
      code: 'bodyForbidden',
      message: 'Request body is not allowed.',
      ok: false,
      status: 400,
    };
  }

  if (readMediaType(request.header('Content-Type')) !== jsonMediaType) {
    return {
      code: 'unsupportedMediaType',
      message: 'Content-Type must be application/json.',
      ok: false,
      status: 415,
    };
  }

  try {
    return { body: JSON.parse(requestText) as unknown, ok: true };
  } catch {
    return {
      code: 'invalidJson',
      message: 'Invalid JSON body.',
      ok: false,
      status: 400,
    };
  }
}

function readMediaType(contentType: string | undefined): string | undefined {
  return contentType?.split(';', 1)[0]?.trim().toLowerCase();
}
