import fs from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { mock } from 'node:test';

import { expect, test } from '@playwright/test';

import { createBackendOperationalEvent } from '../../../backend/src/observability/createOperationalEvent.js';
import { JsonLineOperationalLogger } from '../../../backend/src/observability/infrastructure/jsonLineOperationalLogger.js';
import type { BackendOperationalEvent, BackendOperationalEventInput } from '../../../backend/src/observability/operationalEvent.js';
import { createE2eRunRoot } from '../../src/environment/createE2eRunRoot.js';
import { removeE2eRunRoot } from '../../src/environment/removeE2eRunRoot.js';
import {
  captureElectronBackendStartupLogs,
  type ElectronBackendStartupLogsCapture,
  type ElectronBackendStartupLogsCaptureInput,
} from '../../src/fixtures/captureElectronBackendStartupLogs.js';

const currentRuntime = '11111111-1111-4111-8111-111111111111';
const previousRuntime = '22222222-2222-4222-8222-222222222222';
const fileByteLimit = 64 * 1024;
const totalByteLimit = 256 * 1024;
const lineByteLimit = 16 * 1024;

test.describe('SYS-ELECTRON-BACKEND-STARTUP-LOGS-001 @critical @security', () => {
  let input: ElectronBackendStartupLogsCaptureInput;
  let backendDirectory: string;
  const additionalRoots: string[] = [];
  const rootAliases: string[] = [];

  test.beforeEach(() => {
    const runRoot = createE2eRunRoot();
    input = { runRoot, userDataPath: join(runRoot, 'scenario', 'desktop-user-data'), runtimeInstanceId: currentRuntime };
    backendDirectory = join(input.userDataPath, 'runtime', 'logs', 'backend');
    fs.mkdirSync(backendDirectory, { recursive: true });
  });

  test.afterEach(async () => {
    mock.restoreAll();
    for (const alias of rootAliases.splice(0)) fs.rmSync(alias);
    for (const root of additionalRoots.splice(0)) await removeE2eRunRoot(root);
    await removeE2eRunRoot(input.runRoot);
  });

  test('projects all 12 startup and two shutdown names from the actual writer, uniquely and deeply frozen', () => {
    const initial: ElectronBackendStartupLogsCapture = { status: 'notRequested' };
    expect(initial).toEqual({ status: 'notRequested' });
    const writer = new JsonLineOperationalLogger({ logsRoot: dirname(backendDirectory) });
    const events: BackendOperationalEventInput[] = [
      { eventName: 'backend.starting' }, { eventName: 'backend.started', durationMs: 4 },
      { eventName: 'operationalLog.retentionCompleted', deletedByteCount: 0, deletedFileCount: 0 },
      { eventName: 'database.opening' }, { eventName: 'database.opened' },
      { eventName: 'database.openFailed', errorCode: 'SYNTHETIC_OPEN_FAILURE' },
      { eventName: 'database.integrityCheckFailed', errorCode: 'SYNTHETIC_INTEGRITY_FAILURE' },
      { eventName: 'migration.started', stage: 'startup' }, { eventName: 'migration.completed' },
      { eventName: 'migration.failed', errorCode: 'SYNTHETIC_MIGRATION_FAILURE', completedMigrationCount: 0, failureStage: 'migrationExecution', sideEffectState: 'unknown' },
      { eventName: 'businessAudit.retentionCompleted', deletedEventCount: 0 },
      { eventName: 'businessAudit.retentionFailed', errorCode: 'SYNTHETIC_RETENTION_FAILURE' },
      { eventName: 'backend.shutdownStarted' }, { eventName: 'backend.shutdownCompleted' },
    ];
    for (const event of [...events].reverse()) {
      writer.write(buildEvent(event));
      writer.write(buildEvent(event));
    }
    const captured = captureElectronBackendStartupLogs(input);
    expect(captured).toEqual({
      status: 'captured', issues: [],
      startup: [
        pair('backend.starting'), pair('backend.started'), pair('operationalLog.retentionCompleted'),
        pair('database.opening'), pair('database.opened'), pair('database.openFailed', 'failure'),
        pair('database.integrityCheckFailed', 'failure'), pair('migration.started'), pair('migration.completed'),
        pair('migration.failed', 'failure'), pair('businessAudit.retentionCompleted'), pair('businessAudit.retentionFailed', 'failure'),
      ],
      shutdown: [pair('backend.shutdownStarted'), pair('backend.shutdownCompleted')],
    });
    expect(Object.isFrozen(captured)).toBe(true);
    if (captured.status === 'notRequested') throw new Error('Capture was not requested');
    for (const array of [captured.issues, captured.startup, captured.shutdown]) expect(Object.isFrozen(array)).toBe(true);
    for (const event of [...captured.startup, ...captured.shutdown]) expect(Object.isFrozen(event)).toBe(true);
    const serialized = JSON.stringify(captured);
    for (const excluded of [currentRuntime, input.runRoot, 'eventId', 'timestamp', 'durationMs', 'errorCode', 'stage', 'deletedEventCount']) {
      expect(serialized).not.toContain(excluded);
    }
  });

  test('filters previous generations and unrelated valid events without leaking records or secrets', () => {
    const writer = new JsonLineOperationalLogger({ logsRoot: dirname(backendDirectory) });
    writer.write(buildEvent({ eventName: 'backend.started' }, previousRuntime));
    writer.write(buildEvent({ eventName: 'http.requestFailed', errorCode: 'SYNTHETIC_HTTP_FAILURE', operationId: 'synthetic.operation' }));
    writer.write(buildEvent({ eventName: 'backend.starting' }));
    writeLines('untrusted.jsonl', [
      { ...buildEvent({ eventName: 'backend.started' }), secret: 'synthetic-secret-do-not-publish' },
      { ...buildEvent({ eventName: 'backend.shutdownStarted' }), outcome: 'failure' },
    ]);
    const captured = captureElectronBackendStartupLogs(input);
    expect(captured).toEqual({ status: 'partial', issues: ['invalidEvent'], startup: [pair('backend.starting')], shutdown: [] });
    expect(JSON.stringify(captured)).not.toMatch(/synthetic|22222222|11111111|operationId|timestamp|runtimeInstanceId|secret/);
  });

  test('an empty or previous-generation-only read is not a startup completion claim', () => {
    expect(captureElectronBackendStartupLogs(input)).toEqual({ ...emptyCapture('unavailable'), issues: ['missing'] });
    fs.writeFileSync(join(backendDirectory, 'empty.jsonl'), '');
    expect(captureElectronBackendStartupLogs(input)).toEqual(emptyCapture('captured'));
    writeLines('old.jsonl', [buildEvent({ eventName: 'backend.started' }, previousRuntime)]);
    expect(captureElectronBackendStartupLogs(input)).toEqual(emptyCapture('captured'));
  });

  test('returns missing evidence without fallback, creating directories or requiring a parent E2E flag', () => {
    const environmentBefore = process.env.EKY_E2E;
    fs.rmSync(backendDirectory, { recursive: true });
    expect(captureElectronBackendStartupLogs(input)).toEqual({ ...emptyCapture('unavailable'), issues: ['missing'] });
    expect(fs.existsSync(backendDirectory)).toBe(false);
    expect(process.env.EKY_E2E).toBe(environmentBefore);
  });

  test('reads only direct jsonl candidates in the fixed backend directory', () => {
    const line = serialize({ eventName: 'backend.started' });
    for (const directory of [join(backendDirectory, 'nested'), join(dirname(backendDirectory), 'desktop'), join(input.runRoot, 'logs', 'backend')]) {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(join(directory, 'ignored.jsonl'), line);
    }
    fs.writeFileSync(join(backendDirectory, 'ignored.txt'), line);
    fs.writeFileSync(join(input.userDataPath, 'runtime-config.json'), 'synthetic-private-config');
    writeLines('test-selector-not-production-naming.jsonl', [buildEvent({ eventName: 'backend.starting' })]);
    expect(captureElectronBackendStartupLogs(input)).toEqual({ ...emptyCapture('captured'), startup: [pair('backend.starting')] });
  });

  test('rejects malformed and catalog-invalid records while retaining independent complete evidence', () => {
    const valid = buildEvent({ eventName: 'database.opened' });
    const invalid = [null, [], { ...valid, eventName: 'private.unknown' }, { ...valid, schemaVersion: 2 },
      { ...valid, component: 'desktop' }, { ...valid, outcome: 'failure' }, { ...valid, timestamp: 'invalid' },
      { ...valid, runtimeInstanceId: 'not-a-runtime' }, { ...valid, arbitrary: 'synthetic-private' }];
    writeLines('records.jsonl', [...invalid, valid]);
    fs.appendFileSync(join(backendDirectory, 'records.jsonl'), '{malformed\n');
    expect(captureElectronBackendStartupLogs(input)).toEqual({ status: 'partial', issues: ['invalidEvent'], startup: [pair('database.opened')], shutdown: [] });
  });

  test('never parses an unterminated final record even when it is valid JSON', () => {
    fs.writeFileSync(join(backendDirectory, 'records.jsonl'), `${serialize({ eventName: 'backend.starting' })}${serialize({ eventName: 'backend.started' }).trimEnd()}`);
    expect(captureElectronBackendStartupLogs(input)).toEqual({ status: 'partial', issues: ['incompleteLine'], startup: [pair('backend.starting')], shutdown: [] });
    fs.writeFileSync(join(backendDirectory, 'records.jsonl'), '{');
    expect(captureElectronBackendStartupLogs(input)).toEqual({ ...emptyCapture('partial'), issues: ['incompleteLine'] });
  });

  test('bounds raw line bytes before JSON parsing and accepts the exact line limit', () => {
    const line = JSON.stringify(buildEvent({ eventName: 'backend.starting' }));
    fs.writeFileSync(join(backendDirectory, 'records.jsonl'), `${line.padEnd(lineByteLimit, ' ')}\r\n`);
    expect(captureElectronBackendStartupLogs(input)).toEqual({ ...emptyCapture('captured'), startup: [pair('backend.starting')] });
    fs.writeFileSync(join(backendDirectory, 'records.jsonl'), `${line.padEnd(lineByteLimit + 1, ' ')}\n${serialize({ eventName: 'database.opening' })}`);
    expect(captureElectronBackendStartupLogs(input)).toEqual({ status: 'partial', issues: ['lineLimit'], startup: [pair('database.opening')], shutdown: [] });
  });

  test('keeps only the bounded tail and discards its possibly partial first line', () => {
    fs.writeFileSync(join(backendDirectory, 'large.jsonl'), `${serialize({ eventName: 'backend.starting' })}${'x'.repeat(fileByteLimit)}\n${serialize({ eventName: 'backend.started' })}`);
    expect(captureElectronBackendStartupLogs(input)).toEqual({ status: 'partial', issues: ['byteLimit'], startup: [pair('backend.started')], shutdown: [] });
  });

  test('caps total file reads at 256 KiB and each file at 64 KiB', () => {
    for (let index = 0; index < 5; index++) {
      const buffer = Buffer.alloc(fileByteLimit, 10);
      buffer.write(serialize({ eventName: index === 4 ? 'backend.started' : 'backend.starting' }));
      fs.writeFileSync(join(backendDirectory, `${index}.jsonl`), buffer);
    }
    const originalRead = fs.readSync;
    let requestedBytes = 0;
    const read = mock.method(fs, 'readSync', ((descriptor: number, buffer: NodeJS.ArrayBufferView, offset: number, length: number, position: number | null) => {
      requestedBytes += length;
      expect(buffer.byteLength).toBeLessThanOrEqual(fileByteLimit);
      return originalRead(descriptor, buffer, offset, length, position);
    }) as typeof fs.readSync);
    expect(captureElectronBackendStartupLogs(input)).toEqual({ status: 'partial', issues: ['byteLimit'], startup: [pair('backend.starting')], shutdown: [] });
    expect(requestedBytes).toBe(totalByteLimit);
    expect(read.mock.callCount()).toBe(4);
  });

  test('limits candidate files to 16, independently of byte consumption', () => {
    for (let index = 0; index < 17; index++) {
      writeLines(`${String(index).padStart(2, '0')}.jsonl`, [buildEvent({ eventName: index === 16 ? 'backend.started' : 'backend.starting' })]);
    }
    const originalOpen = fs.openSync;
    const open = mock.method(fs, 'openSync', originalOpen);
    expect(captureElectronBackendStartupLogs(input)).toEqual({ status: 'partial', issues: ['fileLimit'], startup: [pair('backend.starting')], shutdown: [] });
    expect(open.mock.callCount()).toBe(16);
  });

  test('caps directory enumeration at 64 entries without an unbounded readdir or recursion', () => {
    for (let index = 0; index < 65; index++) fs.writeFileSync(join(backendDirectory, `${index}.txt`), '');
    const originalOpenDirectory = fs.opendirSync;
    let reads = 0;
    let closed = false;
    mock.method(fs, 'opendirSync', ((path: fs.PathLike, options?: fs.OpenDirOptions) => {
      const directory = originalOpenDirectory(path, options);
      const originalRead = directory.readSync.bind(directory);
      const originalClose = directory.closeSync.bind(directory);
      mock.method(directory, 'readSync', () => { reads++; return originalRead(); });
      mock.method(directory, 'closeSync', () => { originalClose(); closed = true; });
      return directory;
    }) as typeof fs.opendirSync);
    expect(captureElectronBackendStartupLogs(input)).toEqual({ ...emptyCapture('partial'), issues: ['directoryLimit'] });
    expect(reads).toBe(64);
    expect(closed).toBe(true);
  });

  test('returns closed evidence for directory and file read errors, never raw exception text', () => {
    const failure = new Error('synthetic-private-read-path-and-secret');
    mock.method(fs, 'opendirSync', () => { throw failure; });
    expect(captureElectronBackendStartupLogs(input)).toEqual({ ...emptyCapture('unavailable'), issues: ['readFailed'] });
    mock.restoreAll();
    writeLines('read-error.jsonl', [buildEvent({ eventName: 'backend.starting' })]);
    const originalOpen = fs.openSync;
    let opened: number | undefined;
    mock.method(fs, 'openSync', (path: fs.PathLike, flags: string | number, mode?: fs.Mode) => {
      opened = originalOpen(path, flags, mode);
      return opened;
    });
    mock.method(fs, 'readSync', () => { throw failure; });
    expect(captureElectronBackendStartupLogs(input)).toEqual({ ...emptyCapture('partial'), issues: ['readFailed'] });
    expect(opened).toBeDefined();
    expect(() => fs.fstatSync(opened!)).toThrow();
  });

  test('detects append and shrink during a read without following growth or claiming complete coverage', () => {
    const path = join(backendDirectory, 'changing.jsonl');
    const originalRead = fs.readSync;
    for (const change of ['grow', 'shrink'] as const) {
      fs.writeFileSync(path, serialize({ eventName: 'backend.starting' }));
      mock.method(fs, 'readSync', ((descriptor: number, buffer: NodeJS.ArrayBufferView, offset: number, length: number, position: number | null) => {
        const read = originalRead(descriptor, buffer, offset, length, position);
        if (change === 'grow') fs.appendFileSync(path, serialize({ eventName: 'backend.started' }));
        else fs.truncateSync(path, 0);
        return read;
      }) as typeof fs.readSync);
      expect(captureElectronBackendStartupLogs(input)).toEqual({ status: 'partial', issues: ['sourceChanged'], startup: [pair('backend.starting')], shutdown: [] });
      mock.restoreAll();
    }
  });

  test('detects lstat/open replacement and closes the rejected handle without projecting its data', () => {
    const path = join(backendDirectory, 'replace.jsonl');
    fs.writeFileSync(path, serialize({ eventName: 'backend.starting' }));
    const originalOpen = fs.openSync;
    let opened: number | undefined;
    mock.method(fs, 'openSync', (file: fs.PathLike, flags: string | number, mode?: fs.Mode) => {
      const isCaptureRead = file === path && typeof flags === 'number';
      if (isCaptureRead) {
        fs.renameSync(path, join(backendDirectory, 'original.txt'));
        fs.writeFileSync(path, serialize({ eventName: 'backend.started' }));
      }
      const descriptor = originalOpen(file, flags, mode);
      if (isCaptureRead) opened = descriptor;
      return descriptor;
    });
    expect(captureElectronBackendStartupLogs(input)).toEqual({ ...emptyCapture('partial'), issues: ['unsafeFile'] });
    expect(opened).toBeDefined();
    expect(() => fs.fstatSync(opened!)).toThrow();
  });

  test('rejects hardlinks, nonregular candidates and linked jsonl directories', () => {
    const path = join(backendDirectory, 'hardlink.jsonl');
    fs.writeFileSync(path, serialize({ eventName: 'backend.starting' }));
    fs.linkSync(path, join(input.runRoot, 'same-file.txt'));
    fs.mkdirSync(join(backendDirectory, 'directory.jsonl'));
    const target = join(input.runRoot, 'link-target');
    fs.mkdirSync(target);
    const linked = join(backendDirectory, 'linked.jsonl');
    fs.symlinkSync(target, linked, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      expect(captureElectronBackendStartupLogs(input)).toEqual({ ...emptyCapture('partial'), issues: ['unsafeFile'] });
    } finally { fs.rmSync(linked); }
  });

  test('rejects linked userData and original linked or noncanonical path segments', () => {
    const alias = join(input.runRoot, 'alias');
    fs.symlinkSync(input.userDataPath, alias, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      for (const userDataPath of [alias, `${alias}${sep}..${sep}${sep}scenario${sep}desktop-user-data`]) {
        expect(captureElectronBackendStartupLogs({ ...input, userDataPath })).toEqual({ ...emptyCapture('unavailable'), issues: ['unsafeRoot'] });
      }
    } finally { fs.rmSync(alias); }
    const runtime = join(input.userDataPath, 'runtime');
    const relocated = join(input.runRoot, 'relocated-runtime');
    fs.renameSync(runtime, relocated);
    fs.symlinkSync(relocated, runtime, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      expect(captureElectronBackendStartupLogs(input)).toEqual({ ...emptyCapture('unavailable'), issues: ['unsafeRoot'] });
    } finally { fs.rmSync(runtime); }
  });

  test('rejects linked or nested run roots and userData outside the exact owned root', () => {
    const alias = createE2eRunRoot();
    fs.rmSync(alias, { recursive: true });
    fs.symlinkSync(input.runRoot, alias, process.platform === 'win32' ? 'junction' : 'dir');
    rootAliases.push(alias);
    const otherRoot = createE2eRunRoot();
    additionalRoots.push(otherRoot);
    const attempts = [
      { ...input, runRoot: alias, userDataPath: join(alias, 'scenario', 'desktop-user-data') },
      { ...input, runRoot: join(input.runRoot, 'run-nested') },
      { ...input, runRoot: dirname(input.runRoot) },
      { ...input, userDataPath: otherRoot },
      { ...input, userDataPath: input.runRoot },
      { ...input, runRoot: 'relative/run-invalid' },
      { ...input, runRoot: `${input.runRoot}\0` },
    ];
    for (const attempt of attempts) {
      expect(captureElectronBackendStartupLogs(attempt)).toEqual({ ...emptyCapture('unavailable'), issues: ['unsafeRoot'] });
    }
  });

  test('rejects invalid runtime identity before directory access', () => {
    const originalOpenDirectory = fs.opendirSync;
    const open = mock.method(fs, 'opendirSync', originalOpenDirectory);
    for (const runtimeInstanceId of ['', 'synthetic-private-session', '../outside']) {
      expect(captureElectronBackendStartupLogs({ ...input, runtimeInstanceId })).toEqual({ ...emptyCapture('unavailable'), issues: ['invalidRuntimeIdentity'] });
    }
    expect(open.mock.callCount()).toBe(0);
  });

  function writeLines(name: string, values: readonly unknown[]): void {
    fs.writeFileSync(join(backendDirectory, name), values.map((value) => `${JSON.stringify(value)}\n`).join(''));
  }
});

function buildEvent(input: BackendOperationalEventInput, runtimeInstanceId = currentRuntime): BackendOperationalEvent {
  return createBackendOperationalEvent<BackendOperationalEventInput>(input, {
    appVersion: '0.0.0-e2e', buildRevision: 'development', runtimeInstanceId,
    eventId: 'synthetic-event', timestamp: '2026-09-25T00:00:00.000Z',
  });
}

function serialize(input: BackendOperationalEventInput): string {
  return `${JSON.stringify(buildEvent(input))}\n`;
}

function pair(eventName: string, outcome = 'success') { return { eventName, outcome }; }

function emptyCapture(status: 'captured' | 'partial' | 'unavailable') {
  return { status, issues: [], startup: [], shutdown: [] };
}
