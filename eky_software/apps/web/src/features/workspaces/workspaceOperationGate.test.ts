import { describe, expect, it } from 'vitest';

import { tryAcquireWorkspaceOperation } from './workspaceOperationGate.js';

describe('workspace operation gate', () => {
  it('accepts only one synchronous submit until the operation releases it', () => {
    const gate = { current: false };

    expect(tryAcquireWorkspaceOperation(gate)).toBe(true);
    expect(tryAcquireWorkspaceOperation(gate)).toBe(false);
    gate.current = false;
    expect(tryAcquireWorkspaceOperation(gate)).toBe(true);
  });
});
