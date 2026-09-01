import { describe, expect, it, vi } from 'vitest';

import type { WorkspaceBackupCandidatePort } from '../import/workspaceBackupImportPorts.js';
import { createWorkspaceActivationMigrationCandidate } from './workspaceActivationMigrationCandidate.js';

describe('workspace activation migration candidate', () => {
  it('returns the production candidate unchanged without a boundary hook', () => {
    const candidate = createCandidate();
    expect(
      createWorkspaceActivationMigrationCandidate({ candidate }),
    ).toBe(candidate);
  });

  it('runs the boundary hook before migration and delegates validation', async () => {
    const order: string[] = [];
    const candidate = createCandidate(order);
    const decorated = createWorkspaceActivationMigrationCandidate({
      beforeMigration: () => order.push('beforeMigration'),
      candidate,
    });

    await decorated.migrate({} as never);
    await decorated.validateAndMaterialize({} as never);
    await decorated.validatePublished({} as never);

    expect(order).toEqual([
      'beforeMigration',
      'migrate',
      'validateAndMaterialize',
      'validatePublished',
    ]);
  });

  it('does not call the production candidate when the boundary hook fails', async () => {
    const candidate = createCandidate();
    const decorated = createWorkspaceActivationMigrationCandidate({
      beforeMigration() {
        throw new Error('injected');
      },
      candidate,
    });

    await expect(decorated.migrate({} as never)).rejects.toThrow('injected');
    expect(candidate.migrate).not.toHaveBeenCalled();
  });
});

function createCandidate(order: string[] = []): WorkspaceBackupCandidatePort {
  return {
    migrate: vi.fn(async () => {
      order.push('migrate');
      return {} as never;
    }),
    validateAndMaterialize: vi.fn(async () => {
      order.push('validateAndMaterialize');
      return {} as never;
    }),
    validatePublished: vi.fn(async () => {
      order.push('validatePublished');
      return {} as never;
    }),
  };
}
