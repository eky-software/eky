import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createDesktopRuntimeSession } from './runtimeSession.js';
import {
  createProfileInspectionCommand, createProfileInspectionStatus,
  parseProfileInspectionCommand, parseProfileInspectionReceipt, parseProfileInspectionStatus,
  parseProfileInspectionActiveContext, isProfileInspectionOperationId,
  profileInspectionMaximumMessageBytes, profileInspectionProtocolVersion,
  type ProfileInspectionCommand, type ProfileInspectionReceipt,
} from './profileInspectionMessages.js';

describe('profile inspection private messages', () => {
  it('admits only a bounded immutable active context and an operation UUID', () => {
    const context = { activeProfileId: 'a'.repeat(64), activeProfileIsEmpty: true };
    const parsed = parseProfileInspectionActiveContext(context);
    expect(parsed).toEqual(context);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(isProfileInspectionOperationId(randomUUID())).toBe(true);
    expect(isProfileInspectionOperationId('../staging')).toBe(false);
    expect(isProfileInspectionOperationId(undefined)).toBe(false);
  });

  it.each([
    { activeProfileId: 'raw-company-name', activeProfileIsEmpty: true },
    { activeProfileId: 'a'.repeat(64), activeProfileIsEmpty: 'true' },
    { activeProfileId: 'a'.repeat(64), activeProfileIsEmpty: true, companyId: 'forbidden' },
    { activeProfileId: 'a'.repeat(64), activeProfileIsEmpty: true, database: {} },
  ])('rejects malformed or wider active context: %j', value => {
    expect(parseProfileInspectionActiveContext(value)).toBeUndefined();
  });

  it('does not invoke active-context accessors or accept inherited state', () => {
    let reads = 0;
    const value = { activeProfileId: 'a'.repeat(64), activeProfileIsEmpty: true };
    Object.defineProperty(value, 'activeProfileIsEmpty', { get() { reads++; return true; } });
    expect(parseProfileInspectionActiveContext(value)).toBeUndefined();
    expect(reads).toBe(0);
    expect(parseProfileInspectionActiveContext(Object.create({ activeProfileId: 'a'.repeat(64), activeProfileIsEmpty: true })))
      .toBeUndefined();
  });

  it('roundtrips preparation, grant, shutdown and deep-frozen bound receipts', () => {
    const command = prepare();
    expect(parseProfileInspectionCommand(createProfileInspectionCommand(command))).toEqual(command);
    for (const type of ['grant', 'shutdown'] as const) {
      const { deployment: _deployment, kind: _kind, migrationPolicy: _policy, reservation: _reservation, ...identity } = command;
      expect(parseProfileInspectionCommand(createProfileInspectionCommand({ ...identity, type }))).toEqual({ ...identity, type });
    }
    const parsed = parseProfileInspectionStatus(completed(command));
    expect(parsed).toEqual(completed(command));
    expect(Object.isFrozen(parsed)).toBe(true);
    if (parsed?.type !== 'completed') throw new Error('EXPECTED_COMPLETED');
    expect(Object.isFrozen(parsed.result.database)).toBe(true);
    expect(Object.isFrozen(parsed.result.artifactCatalog)).toBe(true);
  });

  it.each(['exactCurrentManifest', 'compatibleHistoricalPrefix', 'restoreCompatible'] as const)
    ('roundtrips the explicit %s inspection policy without a fallback', migrationPolicy => {
      expect(parseProfileInspectionCommand({ ...prepare(), migrationPolicy })).toHaveProperty('migrationPolicy', migrationPolicy);
      expect(parseProfileInspectionReceipt({ ...receipt(), migrationPolicy })).toHaveProperty('migrationPolicy', migrationPolicy);
    });

  it.each(['active', 'staged'] as const)('roundtrips a distinct cold receipt for the %s database slot', databaseSlot => {
    const command = coldPreparation(databaseSlot);
    const parsed = parseProfileInspectionCommand(command);
    expect(parsed).toEqual(command);
    expect(Object.isFrozen(parsed)).toBe(true);
    if (parsed?.type !== 'prepare' || parsed.kind !== 'inspectColdRestoreContent') throw new Error('EXPECTED_COLD_PREPARATION');
    expect(Object.isFrozen(parsed.sources)).toBe(true);
    const status = { ...completed(prepare()), type: 'coldCompleted', result: coldReceipt(databaseSlot) };
    const terminal = parseProfileInspectionStatus(status);
    expect(terminal).toEqual(status);
    expect(Object.isFrozen(terminal)).toBe(true);
    if (terminal?.type !== 'coldCompleted') throw new Error('EXPECTED_COLD_COMPLETION');
    expect(Object.isFrozen(terminal.result.database)).toBe(true);
    expect(Object.isFrozen(terminal.result.documentBindings)).toBe(true);
    expect(terminal.result).not.toHaveProperty('artifactCatalog');
  });

  it('never accepts the other receipt variant or a fabricated portable catalog', () => {
    const portable = completed(prepare());
    expect(parseProfileInspectionStatus({ ...portable, result: coldReceipt() })).toBeUndefined();
    expect(parseProfileInspectionStatus({ ...portable, type: 'coldCompleted' })).toBeUndefined();
    expect(parseProfileInspectionStatus({ ...portable, type: 'coldCompleted',
      result: { ...coldReceipt(), artifactCatalog: receipt().artifactCatalog } })).toBeUndefined();
  });

  it.each([
    { databaseSlot: 'guessed' }, { documentsSlot: null }, { workspaceRoot: '../workspace' },
    { databaseFilePath: join(process.cwd(), 'arbitrary.sqlite') }, { companyId: 'forbidden' },
  ])('rejects wider or invalid cold sources: %j', change => {
    const command = coldPreparation();
    expect(parseProfileInspectionCommand({ ...command, sources: { ...command.sources, ...change } })).toBeUndefined();
  });

  it('rejects a cold policy override, accessors and inherited source fields', () => {
    const command = coldPreparation();
    expect(parseProfileInspectionCommand({ ...command, migrationPolicy: 'exactCurrentManifest' })).toBeUndefined();
    let reads = 0;
    const sources = { ...command.sources };
    Object.defineProperty(sources, 'databaseSlot', { get() { reads++; return 'active'; } });
    expect(parseProfileInspectionCommand({ ...command, sources })).toBeUndefined();
    expect(reads).toBe(0);
    expect(parseProfileInspectionCommand({ ...command, sources: Object.create(command.sources) })).toBeUndefined();
  });

  it('keeps the cold command within the same UTF-8 bound and rejects receipt accessors', () => {
    const command = coldPreparation();
    const path = join(process.cwd(), '\u00e4'.repeat(1_800));
    const oversized = { ...command, sources: { ...command.sources, workspaceRoot: path },
      deployment: { backendRoot: path, migrationsDirectory: path, nativeResourceRoot: path } };
    expect(Buffer.byteLength(JSON.stringify(oversized), 'utf8')).toBeGreaterThan(profileInspectionMaximumMessageBytes);
    expect(parseProfileInspectionCommand(oversized)).toBeUndefined();
    let reads = 0;
    const result = coldReceipt();
    Object.defineProperty(result.database, 'sha256', { get() { reads++; return 'a'.repeat(64); } });
    expect(parseProfileInspectionStatus({ ...completed(prepare()), type: 'coldCompleted', result })).toBeUndefined();
    expect(reads).toBe(0);
  });

  it.each([
    { databaseSlot: 'guessed' }, { documentsSlot: null }, { migrationPolicy: 'exactCurrentManifest' },
    { artifactCount: 100_001 }, { artifactTotalByteSize: 20 * 1024 ** 3 + 1 },
    { database: { byteSize: 24 * 1024 ** 3 + 1, sha256: 'a'.repeat(64) } }, { profileId: 'private-name' },
  ])('keeps the same resource and identity bounds for a cold result: %j', change => {
    expect(parseProfileInspectionStatus({ ...completed(prepare()), type: 'coldCompleted',
      result: { ...coldReceipt(), ...change } })).toBeUndefined();
  });

  it.each([
    undefined, null, {}, { byteSize: 0, sha256: 'd'.repeat(64) },
    { byteSize: 1.5, sha256: 'd'.repeat(64) },
    { byteSize: 64 * 1024 ** 2 + 1, sha256: 'd'.repeat(64) },
    { byteSize: 34, sha256: 'raw' }, { byteSize: 34, sha256: 'D'.repeat(64) },
    { byteSize: 34, sha256: 'd'.repeat(64), path: 'untrusted.json' },
  ])('rejects an absent, wider or unbounded cold document descriptor', documentBindings => {
    expect(parseProfileInspectionStatus({ ...completed(prepare()), type: 'coldCompleted',
      result: { ...coldReceipt(), documentBindings } })).toBeUndefined();
  });

  it('never invokes cold document descriptor accessors or accepts inherited descriptors', () => {
    let reads = 0;
    const descriptor = { ...coldReceipt().documentBindings };
    Object.defineProperty(descriptor, 'byteSize', { get() { reads++; return 34; } });
    for (const documentBindings of [descriptor, Object.create(coldReceipt().documentBindings)]) {
      expect(parseProfileInspectionStatus({ ...completed(prepare()), type: 'coldCompleted',
        result: { ...coldReceipt(), documentBindings } })).toBeUndefined();
    }
    expect(reads).toBe(0);
  });

  it.each([undefined, null, 'skipSchema', {}, 1])('rejects a missing or invalid inspection policy: %j', migrationPolicy => {
    expect(parseProfileInspectionCommand({ ...prepare(), migrationPolicy })).toBeUndefined();
    expect(parseProfileInspectionReceipt({ ...receipt(), migrationPolicy })).toBeUndefined();
  });

  it.each(['operationId', 'generationId', 'runtimeSession'] as const)('rejects malformed %s', key => {
    expect(parseProfileInspectionCommand({ ...prepare(), [key]: 'wrong' })).toBeUndefined();
  });

  it.each(['activeDatabasePath', 'password', 'sql', 'executable', 'args'] as const)('rejects unexpected %s', key => {
    expect(parseProfileInspectionCommand({ ...prepare(), [key]: 'forbidden' })).toBeUndefined();
    expect(parseProfileInspectionStatus({ ...completed(prepare()), [key]: 'forbidden' })).toBeUndefined();
  });

  it('cannot confuse operation roots, grant generations or active installation roots', () => {
    const command = prepare();
    expect(parseProfileInspectionCommand({ ...command, reservation: { ...command.reservation, generationId: randomUUID() } })).toBeUndefined();
    expect(parseProfileInspectionCommand({ ...command, reservation: { ...command.reservation, userDataRoot: process.cwd() } })).toBeUndefined();
    expect(parseProfileInspectionCommand({ ...command, reservation: { ...command.reservation, userDataRoot: join(process.cwd(), randomUUID()) } })).toBeUndefined();
  });

  it('rejects getter, inherited, symbol and proxy input without executing data getters', () => {
    let reads = 0;
    const accessor = { ...prepare() };
    Object.defineProperty(accessor, 'kind', { get() { reads++; return 'inspect'; } });
    expect(parseProfileInspectionCommand(accessor)).toBeUndefined();
    expect(reads).toBe(0);
    expect(parseProfileInspectionCommand(Object.create(prepare()))).toBeUndefined();
    expect(parseProfileInspectionCommand({ ...prepare(), [Symbol('extra')]: true })).toBeUndefined();
    expect(parseProfileInspectionCommand(new Proxy({}, { getPrototypeOf() { throw new Error('no'); } }))).toBeUndefined();
    const nested = prepare();
    const reservation = { ...nested.reservation };
    Object.defineProperty(reservation, 'identity', { get() { reads++; return 'a'.repeat(64); } });
    expect(parseProfileInspectionCommand({ ...nested, reservation })).toBeUndefined();
    expect(reads).toBe(0);
  });

  it('rejects oversized serialized deployments, including UTF-8 bytes', () => {
    const command = prepare();
    for (const component of ['x', '\u00e4']) {
      const longPath = join(process.cwd(), component.repeat(1_800));
      const oversized = { ...command, deployment: { backendRoot: longPath, migrationsDirectory: longPath, nativeResourceRoot: longPath } };
      expect(Buffer.byteLength(JSON.stringify(oversized))).toBeGreaterThan(profileInspectionMaximumMessageBytes);
      expect(parseProfileInspectionCommand(oversized)).toBeUndefined();
    }
  });

  it.each(['profileId', 'migrationChainIdentity', 'artifactIdentity'] as const)('rejects a raw or non-hash %s in a receipt', key => {
    expect(parseProfileInspectionReceipt({ ...receipt(), [key]: 'customer-name' })).toBeUndefined();
  });

  it.each([
    { artifactCount: -1 }, { artifactCount: 100_001 }, { artifactCount: 1.5 },
    { artifactTotalByteSize: 20 * 1024 ** 3 + 1 },
    { artifactIdentity: undefined }, { artifactIdentity: null },
    { databaseHealth: 'unknown' }, { migrationPolicy: 'skipSchema' },
    { database: { byteSize: 0, sha256: 'a'.repeat(64) } },
    { artifactCatalog: { byteSize: 64 * 1024 ** 2 + 1, sha256: 'a'.repeat(64) } },
    { sql: 'SELECT secret' },
  ])('rejects an invalid receipt field %j', change => {
    expect(parseProfileInspectionReceipt({ ...receipt(), ...change })).toBeUndefined();
  });

  it('preserves only a named failure or unknown and rejects raw messages/stacks', () => {
    const { deployment: _deployment, kind: _kind, migrationPolicy: _policy, reservation: _reservation, ...identity } = prepare();
    for (const causeCode of ['unknown', 'PROFILE_SCHEMA_UNSUPPORTED', 'PROFILE_INSPECTION_TIMEOUT'] as const) {
      expect(parseProfileInspectionStatus(createProfileInspectionStatus({ ...identity, type: 'failed', causeCode })))
        .toEqual({ ...identity, type: 'failed', causeCode });
    }
    expect(parseProfileInspectionStatus({ ...identity, type: 'failed', causeCode: 'raw exception password' })).toBeUndefined();
    expect(parseProfileInspectionStatus({ ...identity, type: 'failed', causeCode: 'unknown', stack: 'raw' })).toBeUndefined();
    expect(parseProfileInspectionStatus({ ...identity, type: 'ready' })).toBeUndefined();
  });
});

function prepare(): Extract<ProfileInspectionCommand, { type: 'prepare'; kind: 'inspect' | 'prepareRestoreActivation' }> {
  const operationId = randomUUID();
  const generationId = randomUUID();
  return { protocolVersion: profileInspectionProtocolVersion,
    runtimeSession: createDesktopRuntimeSession(), generationId, operationId, type: 'prepare', kind: 'inspect',
    migrationPolicy: 'restoreCompatible',
    reservation: { generationId, identity: 'a'.repeat(64), userDataRoot: join(process.cwd(), 'staging', operationId) },
    deployment: { backendRoot: process.cwd(), migrationsDirectory: join(process.cwd(), 'migrations'), nativeResourceRoot: join(process.cwd(), 'native') } };
}

function receipt(): ProfileInspectionReceipt {
  return { databaseHealth: 'healthy', migrationPolicy: 'restoreCompatible', profileId: 'a'.repeat(64), migrationChainIdentity: 'b'.repeat(64),
    artifactIdentity: 'e'.repeat(64),
    artifactCount: 0, artifactTotalByteSize: 0,
    database: { byteSize: 4_096, sha256: 'c'.repeat(64) }, artifactCatalog: { byteSize: 34, sha256: 'd'.repeat(64) } };
}

function coldPreparation(databaseSlot: 'active' | 'staged' = 'active') {
  const { migrationPolicy: _policy, ...command } = prepare();
  return { ...command, kind: 'inspectColdRestoreContent' as const,
    sources: { workspaceRoot: join(process.cwd(), 'workspace'), databaseSlot, documentsSlot: 'staged' as const } };
}

function coldReceipt(databaseSlot: 'active' | 'staged' = 'active') {
  const { artifactCatalog: _catalog, ...result } = receipt();
  return { ...result, documentBindings: { byteSize: 34, sha256: 'd'.repeat(64) },
    migrationPolicy: 'restoreCompatible' as const, databaseSlot, documentsSlot: 'staged' as const };
}

function completed(command: ReturnType<typeof prepare>) {
  const { deployment: _deployment, kind: _kind, migrationPolicy: _policy, reservation: _reservation, ...identity } = command;
  return { ...identity, type: 'completed' as const, result: receipt() };
}
