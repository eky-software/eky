import { describe, expect, it } from 'vitest';

import {
  createWorkspaceOperationResult,
  parseWorkspaceIdRequest,
  parseWorkspaceLabelRequest,
  parseWorkspaceRenameRequest,
  workspaceManagementCapabilityProtocolVersion,
  workspaceManagementIpcChannels,
} from './workspaceManagementCapabilityProtocol.js';

const workspaceId = '11111111-1111-4111-8111-111111111111';

describe('workspace management capability protocol', () => {
  it('uses one explicit protocol version and unique versioned channels', () => {
    expect(workspaceManagementCapabilityProtocolVersion).toBe(1);
    expect(new Set(workspaceManagementIpcChannels).size).toBe(5);
    expect(workspaceManagementIpcChannels).toHaveLength(5);
    for (const channel of workspaceManagementIpcChannels) {
      expect(channel).toContain(':v1:');
    }
  });

  it('accepts only exact workspace label requests', () => {
    expect(parseWorkspaceLabelRequest({ workspaceLabel: 'Oma yritys Oy' })).toEqual({
      workspaceLabel: 'Oma yritys Oy',
    });
    expect(() => parseWorkspaceLabelRequest({ workspaceLabel: '  nimi  ' })).toThrow(
      'WORKSPACE_MANAGEMENT_CAPABILITY_INVALID',
    );
    expect(() =>
      parseWorkspaceLabelRequest({ path: 'C:\\private', workspaceLabel: 'Nimi' }),
    ).toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_INVALID');
  });

  it('accepts only canonical identifiers and exact rename requests', () => {
    expect(parseWorkspaceIdRequest({ workspaceId })).toEqual({ workspaceId });
    expect(
      parseWorkspaceRenameRequest({
        workspaceId,
        workspaceLabel: 'Uusi nimi',
      }),
    ).toEqual({ workspaceId, workspaceLabel: 'Uusi nimi' });
    expect(() => parseWorkspaceIdRequest({ workspaceId: 'invalid' })).toThrow(
      'WORKSPACE_MANAGEMENT_CAPABILITY_INVALID',
    );
    expect(() =>
      parseWorkspaceRenameRequest({
        journal: 'renderer-owned',
        workspaceId,
        workspaceLabel: 'Uusi nimi',
      }),
    ).toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_INVALID');
  });

  it('returns only the versioned allowlisted operation result', () => {
    expect(createWorkspaceOperationResult('completed')).toEqual({
      formatVersion: 1,
      status: 'completed',
    });
    expect(Object.isFrozen(createWorkspaceOperationResult('cancelled'))).toBe(true);
  });
});
