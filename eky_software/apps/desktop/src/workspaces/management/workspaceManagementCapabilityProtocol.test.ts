import { describe, expect, it } from 'vitest';

import {
  createWorkspaceOperationResult,
  parseWorkspaceIdRequest,
  parseWorkspaceDeletionRequest,
  parseWorkspaceLabelRequest,
  parseWorkspaceRenameRequest,
  workspaceManagementCapabilityProtocolVersion,
  workspaceManagementIpcChannels,
} from './workspaceManagementCapabilityProtocol.js';

const workspaceId = '11111111-1111-4111-8111-111111111111';

describe('workspace management capability protocol', () => {
  it('uses one explicit protocol version and unique versioned channels', () => {
    expect(workspaceManagementCapabilityProtocolVersion).toBe(1);
    expect(new Set(workspaceManagementIpcChannels).size).toBe(6);
    expect(workspaceManagementIpcChannels).toHaveLength(6);
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

  it.each(['createBackup', 'explicitDataLoss'] as const)(
    'captures an immutable exact deletion request with %s', backupChoice => {
      const input = { formatVersion: 1, workspaceId, typedLabel: 'Oma yritys Oy', backupChoice };
      const parsed = parseWorkspaceDeletionRequest(input);
      expect(parsed).toEqual(input);
      expect(Object.isFrozen(parsed)).toBe(true);
      input.typedLabel = 'Changed later';
      expect(parsed.typedLabel).toBe('Oma yritys Oy');
      expect(workspaceManagementIpcChannels).toHaveLength(6);
      expect(workspaceManagementIpcChannels.some(channel => channel.endsWith(':delete'))).toBe(false);
    },
  );

  it.each([
    null,
    { workspaceId },
    { formatVersion: 2, workspaceId, typedLabel: 'Name', backupChoice: 'createBackup' },
    { formatVersion: 1, workspaceId: 'invalid', typedLabel: 'Name', backupChoice: 'createBackup' },
    { formatVersion: 1, workspaceId, typedLabel: ' Name ', backupChoice: 'createBackup' },
    { formatVersion: 1, workspaceId, typedLabel: 'Name', backupChoice: 'latestBackup' },
    { formatVersion: 1, workspaceId, typedLabel: 'Name', backupChoice: 'createBackup', backupVerified: true },
    { formatVersion: 1, workspaceId, typedLabel: 'Name', backupChoice: 'createBackup', path: 'untrusted' },
    { formatVersion: 1, workspaceId, typedLabel: 'Name', backupChoice: 'createBackup', password: 'untrusted' },
  ])('rejects a malformed deletion request at case %#', value => {
    expect(() => parseWorkspaceDeletionRequest(value)).toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_INVALID');
  });

  it('rejects request accessors without invoking them or retaining a prototype', () => {
    let reads = 0;
    const value = { formatVersion: 1, workspaceId, backupChoice: 'createBackup',
      get typedLabel() { reads += 1; return 'Name'; } };
    expect(() => parseWorkspaceDeletionRequest(value)).toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_INVALID');
    expect(reads).toBe(0);
    expect(() => parseWorkspaceDeletionRequest(Object.assign(Object.create({ inherited: true }), {
      formatVersion: 1, workspaceId, typedLabel: 'Name', backupChoice: 'createBackup',
    }))).toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_INVALID');
  });
});
