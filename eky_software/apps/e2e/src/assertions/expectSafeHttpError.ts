import { expect, type APIResponse } from '@playwright/test';

const forbiddenErrorFragments = [
  'SQLITE_',
  'SELECT ',
  'INSERT ',
  'UPDATE ',
  'DELETE FROM',
  'node_modules',
  'file://',
  'runtime-config',
  'x-eky-local-session',
  'company-email-smtp',
] as const;

export async function expectSafeHttpError(
  response: APIResponse,
  expectedStatuses: readonly number[],
  additionalForbiddenFragments: readonly string[] = [],
): Promise<{ error: string }> {
  expect(expectedStatuses).toContain(response.status());

  const responseText = await response.text();
  let responseBody: unknown;
  expect(() => {
    responseBody = JSON.parse(responseText);
  }).not.toThrow();
  expect(responseBody).toEqual({
    error: expect.any(String),
  });

  const lowerCaseResponse = responseText.toLowerCase();
  for (const fragment of [
    ...forbiddenErrorFragments,
    ...additionalForbiddenFragments,
  ]) {
    expect(lowerCaseResponse).not.toContain(fragment.toLowerCase());
  }

  return responseBody as { error: string };
}
