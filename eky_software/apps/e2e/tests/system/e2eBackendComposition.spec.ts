import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { readE2eBackendConfig } from '../../../backend/e2e/e2eBackendConfig.js';
import { E2eFakeSmtpProvider } from '../../../backend/e2e/e2eFakeSmtpProvider.js';
import { createE2eInvoiceDocumentStorage } from '../../../backend/e2e/e2eInvoiceDocumentStorage.js';
import { InvoiceDocumentIntegrityError } from '../../../backend/src/modules/invoicing/application/invoiceDocumentIntegrityError.js';
import {
  InvoiceSmtpDeliveryError,
  type InvoiceSmtpEmailInput,
} from '../../../backend/src/modules/invoicing/ports/invoiceSmtpDeliveryProvider.js';
import { createE2eRunRoot } from '../../src/environment/createE2eRunRoot.js';
import { createE2eWorkerPaths } from '../../src/environment/createE2eWorkerPaths.js';
import { createE2eFixtureLifetime } from '../../src/environment/e2eFixtureLifetime.js';
import { removeE2eRunRoot } from '../../src/environment/removeE2eRunRoot.js';
import { reserveLoopbackPort } from '../../src/environment/reserveLoopbackPort.js';
import { E2eBackendStartupFailure, startE2eBackendProcess } from '../../src/environment/startE2eBackendProcess.js';
import { waitForLoopbackPortRelease } from '../../src/environment/waitForLoopbackPortRelease.js';
import { writeE2eBackendConfig } from '../../src/environment/writeE2eBackendConfig.js';
import { finishServiceFixture } from '../../src/fixtures/finishServiceFixture.js';

test.describe('isolated E2E backend composition', () => {
  test('boots the real backend with an isolated database and local session', async ({}, testInfo) => {
    const lifetime = createE2eFixtureLifetime(testInfo.timeout);
    const runRoot = createE2eRunRoot();
    const paths = createE2eWorkerPaths(runRoot, 'SYS-BOOT-001');
    const backendPort = await reserveLoopbackPort();
    let backend: Awaited<ReturnType<typeof startE2eBackendProcess>> | undefined;
    let failure: { error: unknown } | undefined;

    try {
      backend = await startE2eBackendProcess({
        backendPort,
        lifetime,
        paths,
        runRoot,
        scenarioId: 'SYS-BOOT-001',
      });
      const healthResponse = await fetch(`${backend.backendOrigin}/health`);
      expect(healthResponse.status).toBe(200);
      await expect(healthResponse.json()).resolves.toEqual({ status: 'ok' });

      const missingSessionResponse = await fetch(
        `${backend.backendOrigin}/customers`,
      );
      expect(missingSessionResponse.status).toBe(401);
      await expect(missingSessionResponse.json()).resolves.toEqual({
        error: 'Authentication required.',
      });

      const wrongSessionResponse = await fetch(
        `${backend.backendOrigin}/customers`,
        { headers: { 'x-eky-local-session': 'x'.repeat(43) } },
      );
      expect(wrongSessionResponse.status).toBe(401);

      const authenticatedResponse = await fetch(
        `${backend.backendOrigin}/customers`,
        {
          headers: {
            'x-eky-local-session': backend.sessionSecret,
          },
        },
      );
      expect(authenticatedResponse.status).toBe(200);
      await expect(authenticatedResponse.json()).resolves.toEqual({
        customers: [],
      });
      expect(existsSync(paths.databaseFilePath)).toBe(true);
      expect(await backend.workload.readState()).toBe('running');
      expect(backend.workload.instanceId).toMatch(/^[a-f0-9-]{36}$/u);
      expect(await backend.workload.readRssBytes()).toBeGreaterThan(0);
      expect(backend.managedProcess.readStdout()).not.toContain(
        backend.sessionSecret,
      );
      expect(backend.managedProcess.readStderr()).not.toContain(
        backend.sessionSecret,
      );
    } catch (error) {
      failure = { error };
    } finally {
      const verifiedStartupCleanup = failure?.error instanceof E2eBackendStartupFailure &&
        failure.error.evidence.cleanup.processTree === 'stopped' &&
        failure.error.evidence.cleanup.port === 'released';
      await finishServiceFixture({
        failure,
        priorCleanupUnverified: backend === undefined && !verifiedStartupCleanup,
        testAlreadyFailed: testInfo.status !== testInfo.expectedStatus,
        disposeApi: async () => {},
        ...(backend === undefined ? {} : { stopBackend: async () => {
          await backend!.stop();
          expect(await backend!.workload.readState()).toBe('exited');
          await expect(backend!.workload.readRssBytes()).rejects.toThrow('E2E_BACKEND_RSS_UNAVAILABLE');
        } }),
        releaseBackendPort: () => waitForLoopbackPortRelease(backendPort),
        collectArtifacts: async () => {},
        removeRoot: () => removeE2eRunRoot(runRoot),
        report: async cleanup => {
          if (failure !== undefined || cleanup.runRoot !== 'removed') {
            await testInfo.attach('backend-composition-cleanup', {
              body: JSON.stringify({ schemaVersion: 1, cleanup }), contentType: 'application/json',
            });
          }
        },
      });
    }
  });

  test('validates the config identity, fields and fake SMTP boundary', async () => {
    const runRoot = createE2eRunRoot();
    try {
      const paths = createE2eWorkerPaths(runRoot, 'SYS-CONFIG-001');
      const config = writeE2eBackendConfig({
        backendPort: await reserveLoopbackPort(),
        paths,
        scenarioId: 'SYS-CONFIG-001',
      });

      expect(
        readE2eBackendConfig(paths.runtimeConfigPath, { EKY_E2E: '1' }),
      ).toEqual(config);
      expect(() =>
        readE2eBackendConfig(paths.runtimeConfigPath, {}),
      ).toThrow('marker');

      writeFileSync(
        paths.runtimeConfigPath,
        JSON.stringify({ ...config, smtpAdapter: 'smtp' }),
        'utf8',
      );
      expect(() =>
        readE2eBackendConfig(paths.runtimeConfigPath, { EKY_E2E: '1' }),
      ).toThrow('fake SMTP');

      writeFileSync(
        paths.runtimeConfigPath,
        JSON.stringify({ ...config, unexpectedControl: true }),
        'utf8',
      );
      expect(() =>
        readE2eBackendConfig(paths.runtimeConfigPath, { EKY_E2E: '1' }),
      ).toThrow('unknown or missing');
    } finally {
      rmSync(runRoot, { force: true, recursive: true });
    }
  });

  test('accepts only the closed deterministic fault plan variants', async () => {
    const runRoot = createE2eRunRoot();
    try {
      const paths = createE2eWorkerPaths(runRoot, 'SYS-FAULT-PLAN-001');
      const acceptedFaults = [
        { kind: 'none' },
        { kind: 'smtp', outcome: 'connectionFailed' },
        { kind: 'smtp', outcome: 'tlsFailed' },
        { kind: 'smtp', outcome: 'authenticationFailed' },
        { kind: 'smtp', outcome: 'deliveryFailed' },
        { kind: 'smtp', outcome: 'outcomeUnknown' },
        { kind: 'pdfStorageWriteFailed' },
        { kind: 'operationalLogWriteFailed' },
        {
          failOnCall: 1,
          kind: 'databaseWriteFailed',
          operation: 'activateInvoiceNumberingSeriesEvent',
        },
        {
          failOnCall: 1,
          kind: 'databaseWriteFailed',
          operation: 'activateInvoiceNumberingSeriesPointer',
        },
        {
          failOnCall: 1,
          kind: 'databaseWriteFailed',
          operation: 'activateInvoiceNumberingSeriesSettings',
        },
        {
          failOnCall: 2,
          kind: 'databaseWriteFailed',
          operation: 'approveInvoice',
        },
        {
          failOnCall: 1,
          kind: 'databaseWriteFailed',
          operation: 'markInvoicePaidEvent',
        },
        {
          failOnCall: 1,
          kind: 'databaseWriteFailed',
          operation: 'updateCustomer',
        },
        {
          failOnCall: 3,
          kind: 'databaseWriteFailed',
          operation: 'updateCompanySettings',
        },
      ] as const;

      for (const faultPlan of acceptedFaults) {
        writeE2eBackendConfig({
          backendPort: await reserveLoopbackPort(),
          faultPlan,
          paths,
          scenarioId: 'SYS-FAULT-PLAN-001',
        });
        expect(
          readE2eBackendConfig(paths.runtimeConfigPath, { EKY_E2E: '1' })
            .faultPlan,
        ).toEqual(faultPlan);
      }

      const config = JSON.parse(
        readFileSync(paths.runtimeConfigPath, 'utf8'),
      ) as Record<string, unknown>;
      config.faultPlan = {
        callback: 'arbitrary-code',
        kind: 'databaseWriteFailed',
        operation: 'approveInvoice',
      };
      writeFileSync(paths.runtimeConfigPath, JSON.stringify(config), 'utf8');
      expect(() =>
        readE2eBackendConfig(paths.runtimeConfigPath, { EKY_E2E: '1' }),
      ).toThrow('unknown or missing');
    } finally {
      rmSync(runRoot, { force: true, recursive: true });
    }
  });

  test('fake SMTP returns deterministic success and failure outcomes', async () => {
    const successfulProvider = new E2eFakeSmtpProvider(
      { kind: 'none' },
      fakeSmtpOperationalOptions,
    );
    await expect(successfulProvider.sendEmail(createSmtpInput())).resolves.toEqual(
      expect.objectContaining({
        deliveredTo: 'recipient@example.invalid',
        provider: 'smtp',
        testMode: false,
      }),
    );

    for (const fault of [
      ['connectionFailed', 'E2E_SMTP_CONNECTION_FAILED', 'failed'],
      ['tlsFailed', 'E2E_SMTP_TLS_FAILED', 'failed'],
      ['authenticationFailed', 'E2E_SMTP_AUTHENTICATION_FAILED', 'failed'],
      ['deliveryFailed', 'E2E_SMTP_DELIVERY_FAILED', 'failed'],
      ['outcomeUnknown', 'E2E_SMTP_OUTCOME_UNKNOWN', 'outcomeUnknown'],
    ] as const) {
      const provider = new E2eFakeSmtpProvider(
        {
          kind: 'smtp',
          outcome: fault[0],
        },
        fakeSmtpOperationalOptions,
      );
      const error = await provider
        .sendEmail(createSmtpInput())
        .then(() => null)
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(InvoiceSmtpDeliveryError);
      expect(error).toMatchObject({
        outcome: fault[2],
        technicalErrorCode: fault[1],
      });
    }
  });

  test('PDF storage fault rejects writes without escaping its root', async () => {
    const runRoot = createE2eRunRoot();
    try {
      const paths = createE2eWorkerPaths(runRoot, 'SYS-PDF-FAULT-001');
      const scope = { companyId: 'dev-company', invoiceId: 'synthetic-invoice' };
      const content = Buffer.from('%PDF-1.7\n% Synthetic E2E document\n%%EOF\n');
      const expectedContent = Buffer.from(content);
      const candidate = await createE2eInvoiceDocumentStorage(
        paths.documentsRoot,
        { kind: 'none' },
      ).writeCandidate({ scope, documentId: 'existing-document', content });
      content.fill(0);
      const storedPaths = readdirSync(paths.documentsRoot, { recursive: true }).sort();
      const storage = createE2eInvoiceDocumentStorage(
        paths.documentsRoot,
        { kind: 'pdfStorageWriteFailed' },
      );
      await expect(
        storage.writeCandidate({
          scope,
          documentId: 'failed-document',
          content: expectedContent,
        }),
      ).rejects.toThrow('E2E PDF storage write failed');
      expect(readdirSync(paths.documentsRoot, { recursive: true }).sort()).toEqual(
        storedPaths,
      );
      expect(Buffer.from(await storage.readVerifiedDocument(candidate))).toEqual(
        expectedContent,
      );
      await expect(
        storage.readVerifiedDocument({ ...candidate, sha256: '0'.repeat(64) }),
      ).rejects.toBeInstanceOf(InvoiceDocumentIntegrityError);
      await expect(
        storage.readVerifiedDocument({ ...candidate, sizeBytes: candidate.sizeBytes + 1 }),
      ).rejects.toBeInstanceOf(InvoiceDocumentIntegrityError);
      await candidate.discard();
      expect(existsSync(join(paths.documentsRoot, candidate.storagePath))).toBe(false);
    } finally {
      rmSync(runRoot, { force: true, recursive: true });
    }
  });
});

const fakeSmtpOperationalOptions = {
  operationalIdentity: {
    appVersion: '0.0.0-e2e',
    buildRevision: 'development',
    runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
  },
  operationalLogger: {
    write() {},
  },
};

function createSmtpInput(): InvoiceSmtpEmailInput {
  return {
    attemptId: 'synthetic-attempt',
    body: 'Synthetic body',
    cc: '',
    companyId: 'dev-company',
    emailDeliveryProvider: 'dnaSmtp',
    emailSenderAddress: 'sender@example.invalid',
    emailSenderName: 'Synthetic Sender',
    emailTestRecipientOverride: 'test@example.invalid',
    emailUsername: 'sender@example.invalid',
    pdfContent: new Uint8Array([1, 2, 3]),
    pdfFileName: 'synthetic.pdf',
    subject: 'Synthetic subject',
    to: 'recipient@example.invalid',
  };
}
