import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBackendOperationalEvent } from '../../../observability/createOperationalEvent.js';
import { emptyDiagnosticEventReader, FileSystemDiagnosticEventReader } from './fileSystemDiagnosticEventReader.js';
import { FileSystemOperationalLogDiagnosticSummaryReader } from './fileSystemOperationalLogDiagnosticSummaryReader.js';

const faults = vi.hoisted(() => ({ denied: new Set<string>(), closeAfterRelease: false,
  metadataDenied: new Set<string>(), metadataReads: 0, directories: new Set<object>(), handles: new Set<number>() }));
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual,
    lstatSync: (...args: Parameters<typeof actual.lstatSync>) => {
      const path = String(args[0]);
      if (path.endsWith('.jsonl')) faults.metadataReads++;
      if (faults.metadataDenied.has(path)) throw new Error('synthetic metadata failure');
      return actual.lstatSync(...args);
    },
    openSync: (...args: Parameters<typeof actual.openSync>) => {
      if (faults.denied.has(String(args[0]))) {
        throw Object.assign(new Error('synthetic private open detail'), { code: 'EACCES' });
      }
      const fd = actual.openSync(...args);
      faults.handles.add(fd);
      return fd;
    },
    opendirSync: (...args: Parameters<typeof actual.opendirSync>) => {
      if (faults.denied.has(String(args[0]))) {
        throw Object.assign(new Error('synthetic private listing detail'), { code: 'EACCES' });
      }
      const dir = actual.opendirSync(...args);
      faults.directories.add(dir);
      const close = dir.closeSync.bind(dir);
      dir.closeSync = () => { close(); faults.directories.delete(dir); };
      return dir;
    },
    closeSync: (fd: number) => {
      actual.closeSync(fd);
      faults.handles.delete(fd);
      if (faults.closeAfterRelease) throw new Error('synthetic private close detail');
    },
  };
});

const roots: string[] = [];
afterEach(() => {
  expect(faults.handles.size).toBe(0);
  expect(faults.directories.size).toBe(0);
  faults.denied.clear();
  faults.metadataDenied.clear();
  faults.metadataReads = 0;
  faults.closeAfterRelease = false;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('diagnostic read coverage', () => {
  it('distinguishes unconfigured, missing and verified empty sources', async () => {
    const root = createRoot();
    expect(await emptyDiagnosticEventReader.listRecentDiagnosticEvents(10)).toEqual({
      diagnosticEvents: [], readState: { status: 'unavailable', reasons: ['notConfigured'] },
    });
    expect(await new FileSystemDiagnosticEventReader(join(root, 'missing')).listRecentDiagnosticEvents(10))
      .toEqual({ diagnosticEvents: [], readState: { status: 'unavailable', reasons: ['sourceUnavailable'] } });
    expect(await new FileSystemDiagnosticEventReader(root).listRecentDiagnosticEvents(10))
      .toEqual({ diagnosticEvents: [], readState: { status: 'complete', reasons: [] } });
    expect(await new FileSystemOperationalLogDiagnosticSummaryReader(root).readOperationalLogSummary())
      .toMatchObject({ operationalLogsAvailable: true, operationalLogTotalBytes: 0,
        operationalLogReadState: { status: 'complete', reasons: [] } });
  });

  it('retains valid observations beside malformed known rows and unknown exclusions', async () => {
    const root = createRoot();
    write(root, 'backend', 'backend-warning-error-2026-07-001.jsonl', [
      sourceEvent('safe'), '{broken', { ...sourceEvent('invalid'), message: 'private must not escape' },
      { component: 'backend', eventName: 'historical.unmapped.event', private: 'not projected' },
    ]);
    const result = await new FileSystemDiagnosticEventReader(root).listRecentDiagnosticEvents(10);
    expect(result.diagnosticEvents.map(event => event.id)).toEqual(['backend:safe']);
    expect(result.readState).toEqual({ status: 'partial', reasons: ['invalidEntries'] });
    const summary = await new FileSystemOperationalLogDiagnosticSummaryReader(root).readOperationalLogSummary();
    expect(summary.operationalLogReadState).toEqual(result.readState);
    expect(summary.latestErrorAt).toBe('2026-07-27T10:00:00.000Z');
    expect(JSON.stringify({ result, summary })).not.toMatch(/private|not projected|broken/);
  });

  it('keeps an intentionally excluded unknown family distinct from malformed data', async () => {
    const root = createRoot();
    write(root, 'backend', 'backend-info-2026-07-001.jsonl', [
      { component: 'backend', eventName: 'historical.unmapped.event' },
    ]);
    expect(await new FileSystemDiagnosticEventReader(root).listRecentDiagnosticEvents(10)).toEqual({
      diagnosticEvents: [], readState: { status: 'complete', reasons: [] },
    });
  });

  it('does not count directory enumeration as readable content when every candidate is unsafe or lost', async () => {
    const root = createRoot();
    const path = join(root, 'backend', 'backend-warning-error-2026-07-001.jsonl');
    mkdirSync(path, { recursive: true });
    const reader = new FileSystemDiagnosticEventReader(root);
    expect((await reader.listRecentDiagnosticEvents(10)).readState)
      .toEqual({ status: 'unavailable', reasons: ['sourceUnavailable'] });
    rmSync(path, { recursive: true });
    write(root, 'backend', 'backend-warning-error-2026-07-001.jsonl', [sourceEvent('lost-metadata')]);
    faults.metadataDenied.add(path);
    expect((await reader.listRecentDiagnosticEvents(10)).readState)
      .toEqual({ status: 'unavailable', reasons: ['sourceUnavailable'] });
  });

  it('distinguishes partial success from losing every admitted file', async () => {
    const root = createRoot();
    const denied = write(root, 'backend', 'backend-warning-error-2026-07-001.jsonl', [sourceEvent('denied')]);
    const healthy = write(root, 'security', 'backend-security-2026-07-001.jsonl', [sourceEvent('healthy')]);
    faults.denied.add(denied);
    const partial = await new FileSystemDiagnosticEventReader(root).listRecentDiagnosticEvents(10);
    expect(partial.readState).toEqual({ status: 'partial', reasons: ['sourceUnavailable'] });
    expect(partial.diagnosticEvents.map(event => event.id)).toEqual(['backend:healthy']);
    faults.denied.add(healthy);
    const unavailable = await new FileSystemDiagnosticEventReader(root).listRecentDiagnosticEvents(10);
    expect(unavailable).toEqual({ diagnosticEvents: [], readState: { status: 'unavailable', reasons: ['sourceUnavailable'] } });
    expect(await new FileSystemOperationalLogDiagnosticSummaryReader(root).readOperationalLogSummary())
      .toMatchObject({ operationalLogsAvailable: false, operationalLogTotalBytes: 0,
        operationalLogNewestMonth: null, latestErrorAt: null,
        operationalLogReadState: unavailable.readState });
  });

  it('contains one directory failure and also contains close failures after release', async () => {
    const root = createRoot();
    write(root, 'backend', 'backend-warning-error-2026-07-001.jsonl', [sourceEvent('denied')]);
    write(root, 'security', 'backend-security-2026-07-001.jsonl', [sourceEvent('healthy')]);
    faults.denied.add(join(root, 'backend'));
    faults.closeAfterRelease = true;
    const result = await new FileSystemDiagnosticEventReader(root).listRecentDiagnosticEvents(10);
    expect(result.readState).toEqual({ status: 'partial', reasons: ['sourceUnavailable'] });
    expect(result.diagnosticEvents.map(event => event.id)).toEqual(['backend:healthy']);
    expect(faults.handles.size).toBe(0);
  });

  it('marks source and result limits without claiming the end of history', async () => {
    const root = createRoot();
    const file = write(root, 'backend', 'backend-warning-error-2026-07-001.jsonl', [
      sourceEvent('older', '2026-07-27T09:00:00.000Z'), sourceEvent('newest'),
    ]);
    const result = await new FileSystemDiagnosticEventReader(root).listRecentDiagnosticEvents(1);
    expect(result.diagnosticEvents.map(event => event.id)).toEqual(['backend:newest']);
    expect(result.readState).toEqual({ status: 'partial', reasons: ['limitReached'] });
    writeFileSync(file, `${' '.repeat(256 * 1024)}\n${JSON.stringify(sourceEvent('tail'))}\n`);
    expect((await new FileSystemDiagnosticEventReader(root).listRecentDiagnosticEvents(10)).readState)
      .toEqual({ status: 'partial', reasons: ['limitReached'] });
  });

  it('enforces the existing file budget and does not follow arbitrary filenames', async () => {
    const root = createRoot();
    for (let month = 1; month <= 9; month++) {
      for (let segment = 1; segment <= 4; segment++) {
        write(root, 'backend', `backend-warning-error-2026-${String(month).padStart(2, '0')}-${String(segment).padStart(3, '0')}.jsonl`,
          [sourceEvent(`file-${month}-${segment}`)]);
      }
    }
    write(root, 'backend', 'arbitrary.jsonl', ['{private broken unowned file']);
    const result = await new FileSystemDiagnosticEventReader(root).listRecentDiagnosticEvents(100);
    expect(result.diagnosticEvents).toHaveLength(32);
    expect(faults.metadataReads).toBe(64);
    expect(result.readState).toEqual({ status: 'partial', reasons: ['limitReached'] });
  });
});

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'eky-diagnostic-coverage-'));
  roots.push(root);
  return root;
}

function write(root: string, directory: string, name: string, lines: unknown[]): string {
  mkdirSync(join(root, directory), { recursive: true });
  const file = join(root, directory, name);
  writeFileSync(file, `${lines.map(line => typeof line === 'string' ? line : JSON.stringify(line)).join('\n')}\n`);
  return file;
}

function sourceEvent(eventId: string, timestamp = '2026-07-27T10:00:00.000Z') {
  return createBackendOperationalEvent({ eventName: 'database.openFailed', errorCode: 'DATABASE_OPEN_FAILED' }, {
    appVersion: '1.0.0', buildRevision: 'abcdef123456', eventId, timestamp,
    runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
  });
}
