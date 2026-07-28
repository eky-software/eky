import { rmSync } from 'node:fs';

import { request as requestFactory } from '@playwright/test';

import { expectSafeHttpError } from '../../src/assertions/expectSafeHttpError.js';
import { createE2eRunRoot } from '../../src/environment/createE2eRunRoot.js';
import { createE2eWorkerPaths } from '../../src/environment/createE2eWorkerPaths.js';
import { reserveLoopbackPort } from '../../src/environment/reserveLoopbackPort.js';
import { startE2eBackendProcess } from '../../src/environment/startE2eBackendProcess.js';
import { expect, test } from '../../src/fixtures/isolatedBackendTest.js';

test('SEC-SESSION-001 @critical @security rejects missing, wrong and another runtime session', async ({
  e2eBackend,
}) => {
  const missingResponse = await e2eBackend.anonymousApi.get('/customers');
  await expectSafeHttpError(missingResponse, [401], [
    e2eBackend.backend.sessionSecret,
  ]);

  const wrongResponse = await e2eBackend.anonymousApi.get('/customers', {
    headers: { 'x-eky-local-session': 'x'.repeat(43) },
  });
  await expectSafeHttpError(wrongResponse, [401], [
    e2eBackend.backend.sessionSecret,
  ]);

  const otherRunRoot = createE2eRunRoot();
  const otherPaths = createE2eWorkerPaths(
    otherRunRoot,
    'SEC-SESSION-OTHER-001',
  );
  const otherBackend = await startE2eBackendProcess({
    backendPort: await reserveLoopbackPort(),
    paths: otherPaths,
    runRoot: otherRunRoot,
    scenarioId: 'SEC-SESSION-OTHER-001',
  });
  const otherRuntimeApi = await requestFactory.newContext({
    baseURL: e2eBackend.backend.backendOrigin,
    extraHTTPHeaders: {
      Accept: 'application/json',
      'x-eky-local-session': otherBackend.sessionSecret,
    },
  });

  try {
    const otherRuntimeResponse = await otherRuntimeApi.get('/customers');
    await expectSafeHttpError(otherRuntimeResponse, [401], [
      e2eBackend.backend.sessionSecret,
      otherBackend.sessionSecret,
    ]);
  } finally {
    await otherRuntimeApi.dispose();
    await otherBackend.stop();
    rmSync(otherRunRoot, { force: true, recursive: true });
  }

  const authenticatedResponse = await e2eBackend.api.get('/customers');
  expect(authenticatedResponse.status()).toBe(200);
  await expect(authenticatedResponse.json()).resolves.toEqual({
    customers: [],
  });
  const healthResponse = await e2eBackend.anonymousApi.get('/health');
  expect(healthResponse.status()).toBe(200);
});
