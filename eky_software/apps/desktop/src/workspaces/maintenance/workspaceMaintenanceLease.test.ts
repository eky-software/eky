import { describe, expect, it } from 'vitest';

import {
  InMemoryWorkspaceMaintenanceLease,
  WorkspaceMaintenanceLeaseBusyError,
} from './workspaceMaintenanceLease.js';

describe('workspace maintenance lease', () => {
  it('serializes maintenance operations and allows the next owner after release', async () => {
    const lease = new InMemoryWorkspaceMaintenanceLease();
    const first = await lease.acquire('create');

    await expect(lease.acquire('create')).rejects.toBeInstanceOf(
      WorkspaceMaintenanceLeaseBusyError,
    );

    await first.release();
    await first.release();
    const second = await lease.acquire('restore');
    await expect(second.release()).resolves.toBeUndefined();
  });
});
