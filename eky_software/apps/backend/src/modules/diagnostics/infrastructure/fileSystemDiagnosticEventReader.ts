import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setImmediate } from 'node:timers/promises';

import { observeDiagnosticReadFailure } from '../application/observeDiagnosticReadFailure.js';
import { DiagnosticBrowseError, DiagnosticBrowseLimitError, diagnosticBrowsePolicy,
  type DiagnosticBrowsePolicy } from '../domain/diagnosticBrowsePolicy.js';
import type { DiagnosticBrowseQuery, DiagnosticEventPage, DiagnosticReadyPage, DiagnosticPageDirection } from '../domain/diagnosticEventPage.js';
import { createDiagnosticReadState, notConfiguredDiagnosticReadState, unavailableDiagnosticReadState } from '../domain/diagnosticReadState.js';
import type { DiagnosticReadFailureObserver } from '../ports/diagnosticReadFailureObserver.js';
import { captureDiagnosticBrowseSources, diagnosticSnapshotStateBytes,
  type DiagnosticBrowseSnapshot, type DiagnosticReadHandle } from './diagnosticBrowseSources.js';
import { maximumDiagnosticMetadataPerUnit, scanDiagnosticPage, type DiagnosticBoundary, type DiagnosticScannedPage,
  type DiagnosticScanDirection, type DiagnosticScanProgress } from './scanDiagnosticPage.js';

type Navigation = { token: string; boundary: DiagnosticBoundary;
  direction: DiagnosticScanDirection; result?: DiagnosticEventPage };
type Frame = { page: DiagnosticReadyPage; navigation: Navigation[] };
type Job = { iterator: AsyncGenerator<DiagnosticScanProgress, DiagnosticScannedPage>;
  cursor: string; origin?: Navigation; steps: number; work: number;
  progress: DiagnosticScanProgress; assertActive: () => void };
type Session = { actor: string; limit: number; created: number; touched: number;
  snapshot?: DiagnosticBrowseSnapshot; frames: Frame[]; job?: Job;
  replay?: { token: string; result: DiagnosticEventPage }; active: boolean };
const limitedPage = (): DiagnosticEventPage => ({ state: 'limited', diagnosticEvents: [],
  readState: { status: 'partial', reasons: ['limitReached'] } });
const unavailablePage = (): DiagnosticEventPage => ({ state: 'unavailable', diagnosticEvents: [],
  readState: unavailableDiagnosticReadState });
const stale = () => new DiagnosticBrowseError('diagnostic_browse_stale');

export class FileSystemDiagnosticEventReader {
  readonly #logsRoot: string;
  readonly #failureObserver: DiagnosticReadFailureObserver | undefined;
  readonly #policy: DiagnosticBrowsePolicy;
  readonly #now: () => number;
  readonly #sessions = new Set<Session>();
  readonly #handles = new Set<DiagnosticReadHandle>();
  #inFlight: Promise<DiagnosticEventPage> | undefined;
  #closing = false;
  #closePromise: Promise<void> | undefined;
  #expiryTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(logsRoot: string, failureObserver?: DiagnosticReadFailureObserver,
    options: { policy?: Partial<DiagnosticBrowsePolicy>; now?: () => number } = {}) {
    if (resolve(logsRoot) !== logsRoot) throw new Error('Diagnostic logs root must be absolute.');
    this.#logsRoot = logsRoot;
    this.#failureObserver = failureObserver;
    this.#policy = { ...diagnosticBrowsePolicy, ...options.policy };
    for (const [key, value] of Object.entries(this.#policy)) {
      if (!Number.isSafeInteger(value) || value < 1 || value > diagnosticBrowsePolicy[key as keyof DiagnosticBrowsePolicy]) {
        throw new Error('Diagnostic browse policy is invalid.');
      }
    }
    if (this.#policy.stepBytes < this.#policy.chunkBytes) throw new Error('Diagnostic read step is invalid.');
    if (this.#policy.stepMetadata < maximumDiagnosticMetadataPerUnit) throw new Error('Diagnostic metadata step is invalid.');
    this.#now = options.now ?? (() => performance.now());
  }

  browseDiagnosticEvents(query: DiagnosticBrowseQuery, actor: string): Promise<DiagnosticEventPage> {
    if (this.#closing) return Promise.reject(stale());
    if (this.#handles.size > 0 && this.#inFlight === undefined) return Promise.resolve(unavailablePage());
    if (this.#inFlight !== undefined) return Promise.reject(new DiagnosticBrowseError('diagnostic_browse_busy'));
    const work = this.#browse(query, actor);
    this.#inFlight = work;
    void work.then(() => this.#settled(work), () => this.#settled(work));
    return work;
  }

  close(): Promise<void> {
    if (this.#closePromise !== undefined) return this.#closePromise;
    this.#closing = true;
    clearTimeout(this.#expiryTimer);
    this.#closePromise = (async () => {
      // A disconnected HTTP request may still own a real file read.
      try { await this.#inFlight; } catch { /* The request owns its public failure. */ }
      for (const session of this.#sessions) await session.job?.iterator.return(undefined as never);
      this.#sessions.clear();
      const closed = await Promise.allSettled([...this.#handles].map(async handle => {
        await handle.close();
        this.#handles.delete(handle);
      }));
      for (const result of closed) if (result.status === 'rejected') throw result.reason;
    })();
    return this.#closePromise;
  }

  async #browse(query: DiagnosticBrowseQuery, actor: string): Promise<DiagnosticEventPage> {
    this.#expire();
    let session: Session;
    let consumed: string;
    if (query.cursor === undefined) {
      if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > this.#policy.maximumLimit) throw stale();
      if (this.#sessions.size >= this.#policy.sessions) {
        const oldest = [...this.#sessions].filter(value => !value.active).sort((a, b) => a.touched - b.touched)[0];
        if (oldest === undefined) throw new DiagnosticBrowseError('diagnostic_browse_busy');
        this.#sessions.delete(oldest);
      }
      const at = this.#now();
      session = { actor, limit: query.limit, created: at, touched: at, frames: [], active: false };
      this.#sessions.add(session);
      session.job = this.#createJob(session, null, 'older');
      consumed = session.job.cursor;
    } else {
      const found = [...this.#sessions].find(value => value.actor === actor && (
        value.job?.cursor === query.cursor || value.replay?.token === query.cursor
        || value.frames.some(frame => frame.navigation.some(nav => nav.token === query.cursor))));
      if (found === undefined) throw stale();
      session = found;
      session.touched = this.#now();
      const navigation = session.frames.flatMap(frame => frame.navigation).find(nav => nav.token === query.cursor);
      if (navigation === undefined && session.replay?.token === query.cursor) return structuredClone(session.replay.result);
      if (navigation !== undefined) {
        if (session.job?.origin === navigation) return { state: 'scanning', cursor: session.job.cursor };
        if (navigation.result !== undefined) return structuredClone(navigation.result);
        if (session.job !== undefined) throw new DiagnosticBrowseError('diagnostic_browse_busy');
        session.job = this.#createJob(session, navigation.boundary, navigation.direction, navigation);
      }
      consumed = query.cursor;
    }
    session.active = true;
    const job = session.job!;
    const started = this.#now();
    const before = { ...job.progress };
    job.steps++;
    job.assertActive = () => this.#assertActive(session, job, started);
    let result: DiagnosticEventPage;
    try {
      while (true) {
        job.assertActive();
        const step = await job.iterator.next();
        job.assertActive();
        if (step.done) {
          result = this.#publish(session, step.value);
          if (job.origin !== undefined) job.origin.result = result;
          delete session.job;
          break;
        }
        job.progress = step.value;
        this.#assertMemory(session);
        if (job.progress.bytes > (session.snapshot?.bytes ?? this.#policy.sourceBytes) * 2) throw new DiagnosticBrowseLimitError();
        await setImmediate();
        if (job.progress.bytes - before.bytes + this.#policy.chunkBytes > this.#policy.stepBytes
          || job.progress.chunks - before.chunks >= this.#policy.stepChunks
          || job.progress.metadata - before.metadata + maximumDiagnosticMetadataPerUnit > this.#policy.stepMetadata
          || this.#now() - started >= this.#policy.stepMilliseconds) {
          job.cursor = token();
          result = { state: 'scanning', cursor: job.cursor };
          break;
        }
      }
      this.#assertMemory(session);
    } catch (error) {
      await job.iterator.return(undefined as never);
      delete session.job;
      if (error instanceof DiagnosticBrowseError || this.#closing || this.#expired(session) || (session.snapshot !== undefined && isMissing(error))) {
        this.#sessions.delete(session);
        if (!(error instanceof DiagnosticBrowseError)) observeDiagnosticReadFailure(this.#failureObserver, error);
        throw error instanceof DiagnosticBrowseError ? error : stale();
      }
      if (error instanceof DiagnosticBrowseLimitError) result = limitedPage();
      else {
        observeDiagnosticReadFailure(this.#failureObserver, error);
        result = unavailablePage();
      }
      if (session.frames.length === 0) this.#sessions.delete(session);
    } finally {
      job.work += this.#now() - started;
      session.active = false;
      session.touched = this.#now();
    }
    session.replay = { token: consumed, result };
    return structuredClone(result);
  }

  #createJob(session: Session, boundary: DiagnosticBoundary | null,
    direction: DiagnosticScanDirection, origin?: Navigation): Job {
    const job: Job = { cursor: token(), steps: 0, work: 0,
      progress: { bytes: 0, chunks: 0, metadata: 0, stateBytes: 0 }, assertActive: () => {},
      iterator: undefined as never, ...(origin === undefined ? {} : { origin }) };
    const reader = this;
    job.iterator = (async function* () {
      const assertActive = () => job.assertActive();
      if (session.snapshot === undefined) {
        const capture = captureDiagnosticBrowseSources(reader.#logsRoot, reader.#policy, assertActive, reader.#handles, reader.#failureObserver);
        try {
          while (true) {
            const next = await capture.next();
            if (next.done) { session.snapshot = next.value; break; }
            job.progress.metadata += next.value;
            yield { ...job.progress };
          }
        } finally { await capture.return(undefined as never); }
      }
      return yield* scanDiagnosticPage(session.snapshot, boundary, session.limit, direction, reader.#policy, assertActive, reader.#handles, job.progress.metadata, reader.#failureObserver);
    })();
    return job;
  }

  #publish(session: Session, scanned: DiagnosticScannedPage): DiagnosticEventPage {
    const snapshot = session.snapshot!;
    const readState = createDiagnosticReadState(snapshot.issues,
      snapshot.sources.length > 0 || !snapshot.issues.has('sourceUnavailable'));
    if (readState.status === 'unavailable') return unavailablePage();
    const navigation: Navigation[] = [];
    const direction = (hasMore: boolean, boundary: DiagnosticBoundary | null, value: DiagnosticScanDirection): DiagnosticPageDirection => {
      if (hasMore && boundary !== null) {
        const cursor = token();
        navigation.push({ token: cursor, boundary, direction: value });
        return { state: 'available', cursor };
      }
      return { state: readState.status === 'complete' ? 'end' : 'unknown' };
    };
    const page: DiagnosticReadyPage = { state: 'ready', diagnosticEvents: scanned.events, readState,
      older: direction(scanned.hasOlder, scanned.olderBoundary, 'older'),
      newer: direction(scanned.hasNewer, scanned.newerBoundary, 'newer') };
    const frames = [...session.frames, { page, navigation }].slice(-2);
    this.#assertMemory(session, frames, page);
    session.frames = frames;
    return page;
  }

  #assertActive(session: Session, job: Job, started: number): void {
    if (this.#closing || this.#expired(session)) throw stale();
    if (job.steps > this.#policy.maximumSteps || job.work + this.#now() - started >= this.#policy.workMilliseconds) {
      throw new DiagnosticBrowseLimitError();
    }
  }

  #assertMemory(session: Session, frames = session.frames, result?: DiagnosticEventPage): void {
    const stored = Buffer.byteLength(JSON.stringify({ frames, replay: session.replay, result }));
    const snapshot = session.snapshot === undefined ? 0 : diagnosticSnapshotStateBytes(session.snapshot);
    if (stored + snapshot + (session.job?.progress.stateBytes ?? 0) > this.#policy.stateBytes) {
      throw new DiagnosticBrowseLimitError();
    }
  }

  #expired(session: Session): boolean {
    return this.#now() - session.created >= this.#policy.lifetimeMilliseconds
      || this.#now() - session.touched >= this.#policy.idleMilliseconds;
  }

  #expire(): void {
    for (const session of this.#sessions) if (!session.active && this.#expired(session)) this.#sessions.delete(session);
  }

  #settled(work: Promise<DiagnosticEventPage>): void {
    if (this.#inFlight === work) this.#inFlight = undefined;
    this.#expire();
    clearTimeout(this.#expiryTimer);
    if (this.#closing || this.#sessions.size === 0) return;
    const next = Math.min(...[...this.#sessions].map(session => Math.min(
      session.touched + this.#policy.idleMilliseconds, session.created + this.#policy.lifetimeMilliseconds)));
    this.#expiryTimer = setTimeout(() => {
      this.#expire();
      if (this.#inFlight === undefined) this.#settled(work);
    }, Math.max(1, next - this.#now()));
    this.#expiryTimer.unref();
  }
}

export const emptyDiagnosticEventReader = Object.freeze({
  async browseDiagnosticEvents(): Promise<DiagnosticEventPage> {
    return { state: 'unavailable', diagnosticEvents: [], readState: notConfiguredDiagnosticReadState };
  },
  async close(): Promise<void> {},
});

function token(): string { return randomBytes(24).toString('base64url'); }
function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
