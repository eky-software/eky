import { describe, expect, it, vi } from 'vitest';

import {
  PrivateEmptyWorkspaceBootstrapAdapter,
  PrivatePublishedWorkspaceValidationAdapter,
} from './privateEmptyWorkspaceBootstrapAdapter.js';
import {
  createTestBootstrapResult,
  TEST_OPERATION_ID,
  TEST_WORKSPACE_ID,
} from './emptyWorkspaceCreationTestSupport.js';

const bootstrapInput = {
  operationId: TEST_OPERATION_ID,
  workspaceId: TEST_WORKSPACE_ID,
  candidateRoot: 'C:\\private\\candidate',
  databaseFilePath: 'C:\\private\\candidate\\runtime\\data\\eky.sqlite',
  artifactRoot: 'C:\\private\\candidate\\runtime\\storage\\invoices',
} as const;

describe('private empty workspace bootstrap adapters', () => {
  it('returns only validated readiness after the private runtime closes its handles', async () => {
    const events: string[] = [];
    const stop = vi.fn(async () => true);
    const adapter = new PrivateEmptyWorkspaceBootstrapAdapter({
      start: vi.fn(async () => ({
        inspectStoppedReadiness: async () => {
          events.push('inspect');
          return createTestBootstrapResult();
        },
        stopAndProveHandlesClosed: async () => {
          events.push('stop');
          return stop();
        },
      })),
    });

    await expect(adapter.bootstrap(bootstrapInput)).resolves.toEqual(
      createTestBootstrapResult(),
    );
    expect(stop).toHaveBeenCalledOnce();
    expect(events).toEqual(['stop', 'inspect']);
  });

  it('fails closed when bootstrap leaves a database handle open', async () => {
    const adapter = new PrivateEmptyWorkspaceBootstrapAdapter({
      start: async () => ({
        inspectStoppedReadiness: async () => createTestBootstrapResult(),
        stopAndProveHandlesClosed: async () => false,
      }),
    });

    await expect(adapter.bootstrap(bootstrapInput)).rejects.toMatchObject({
      code: 'WORKSPACE_CREATION_BOOTSTRAP_FAILED',
      stage: 'bootstrap',
    });
  });

  it('attempts bounded cleanup when stopped readiness inspection fails', async () => {
    const stop = vi.fn(async () => true);
    const adapter = new PrivateEmptyWorkspaceBootstrapAdapter({
      start: async () => ({
        inspectStoppedReadiness: async () => {
          throw new Error('private failure');
        },
        stopAndProveHandlesClosed: stop,
      }),
    });

    await expect(adapter.bootstrap(bootstrapInput)).rejects.toMatchObject({
      code: 'WORKSPACE_CREATION_BOOTSTRAP_FAILED',
      stage: 'bootstrap',
    });
    expect(stop).toHaveBeenCalledOnce();
  });

  it('validates a published root through a separate read-only runtime boundary', async () => {
    const events: string[] = [];
    const startForValidation = vi.fn(async () => ({
      inspectStoppedReadiness: async () => {
        events.push('inspect');
        return createTestBootstrapResult();
      },
      stopAndProveHandlesClosed: async () => {
        events.push('stop');
        return true;
      },
    }));
    const adapter = new PrivatePublishedWorkspaceValidationAdapter({
      startForValidation,
    });

    await expect(adapter.validatePublished({
      operationId: TEST_OPERATION_ID,
      workspaceId: TEST_WORKSPACE_ID,
      publishedRoot: 'C:\\private\\published',
      databaseFilePath: 'C:\\private\\published\\runtime\\data\\eky.sqlite',
      artifactRoot: 'C:\\private\\published\\runtime\\storage\\invoices',
    })).resolves.toEqual(createTestBootstrapResult());
    expect(startForValidation).toHaveBeenCalledOnce();
    expect(events).toEqual(['stop', 'inspect']);
  });
});
