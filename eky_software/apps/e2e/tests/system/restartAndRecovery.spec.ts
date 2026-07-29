import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { createBackendOperationalEvent } from '../../../backend/src/observability/createOperationalEvent.js';
import { readE2eSqliteRows } from '../../src/assertions/readE2eSqliteRows.js';
import { createSyntheticCustomerInput } from '../../src/data/syntheticBusinessInputs.js';
import { waitForLoopbackPortRelease } from '../../src/environment/waitForLoopbackPortRelease.js';
import {
  expect,
  test,
} from '../../src/fixtures/isolatedBackendTest.js';

test('SYS-RESTART-001 @critical @recovery preserves data and audit while rotating runtime trust', async ({
  e2eBackend,
}) => {
  const oldApi = e2eBackend.api;
  const oldBackend = e2eBackend.backend;
  const oldSessionSecret = oldBackend.sessionSecret;
  const oldSummary = await readRuntimeSummary(oldApi);

  const createResponse = await oldApi.post('/customers', {
    data: createSyntheticCustomerInput({
      customerNumber: 'E2E-RESTART-1001',
      name: 'Synthetic Restart Customer Oy',
    }),
  });
  expect(createResponse.status()).toBe(201);
  const customerId = String(
    ((await createResponse.json()) as { customer: { id: string } }).customer.id,
  );

  const restarted = await e2eBackend.restartBackend();
  expect(restarted.backend.sessionSecret).not.toBe(oldSessionSecret);
  expect(await isManagedProcessExited(oldBackend)).toBe(true);

  const oldSessionResponse = await oldApi.get('/customers');
  expect([401, 403]).toContain(oldSessionResponse.status());

  const listResponse = await restarted.api.get('/customers');
  expect(listResponse.status()).toBe(200);
  expect(await listResponse.json()).toEqual({
    customers: [
      expect.objectContaining({
        id: customerId,
        name: 'Synthetic Restart Customer Oy',
      }),
    ],
  });

  const activityResponse = await restarted.api.get(
    '/activity?category=customers&pageSize=20',
  );
  expect(activityResponse.status()).toBe(200);
  expect(JSON.stringify(await activityResponse.json())).toContain(
    'customer.created',
  );

  const newSummary = await readRuntimeSummary(restarted.api);
  expect(newSummary.runtimeInstanceId).not.toBe(oldSummary.runtimeInstanceId);
  expect(
    readE2eSqliteRows(
      e2eBackend.paths.databaseFilePath,
      'SELECT COUNT(*) AS count FROM customer_audit_events',
    ),
  ).toEqual([{ count: 1 }]);
});

test('OBS-JSONL-001 @critical @fault @recovery ignores a truncated final JSONL row and reports the source honestly', async ({
  e2eBackend,
}) => {
  const timestamp = new Date().toISOString();
  const event = createBackendOperationalEvent(
    {
      errorCode: 'E2E_SYNTHETIC_LOG_FAILURE',
      eventName: 'http.requestFailed',
      retryable: true,
      sideEffectState: 'none',
      stage: 'e2eRecovery',
    },
    {
      appVersion: '0.0.0-e2e',
      buildRevision: 'development',
      eventId: '11111111-2222-4333-8444-555555555555',
      runtimeInstanceId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      timestamp,
    },
  );
  const backendLogsRoot = join(e2eBackend.paths.logsRoot, 'backend');
  mkdirSync(backendLogsRoot, { mode: 0o700, recursive: true });
  const logPath = join(
    backendLogsRoot,
    `backend-warning-error-${timestamp.slice(0, 7)}-001.jsonl`,
  );
  appendFileSync(
    logPath,
    `${JSON.stringify(event)}\n{"eventName":"truncated`,
    { encoding: 'utf8', mode: 0o600 },
  );

  const diagnosticsResponse = await e2eBackend.api.get(
    '/diagnostics/events?limit=200',
  );
  expect(diagnosticsResponse.status()).toBe(200);
  const diagnosticsText = await diagnosticsResponse.text();
  expect(diagnosticsText).toContain('E2E_SYNTHETIC_LOG_FAILURE');
  expect(diagnosticsText).not.toContain('truncated');

  const supportResponse = await e2eBackend.api.get(
    '/diagnostics/support-bundle-data',
  );
  expect(supportResponse.status()).toBe(200);
  const supportBody = (await supportResponse.json()) as {
    diagnosticEvents: Array<{ errorCode: string | null }>;
    truncated: boolean;
  };
  expect(supportBody.diagnosticEvents).toEqual([
    expect.objectContaining({
      errorCode: 'E2E_SYNTHETIC_LOG_FAILURE',
    }),
  ]);
  expect(supportBody.truncated).toBe(true);
  expect((await e2eBackend.api.get('/health')).status()).toBe(200);
});

test('DB-LOCK-001 @critical @fault @recovery returns a safe error under an exclusive SQLite lock and recovers', async ({
  e2eBackend,
}) => {
  const createResponse = await e2eBackend.api.post('/customers', {
    data: createSyntheticCustomerInput({
      customerNumber: 'E2E-LOCK-1001',
      name: 'Synthetic Lock Customer Oy',
    }),
  });
  expect(createResponse.status()).toBe(201);
  const customerId = String(
    ((await createResponse.json()) as { customer: { id: string } }).customer.id,
  );

  const lock = new DatabaseSync(e2eBackend.paths.databaseFilePath);
  try {
    lock.exec('PRAGMA locking_mode = EXCLUSIVE');
    lock.exec('BEGIN EXCLUSIVE');

    const lockedResponse = await e2eBackend.api.put(
      `/customers/${customerId}`,
      {
        data: createSyntheticCustomerInput({
          customerNumber: 'E2E-LOCK-1001',
          name: 'Blocked Synthetic Update Oy',
        }),
        timeout: 10_000,
      },
    );
    expect(lockedResponse.status()).toBe(500);
    const safeError = await lockedResponse.text();
    expect(safeError).not.toContain('SQLITE');
    expect(safeError).not.toContain(e2eBackend.paths.databaseFilePath);
  } finally {
    if (lock.isTransaction) {
      lock.exec('ROLLBACK');
    }
    lock.close();
  }

  const recoveredResponse = await e2eBackend.api.put(
    `/customers/${customerId}`,
    {
      data: createSyntheticCustomerInput({
        customerNumber: 'E2E-LOCK-1001',
        name: 'Recovered Synthetic Customer Oy',
      }),
    },
  );
  expect(recoveredResponse.status()).toBe(200);
  expect(await recoveredResponse.json()).toEqual({
    customer: expect.objectContaining({
      id: customerId,
      name: 'Recovered Synthetic Customer Oy',
    }),
  });
  expect((await e2eBackend.api.get('/health')).status()).toBe(200);
});

test('RUNTIME-EXIT-001 @critical @recovery stops the managed backend and reuses the released loopback port without an orphan', async ({
  e2eBackend,
}) => {
  const firstBackend = e2eBackend.backend;
  const firstPid = firstBackend.managedProcess.child.pid;
  const backendPort = Number(new URL(firstBackend.backendOrigin).port);

  const restarted = await e2eBackend.restartBackend();

  expect(await isManagedProcessExited(firstBackend)).toBe(true);
  expect(restarted.backend.managedProcess.child.pid).not.toBe(firstPid);
  expect((await restarted.api.get('/health')).status()).toBe(200);
  expect(firstBackend.managedProcess.readStdout()).not.toContain(
    firstBackend.sessionSecret,
  );
  expect(firstBackend.managedProcess.readStderr()).not.toContain(
    firstBackend.sessionSecret,
  );

  await restarted.backend.stop();
  await waitForLoopbackPortRelease(backendPort);
  expect(await isManagedProcessExited(restarted.backend)).toBe(true);
});

async function readRuntimeSummary(api: {
  get(path: string): Promise<{ json(): Promise<unknown>; status(): number }>;
}): Promise<{ runtimeInstanceId: string }> {
  const response = await api.get('/diagnostics/summary');
  expect(response.status()).toBe(200);
  return response.json() as Promise<{ runtimeInstanceId: string }>;
}

async function isManagedProcessExited(backend: {
  managedProcess: {
    child: {
      exitCode: number | null;
      signalCode: NodeJS.Signals | null;
    };
  };
}): Promise<boolean> {
  return (
    backend.managedProcess.child.exitCode !== null ||
    backend.managedProcess.child.signalCode !== null
  );
}
