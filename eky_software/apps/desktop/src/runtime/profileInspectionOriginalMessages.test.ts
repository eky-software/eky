import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseProfileInspectionCommand, parseProfileInspectionStatus, profileInspectionProtocolVersion } from './profileInspectionMessages.js';

const identity = { protocolVersion: profileInspectionProtocolVersion, generationId: randomUUID(),
  operationId: randomUUID(), runtimeSession: 'a'.repeat(43) };
const sources = { workspaceRoot: join(process.cwd(), 'workspaces', randomUUID()),
  layout: 'workspaceReplacement', databaseSlot: 'rollback', documentsSlot: 'active' };
const content = { sourceRole: 'original', layout: sources.layout, databaseSlot: sources.databaseSlot,
  documentsSlot: sources.documentsSlot, artifactCount: 1, artifactTotalByteSize: 50,
  artifactIdentity: 'b'.repeat(64), databaseHealth: 'healthy', migrationChainIdentity: 'c'.repeat(64),
  profileId: 'd'.repeat(64), migrationPolicy: 'restoreCompatible',
  database: { byteSize: 8192, sha256: 'e'.repeat(64) }, documentBindings: { byteSize: 34, sha256: 'f'.repeat(64) } };

describe('original-content private inspection messages', () => {
  it.each(['profileRestore', 'workspaceReplacement'])('admits only the named original %s command', layout => {
    const command = preparation({ ...sources, layout });
    const parsed = parseProfileInspectionCommand(command);
    expect(parsed).toEqual(command);
    expect(Object.isFrozen(parsed)).toBe(true);
    if (parsed?.type !== 'prepare' || parsed.kind !== 'inspectColdRestoreOriginal') throw new Error('EXPECTED_ORIGINAL');
    expect(Object.isFrozen(parsed.sources)).toBe(true);
  });

  it('keeps original receipts distinct from portable and forward receipts', () => {
    const status = terminal(content);
    const parsed = parseProfileInspectionStatus(status);
    expect(parsed).toEqual(status);
    if (parsed?.type !== 'originalCompleted') throw new Error('EXPECTED_ORIGINAL');
    expect(Object.isFrozen(parsed.result)).toBe(true);
    expect(parseProfileInspectionStatus({ ...status, type: 'coldCompleted' })).toBeUndefined();
    expect(parseProfileInspectionStatus({ ...status, type: 'completed' })).toBeUndefined();
    const { sourceRole: _role, layout: _layout, ...forward } = content;
    expect(parseProfileInspectionStatus(terminal(forward))).toBeUndefined();
  });

  it.each(['active', 'rollback', 'absent'])('reports absent original DB with %s documents without fabricated content', documentsSlot => {
    const result = { sourceRole: 'original', layout: 'profileRestore', databaseSlot: 'absent', documentsSlot };
    expect(parseProfileInspectionStatus(terminal(result))).toEqual(terminal(result));
    for (const key of ['databaseHealth', 'profileId', 'migrationChainIdentity', 'database', 'documentBindings', 'artifactCount']) {
      expect(parseProfileInspectionStatus(terminal({ ...result, [key]: content[key as keyof typeof content] }))).toBeUndefined();
    }
  });

  it('allows absent original documents only when the attested catalog is empty', () => {
    const empty = { ...content, documentsSlot: 'absent', artifactCount: 0, artifactTotalByteSize: 0 };
    expect(parseProfileInspectionStatus(terminal(empty))).toEqual(terminal(empty));
    expect(parseProfileInspectionStatus(terminal({ ...empty, artifactCount: 1 }))).toBeUndefined();
    expect(parseProfileInspectionStatus(terminal({ ...empty, artifactTotalByteSize: 1 }))).toBeUndefined();
  });

  it.each([{ layout: 'guessed' }, { databaseSlot: 'staged' }, { documentsSlot: 'staged' },
    { databaseFilePath: join(process.cwd(), 'arbitrary.sqlite') }, { companyId: 'forbidden' }])
    ('rejects wider original selection %j', change => {
      expect(parseProfileInspectionCommand(preparation({ ...sources, ...change }))).toBeUndefined();
      expect(parseProfileInspectionStatus(terminal({ ...content, ...change }))).toBeUndefined();
    });

  it('rejects accessors and policy overrides without reading them', () => {
    let reads = 0;
    const selected = { ...sources };
    Object.defineProperty(selected, 'databaseSlot', { get() { reads++; return 'rollback'; } });
    expect(parseProfileInspectionCommand(preparation(selected))).toBeUndefined();
    expect(parseProfileInspectionCommand({ ...preparation(sources), migrationPolicy: 'exactCurrentManifest' })).toBeUndefined();
    expect(parseProfileInspectionStatus(terminal({ ...content, sourceRole: 'target' }))).toBeUndefined();
    expect(parseProfileInspectionStatus(terminal({ ...content, migrationPolicy: 'exactCurrentManifest' }))).toBeUndefined();
    expect(reads).toBe(0);
  });
});

function preparation(selected: object) {
  return { ...identity, type: 'prepare', kind: 'inspectColdRestoreOriginal', sources: selected,
    deployment: { backendRoot: join(process.cwd(), 'backend'), migrationsDirectory: join(process.cwd(), 'backend', 'migrations'),
      nativeResourceRoot: join(process.cwd(), 'native') },
    reservation: { generationId: identity.generationId, identity: 'b'.repeat(64),
      userDataRoot: join(process.cwd(), 'failed', identity.operationId) } };
}

function terminal(result: object) { return { ...identity, type: 'originalCompleted', result }; }
