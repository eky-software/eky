import { describe, expect, it } from 'vitest';

import {
  InMemoryWorkspaceMaintenanceLease,
  WorkspaceMaintenanceLeaseBusyError,
} from './workspaceMaintenanceLease.js';

describe('workspace maintenance lease', () => {
  it('captures only the exact acquired handle even when a later owner has the same purpose', async () => {
    const lease = new InMemoryWorkspaceMaintenanceLease();
    const first = await lease.acquire('replace');
    const assertFirst = lease.captureCurrentOwner(['replace'], first);
    expect(() => lease.captureCurrentOwner(['replace'], { release: first.release })).toThrow(WorkspaceMaintenanceLeaseBusyError);
    await first.release();
    const second = await lease.acquire('replace');
    expect(() => lease.captureCurrentOwner(['replace'], first)).toThrow(WorkspaceMaintenanceLeaseBusyError);
    expect(assertFirst).toThrow(WorkspaceMaintenanceLeaseBusyError);
    const assertSecond = lease.captureCurrentOwner(['replace'], second);
    await first.release();
    expect(assertSecond).not.toThrow();
    await second.release();
    expect(assertSecond).toThrow(WorkspaceMaintenanceLeaseBusyError);
  });

  it('binds captured authority to the actual owner, not a later busy state', async () => {
    const lease = new InMemoryWorkspaceMaintenanceLease();
    expect(() => lease.captureCurrentOwner(['create'])).toThrow(WorkspaceMaintenanceLeaseBusyError);
    const first = await lease.acquire('create');
    const assertFirst = lease.captureCurrentOwner(['create']);
    expect(() => assertFirst()).not.toThrow();
    expect(() => lease.captureCurrentOwner(['import'])).toThrow(WorkspaceMaintenanceLeaseBusyError);
    await first.release();
    expect(assertFirst).toThrow(WorkspaceMaintenanceLeaseBusyError);
    const second = await lease.acquire('create');
    const assertSecond = lease.captureCurrentOwner(['create']);
    expect(assertFirst).toThrow(WorkspaceMaintenanceLeaseBusyError);
    await first.release();
    expect(() => assertSecond()).not.toThrow();
    await second.release();
    expect(assertSecond).toThrow(WorkspaceMaintenanceLeaseBusyError);
  });

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
