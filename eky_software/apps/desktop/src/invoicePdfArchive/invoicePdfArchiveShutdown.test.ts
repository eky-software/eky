import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { InvoicePdfArchiveService } from './invoicePdfArchiveService.js';
import { InvoicePdfArchiveConfigStore } from './invoicePdfArchiveConfig.js';
import { InvoicePdfArchiveJournalStore } from './invoicePdfArchiveJournal.js';
import { createInvoicePdfArchiveRuntimePaths } from './invoicePdfArchivePaths.js';
import type { InvoicePdfArchiveTask } from './invoicePdfArchiveTypes.js';
import type { LoadInvoicePdfArchiveDocument } from './invoicePdfArchiveFileCopy.js';
import { createInvoicePdfArchiveCapability } from './invoicePdfArchiveCapability.js';
import { chooseInvoicePdfArchiveDirectoryIpcChannel } from './invoicePdfArchiveCapabilityTypes.js';
import { startInvoicePdfArchiveBrokerMain } from './invoicePdfArchiveBrokerMain.js';
import { createInvoicePdfArchiveBrokerRequest } from './invoicePdfArchiveBrokerProtocol.js';

const faults = vi.hoisted(() => ({
  scope: '', closeFails: false, writeFails: false,
  openHandles: [] as FileHandle[],
  closeGate: undefined as undefined | (() => Promise<void>),
}));

vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>();
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args);
      if (!faults.scope || !String(args[0]).includes(faults.scope)) return handle;
      return new Proxy(handle, {
        get(target, property) {
          if (property === 'writeFile' && faults.writeFails) return async () => {
            throw new Error('SYNTHETIC_FIRST_WRITE_FAILURE');
          };
          if (property === 'close') return async () => {
            if (faults.closeGate) await faults.closeGate();
            if (faults.closeFails) {
              faults.openHandles.push(handle);
              throw new Error('SYNTHETIC_CLOSE_UNCERTAIN');
            }
            return handle.close();
          };
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
});

let cleanupCompleted = false;
beforeEach(() => { cleanupCompleted = false; });
const releases: Array<() => void> = [];
const pending: Promise<unknown>[] = [];
function track<T>(work: Promise<T>): Promise<T> {
  pending.push(work);
  void work.catch(() => undefined);
  return work;
}

afterEach(async () => {
  for (const release of releases.splice(0)) release();
  await Promise.allSettled(pending.splice(0));
  // Only test-owned injected handles are closed; failed evidence is retained.
  faults.closeGate = undefined;
  faults.scope = '';
  faults.closeFails = false;
  faults.writeFails = false;
  const closes = await Promise.allSettled(faults.openHandles.splice(0).map(handle => handle.close()));
  vi.restoreAllMocks();
  vi.useRealTimers();
  const failures = closes.filter(result => result.status === 'rejected').map(result => result.reason);
  if (failures.length !== 0) throw new AggregateError(failures, 'ARCHIVE_TEST_HANDLE_CLEANUP_FAILED');
  cleanupCompleted = true;
});

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  releases.push(() => release());
  return { promise, release: () => release() };
}

const bytes = Buffer.from('%PDF-1.7\nsynthetic-w7-3');
function task(index = 1): InvoicePdfArchiveTask {
  return { attemptCount: 0, createdAt: '2026-10-27T00:00:00.000Z',
    deliveryEventId: `event-${index}`, documentId: `document-${index}`,
    expectedPdfSha256: createHash('sha256').update(bytes).digest('hex'),
    expectedPdfSize: bytes.length, invoiceId: `invoice-${index}`,
    invoiceKind: 'standard', invoiceNumber: `${index}`, lastSafeErrorCode: null,
    nextAttemptAt: '2026-10-27T00:00:00.000Z', schemaVersion: 1, taskId: `task-${index}` };
}
const document: LoadInvoicePdfArchiveDocument = async value => ({
  content: Uint8Array.from(bytes), documentId: value.documentId, invoiceId: value.invoiceId,
  mimeType: 'application/pdf', sha256: value.expectedPdfSha256, sizeBytes: bytes.length,
});

async function fixture(options: {
  loadDocument?: LoadInvoicePdfArchiveDocument;
  probeDirectory?: (path: string) => Promise<void>;
  enable?: boolean;
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'eky-archive-shutdown-'));
  onTestFinished(async ({ task }) => {
    if (task.result?.state === 'pass' && cleanupCompleted) {
      await rm(root, { recursive: true, force: true });
    }
  });
  const archive = join(root, 'archive');
  await mkdir(archive);
  const paths = createInvoicePdfArchiveRuntimePaths(join(root, 'profile'));
  const configStore = new InvoicePdfArchiveConfigStore(paths.configFilePath);
  const journalStore = new InvoicePdfArchiveJournalStore(paths.journalFilePath);
  const loadDocument = vi.fn(options.loadDocument ?? document);
  const service = new InvoicePdfArchiveService({ configStore, journalStore, loadDocument,
    ...(options.probeDirectory ? { probeDirectory: options.probeDirectory } : {}),
  });
  if (options.enable !== false) await service.chooseDirectory(archive);
  return { root, archive, paths, configStore, journalStore, loadDocument, service };
}

describe('InvoicePdfArchiveService shutdown', () => {
  it('preserves real normal archive bytes and durable success', async () => {
    const f = await fixture();
    expect(await f.service.queueTask(task())).toEqual({ archived: true, queued: true });
    expect(await f.service.sealAndDrain()).toBe('drained');
    expect(await readFile(join(f.archive, 'Lasku-1.pdf'))).toEqual(bytes);
    expect((await f.journalStore.get()).tasks).toEqual([]);
  });

  it('joins the started copy but rejects not-started and new commands', async () => {
    const started = gate(); const finish = gate();
    const f = await fixture({ loadDocument: async value => {
      started.release(); await finish.promise; return document(value);
    } });
    const first = track(f.service.queueTask(task()));
    await started.promise;
    const queued = track(f.service.queueTask(task(2))).catch(error => error);
    const drain = f.service.sealAndDrain();
    expect(f.service.sealAndDrain()).toBe(drain);
    await expect(f.service.queueTask(task(3))).rejects.toMatchObject({ code: 'ARCHIVE_REQUEST_FAILED' });
    expect(await queued).toMatchObject({ code: 'ARCHIVE_REQUEST_FAILED' });
    finish.release();
    expect(await first).toEqual({ archived: true, queued: true });
    expect(await queued).toMatchObject({ code: 'ARCHIVE_REQUEST_FAILED' });
    expect(await drain).toBe('drained');
    expect(f.loadDocument).toHaveBeenCalledTimes(1);
    expect(await readdir(f.archive)).toEqual(['Lasku-1.pdf']);
  });

  it('seals the interior of an already-started retry loop', async () => {
    const started = gate(); const finish = gate();
    const f = await fixture({ loadDocument: async value => {
      started.release(); await finish.promise; return document(value);
    } });
    await f.journalStore.queue(task()); await f.journalStore.queue(task(2));
    const retry = track(f.service.retryPending());
    await started.promise;
    const drain = f.service.sealAndDrain(); finish.release();
    await retry;
    expect(await drain).toBe('drained');
    expect(f.loadDocument).toHaveBeenCalledTimes(1);
    expect((await f.journalStore.get()).tasks).toEqual([task(2)]);
    expect(await readdir(f.archive)).toEqual(['Lasku-1.pdf']);
  });

  it('does not commit a late directory choice after its probe', async () => {
    const started = gate(); const finish = gate();
    const f = await fixture({ enable: false, probeDirectory: async () => {
      started.release(); await finish.promise;
    } });
    const choice = track(f.service.chooseDirectory(f.archive)).catch(error => error);
    await started.promise;
    const drain = f.service.sealAndDrain(); finish.release();
    expect(await choice).toMatchObject({ code: 'ARCHIVE_REQUEST_FAILED' });
    expect(await drain).toBe('drained');
    expect(await f.configStore.read()).toBeNull();
  });

  it('keeps ordinary completed copy failure separate from close uncertainty', async () => {
    const f = await fixture({ loadDocument: async () => { throw new Error('synthetic unavailable'); } });
    expect(await f.service.queueTask(task())).toEqual({ archived: false, queued: true });
    expect(await f.service.sealAndDrain()).toBe('drained');
    expect((await f.journalStore.get()).tasks).toHaveLength(1);
  });

  it('blocks a real capability late native selection without waiting for user input in the drain', async () => {
    const f = await fixture({ enable: false });
    const selected = gate(); const finish = gate();
    const handlers = new Map<string, (event: unknown) => Promise<unknown>>();
    const mainFrame = {};
    const webContents = Object.assign(new EventEmitter(), { mainFrame, isDestroyed: () => false });
    const mainWindow = Object.assign(new EventEmitter(), { webContents, isDestroyed: () => false });
    const onConfigurationChanged = vi.fn();
    const capability = createInvoicePdfArchiveCapability({
      confirmChange: async () => true, confirmDisable: async () => true,
      ipcMain: { handle: (key: string, handler: (event: unknown) => Promise<unknown>) => handlers.set(key, handler),
        removeHandler: (key: string) => handlers.delete(key) } as never,
      mainWindow: mainWindow as never,
      openPath: async () => '', onConfigurationChanged, showSafeError: vi.fn(),
      selectDirectory: async () => { selected.release(); await finish.promise; return f.archive; },
      service: f.service,
    });
    const invoke = handlers.get(chooseInvoicePdfArchiveDirectoryIpcChannel)!;
    const choice = track(invoke({ sender: webContents, senderFrame: mainFrame })).catch(error => error);
    await selected.promise;
    capability.dispose();
    expect(await f.service.sealAndDrain()).toBe('drained');
    finish.release();
    expect(await choice).toMatchObject({ message: 'INVOICE_PDF_ARCHIVE_OPERATION_FAILED' });
    expect(await f.configStore.read()).toBeNull();
    expect(onConfigurationChanged).not.toHaveBeenCalled();
  });

  it('proves existing broker close alone is not drain, then joins real service IO', async () => {
    const started = gate(); const finish = gate(); const completed = gate();
    const f = await fixture({ loadDocument: async value => {
      started.release(); await finish.promise; return document(value);
    } });
    let receive!: (value: unknown) => void;
    const send = vi.fn(); const close = vi.fn();
    const broker = startInvoicePdfArchiveBrokerMain({
      service: { queueTask: async value => {
        try { return await track(f.service.queueTask(value)); }
        finally { completed.release(); }
      } },
      transport: { send, close, subscribe: listener => { receive = listener; return () => {}; } },
    });
    const request = (index: number) => {
      const { attemptCount, lastSafeErrorCode, nextAttemptAt, schemaVersion, ...value } = task(index);
      return createInvoicePdfArchiveBrokerRequest({
        requestId: index === 1 ? '11111111-1111-4111-8111-111111111111' : '22222222-2222-4222-8222-222222222222',
        task: value,
      });
    };
    receive(request(1)); await started.promise; receive(request(2));
    expect(broker.close()).toBeUndefined();
    expect(close).toHaveBeenCalledOnce();
    const drain = f.service.sealAndDrain(); let settled = false;
    void drain.then(() => { settled = true; });
    await Promise.resolve(); expect(settled).toBe(false);
    finish.release(); await completed.promise;
    expect(await drain).toBe('drained');
    expect(f.loadDocument).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
    expect(await readdir(f.archive)).toEqual(['Lasku-1.pdf']);
  });

  it('times out at 5000ms, retains the journal and never upgrades late completion', async () => {
    const started = gate(); const finish = gate();
    const f = await fixture({ loadDocument: async value => {
      started.release(); await finish.promise; return document(value);
    } });
    const work = track(f.service.queueTask(task())); await started.promise;
    const queued = track(f.service.queueTask(task(2))).catch(error => error);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let now = 0; vi.spyOn(performance, 'now').mockImplementation(() => now);
    const drain = f.service.sealAndDrain(); let result: string | undefined;
    void drain.then(value => { result = value; });
    expect(await queued).toMatchObject({ code: 'ARCHIVE_REQUEST_FAILED' });
    now = 4999; await vi.advanceTimersByTimeAsync(4999);
    expect(result).toBeUndefined();
    now = 5000; await vi.advanceTimersByTimeAsync(1);
    expect(await drain).toBe('timedOut');
    // Raw read cannot run journal recovery while the old owner is still working.
    expect(JSON.parse(await readFile(f.paths.journalFilePath, 'utf8')).tasks).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    finish.release(); await work;
    expect(await f.service.sealAndDrain()).toBe('timedOut');
    expect(await readFile(join(f.archive, 'Lasku-1.pdf'))).toEqual(bytes);
    await expect(f.service.getStatus()).rejects.toMatchObject({ code: 'ARCHIVE_REQUEST_FAILED' });
  });

  it('uses the absolute deadline even when the timer callback has not run', async () => {
    const started = gate(); const finish = gate();
    const f = await fixture({ loadDocument: async value => {
      started.release(); await finish.promise; return document(value);
    } });
    const work = track(f.service.queueTask(task())); await started.promise;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let now = 0; vi.spyOn(performance, 'now').mockImplementation(() => now);
    const drain = f.service.sealAndDrain(); now = 5000; finish.release();
    await work;
    expect(await drain).toBe('timedOut'); expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the deadline timer on ordinary successful drain', async () => {
    const f = await fixture();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    expect(await f.service.sealAndDrain()).toBe('drained');
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['pdf', 'journal', 'probe'] as const)('retains real %s files on uncertain handle close', async kind => {
    const f = await fixture({ enable: kind !== 'probe' });
    faults.scope = kind === 'pdf' ? '.eky-invoice-pdf-' :
      kind === 'journal' ? f.paths.journalFilePath : '.eky-invoice-pdf-probe-';
    faults.closeFails = true;
    const work = kind === 'probe' ? f.service.chooseDirectory(f.archive) : f.service.queueTask(task());
    await expect(work).rejects.toMatchObject({ ioCompletionUncertain: true });
    expect(faults.openHandles).toHaveLength(1);
    expect(await f.service.sealAndDrain()).toBe('ioUncertain');
    if (kind === 'journal') {
      expect(JSON.parse(await readFile(`${f.paths.journalFilePath}.next`, 'utf8')).tasks).toHaveLength(1);
    } else {
      const retained = (await readdir(f.archive)).filter(name => name.endsWith('.next'));
      expect(retained).toHaveLength(1);
      expect(await readFile(join(f.archive, retained[0]!))).toEqual(kind === 'pdf'
        ? bytes : Buffer.from('Eky invoice PDF archive capability probe\n', 'utf8'));
      if (kind === 'pdf') {
        expect(JSON.parse(await readFile(f.paths.journalFilePath, 'utf8')).tasks).toEqual([task()]);
      }
    }
    await expect(f.service.queueTask(task(2))).rejects.toMatchObject({ code: 'ARCHIVE_REQUEST_FAILED' });
  });

  it('retains the first write error when close also fails', async () => {
    const f = await fixture();
    faults.scope = '.eky-invoice-pdf-'; faults.writeFails = true; faults.closeFails = true;
    await expect(f.service.queueTask(task())).rejects.toMatchObject({
      ioCompletionUncertain: true, cause: { message: 'SYNTHETIC_FIRST_WRITE_FAILURE' },
    });
    expect(await f.service.sealAndDrain()).toBe('ioUncertain');
  });

  it('retains the copied PDF and both journal states when success-record close is uncertain', async () => {
    const f = await fixture();
    let closes = 0;
    faults.scope = f.paths.journalFilePath;
    faults.closeGate = async () => { closes += 1; faults.closeFails = closes === 2; };
    await expect(f.service.queueTask(task())).rejects.toMatchObject({ ioCompletionUncertain: true });
    expect(closes).toBe(2);
    expect(await f.service.sealAndDrain()).toBe('ioUncertain');
    expect(await readFile(join(f.archive, 'Lasku-1.pdf'))).toEqual(bytes);
    expect(JSON.parse(await readFile(f.paths.journalFilePath, 'utf8')).tasks).toEqual([task()]);
    expect(JSON.parse(await readFile(`${f.paths.journalFilePath}.next`, 'utf8')).tasks).toEqual([]);
    expect(faults.openHandles).toHaveLength(1);
  });

  it('retains an uncertain config save instead of treating a finished probe as completed IO', async () => {
    const f = await fixture({ enable: false });
    faults.scope = f.paths.configFilePath;
    faults.closeFails = true;
    await expect(f.service.chooseDirectory(f.archive)).rejects.toMatchObject({ ioCompletionUncertain: true });
    expect(await f.service.sealAndDrain()).toBe('ioUncertain');
    await expect(readFile(f.paths.configFilePath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(JSON.parse(await readFile(`${f.paths.configFilePath}.next`, 'utf8')).enabled).toBe(true);
    expect(faults.openHandles).toHaveLength(1);
  });

  it('waits for the real started file close and journal finalization', async () => {
    const started = gate(); const finish = gate(); const f = await fixture();
    faults.scope = '.eky-invoice-pdf-';
    faults.closeGate = async () => { started.release(); await finish.promise; };
    const work = track(f.service.queueTask(task())); await started.promise;
    const drain = f.service.sealAndDrain(); let settled = false;
    void drain.then(() => { settled = true; });
    await Promise.resolve(); expect(settled).toBe(false);
    finish.release(); await work; expect(await drain).toBe('drained');
    expect((await f.journalStore.get()).tasks).toEqual([]);
    expect(await readdir(f.archive)).toEqual(['Lasku-1.pdf']);
  });
});
