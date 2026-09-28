import { request as requestFactory, type APIRequestContext } from '@playwright/test';

import { expectSafeHttpError } from '../../src/assertions/expectSafeHttpError.js';
import { createE2eRunRoot } from '../../src/environment/createE2eRunRoot.js';
import { createE2eWorkerPaths } from '../../src/environment/createE2eWorkerPaths.js';
import { reserveLoopbackPort } from '../../src/environment/reserveLoopbackPort.js';
import { removeE2eRunRoot } from '../../src/environment/removeE2eRunRoot.js';
import {
  E2eBackendStartupFailure, startE2eBackendProcess, type StartedE2eBackend,
} from '../../src/environment/startE2eBackendProcess.js';
import { waitForLoopbackPortRelease } from '../../src/environment/waitForLoopbackPortRelease.js';
import { finishServiceFixture } from '../../src/fixtures/finishServiceFixture.js';
import { expect, test } from '../../src/fixtures/isolatedBackendTest.js';

test('SEC-SESSION-001 @critical @security rejects missing, wrong and another runtime session', async ({
  e2eBackend,
}, testInfo) => {
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
  let otherBackend: StartedE2eBackend | undefined;
  let otherRuntimeApi: APIRequestContext | undefined;
  let otherPort: number | undefined;
  let failure: { error: unknown } | undefined;
  let priorCleanupUnverified = false;

  try {
    const otherPaths = createE2eWorkerPaths(otherRunRoot, 'SEC-SESSION-OTHER-001');
    otherPort = await reserveLoopbackPort();
    try {
      otherBackend = await startE2eBackendProcess({
        backendPort: otherPort,
        lifetime: e2eBackend.lifetime,
        paths: otherPaths,
        runRoot: otherRunRoot,
        scenarioId: 'SEC-SESSION-OTHER-001',
      });
    } catch (error) {
      priorCleanupUnverified = !(error instanceof E2eBackendStartupFailure &&
        error.evidence.cleanup.processTree === 'stopped' && error.evidence.cleanup.port === 'released');
      throw error;
    }
    otherRuntimeApi = await requestFactory.newContext({
      baseURL: e2eBackend.backend.backendOrigin,
      extraHTTPHeaders: {
        Accept: 'application/json',
        'x-eky-local-session': otherBackend.sessionSecret,
      },
    });
    const otherRuntimeResponse = await otherRuntimeApi.get('/customers');
    await expectSafeHttpError(otherRuntimeResponse, [401], [
      e2eBackend.backend.sessionSecret,
      otherBackend.sessionSecret,
    ]);
  } catch (error) {
    failure = { error };
  } finally {
    await finishServiceFixture({
      failure, priorCleanupUnverified,
      testAlreadyFailed: testInfo.status !== testInfo.expectedStatus,
      disposeApi: async () => { await otherRuntimeApi?.dispose(); },
      ...(otherBackend === undefined ? {} : { stopBackend: () => otherBackend!.stop() }),
      ...(otherPort === undefined ? {} : {
        releaseBackendPort: () => waitForLoopbackPortRelease(otherPort!),
      }),
      collectArtifacts: async () => {},
      removeRoot: () => removeE2eRunRoot(otherRunRoot),
      report: async result => {
        if (failure !== undefined || testInfo.status !== testInfo.expectedStatus || result.runRoot !== 'removed') {
          await testInfo.attach('other-runtime-cleanup', {
            body: JSON.stringify({ schemaVersion: 1, cleanup: result }), contentType: 'application/json',
          });
        }
      },
    });
  }

  const authenticatedResponse = await e2eBackend.api.get('/customers');
  expect(authenticatedResponse.status()).toBe(200);
  await expect(authenticatedResponse.json()).resolves.toEqual({
    customers: [],
  });
  const healthResponse = await e2eBackend.anonymousApi.get('/health');
  expect(healthResponse.status()).toBe(200);
});
