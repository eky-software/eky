import { createBackendRequestHeaders } from './protocolPolicy.js';

interface RuntimeSessionAcceptanceValidationInput {
  backendOrigin: string;
  createRuntimeSession(): string;
  fetchImplementation(
    input: string,
    init: RequestInit,
  ): Promise<Response>;
  runtimeSessionSecret: string;
}

export async function assertDifferentRuntimeSessionRejected(
  input: RuntimeSessionAcceptanceValidationInput,
): Promise<void> {
  let rejectedSession = input.createRuntimeSession();
  for (
    let attempt = 0;
    attempt < 2 && rejectedSession === input.runtimeSessionSecret;
    attempt += 1
  ) {
    rejectedSession = input.createRuntimeSession();
  }
  if (rejectedSession === input.runtimeSessionSecret) {
    throw new Error('FIRST_START_SESSION_VALIDATION_FAILED');
  }

  const response = await input.fetchImplementation(
    `${input.backendOrigin}/customers`,
    {
      headers: createBackendRequestHeaders(
        new Headers(),
        rejectedSession,
      ),
      method: 'GET',
    },
  );
  await response.body?.cancel().catch(() => undefined);
  if (response.status !== 401) {
    throw new Error('FIRST_START_SESSION_VALIDATION_FAILED');
  }
}
