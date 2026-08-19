import { describe, expect, it } from 'vitest';

import {
  InMemoryWorkspaceMaintenanceLease,
  WorkspaceMaintenanceLeaseBusyError,
} from './workspaceMaintenanceLease.js';

describe('workspace maintenance lease', () => {
  it('serializes maintenance operations and allows the next owner after release', async () => {
    const lease = new InMemoryWorkspaceMaintenanceLease();
    expect(lease.readState()).toBe('idle');
    const first = await lease.acquire('create');
    expect(lease.readState()).toBe('busy');

    await expect(lease.acquire('create')).rejects.toBeInstanceOf(
      WorkspaceMaintenanceLeaseBusyError,
    );

    await first.release();
    await first.release();
    expect(lease.readState()).toBe('idle');
    const second = await lease.acquire('restore');
    await expect(second.release()).resolves.toBeUndefined();
  });
});
