import { join } from 'node:path';

import { WorkspaceLegacyAdoptionError } from './workspaceLegacyAdoptionError.js';
import { assertAdoptionMutationCurrent, captureAdoptionMutationAuthority, captureAdoptionRootPaths,
  directoryIdentity, observeAdoptionMutationFailure, samePath,
  type WorkspaceLegacyAdoptionMutationAuthority,
  type WorkspaceLegacyAdoptionRootReceiptSelection } from './workspaceLegacyAdoptionMutationAuthority.js';
import type { WorkspaceLegacyAdoptionPaths } from './workspaceLegacyAdoptionPaths.js';

type Identity = Awaited<ReturnType<typeof directoryIdentity>>;
interface RootEntry { readonly path: string; readonly privateMode: boolean; identity: Identity }
interface RootState {
  readonly entries: RootEntry[];
  active?: WorkspaceLegacyAdoptionRootSelection | undefined;
  failure?: { reason: unknown; completion?: AggregateError } | undefined;
}
export interface WorkspaceLegacyAdoptionRootObservation {
  assertObservedCurrent(): Promise<void>;
  forPhase(authority: WorkspaceLegacyAdoptionMutationAuthority): WorkspaceLegacyAdoptionRootSelection;
}
export interface WorkspaceLegacyAdoptionRootMutationSelection extends WorkspaceLegacyAdoptionRootReceiptSelection {
  readonly authority: WorkspaceLegacyAdoptionMutationAuthority;
}

// One attempt's directory identities and own receipts, independent of phase lifetime.
export class WorkspaceLegacyAdoptionRootSelection {
  private readonly authority: WorkspaceLegacyAdoptionMutationAuthority;

  private constructor(private readonly paths: Readonly<WorkspaceLegacyAdoptionPaths>,
    authority: WorkspaceLegacyAdoptionMutationAuthority, private readonly state: RootState) {
    const captured = captureAdoptionMutationAuthority(authority);
    if (captured === undefined) throw required();
    this.authority = captured;
  }

  static async observe(input: Readonly<WorkspaceLegacyAdoptionPaths>,
    authority: Omit<WorkspaceLegacyAdoptionMutationAuthority, 'assertCurrent'>,
  ): Promise<Readonly<WorkspaceLegacyAdoptionRootObservation>> {
    const selected = new WorkspaceLegacyAdoptionRootSelection(captureAdoptionRootPaths(input), {
      assertMutationCurrent: authority.assertMutationCurrent.bind(authority),
      onUncertain: authority.onUncertain.bind(authority),
      async assertCurrent() { throw required(); },
    }, { entries: [] });
    await selected.run(async () => {
      const paths = selected.paths;
      for (const path of [paths.userDataRoot, paths.operationsRoot, paths.workspacesRoot, paths.operationRoot,
        paths.candidateRoot, paths.candidateRuntimeRoot, paths.finalRoot, join(paths.finalRoot, 'runtime'), paths.legacyRuntimeRoot]) {
        const privateMode = path !== paths.userDataRoot && path !== paths.legacyRuntimeRoot;
        const identity = await directoryIdentity(path, privateMode, selected.phaseAuthority);
        selected.assertMutationCurrent();
        if (path === paths.userDataRoot && identity === undefined) throw required();
        selected.state.entries.push({ path, privateMode, identity });
      }
      await selected.assertRoots();
    });
    return Object.freeze({ assertObservedCurrent: () => selected.assertObservedCurrent(),
      forPhase: (phase: WorkspaceLegacyAdoptionMutationAuthority) => selected.forPhase(phase) });
  }

  forPhase(authority: WorkspaceLegacyAdoptionMutationAuthority): WorkspaceLegacyAdoptionRootSelection {
    return new WorkspaceLegacyAdoptionRootSelection(this.paths, authority, this.state);
  }

  assertCurrent(): Promise<void> { return this.run(() => this.assertSelected()); }

  // No external callback, repair, receipt update or mutation is allowed in this leaf.
  assertObservedCurrent(): Promise<void> { return this.run(() => this.assertRoots()); }

  assertRecoveredPayloadAbsent(): Promise<void> {
    return this.run(async () => {
      for (const path of [this.paths.operationRoot, this.paths.candidateRoot,
        this.paths.candidateRuntimeRoot, this.paths.finalRoot, join(this.paths.finalRoot, 'runtime')]) {
        if (this.entry(path).identity !== undefined) throw required();
      }
      // A readonly leaf: never re-enter metadata from its journal writer.
      await this.assertRoots();
    });
  }

  async runRead<T>(paths: Readonly<WorkspaceLegacyAdoptionPaths>, work: () => Promise<T>): Promise<T> {
    let readFailure: { reason: unknown } | undefined;
    const outcome = await this.run(async () => {
      this.assertPaths(paths);
      await this.assertSelected();
      let result: { ok: true; value: T } | { ok: false; reason: unknown };
      try { result = { ok: true, value: await work() }; }
      catch (reason) { readFailure = { reason }; result = { ok: false, reason }; }
      await this.assertSelected();
      return result;
    }, () => readFailure);
    // A completed readonly content failure is not an uncertain filesystem effect.
    if (!outcome.ok) throw outcome.reason;
    return outcome.value;
  }

  runMutation<T>(paths: Readonly<WorkspaceLegacyAdoptionPaths>,
    work: (selection: WorkspaceLegacyAdoptionRootMutationSelection) => Promise<T>): Promise<T> {
    return this.run(async () => {
      this.assertPaths(paths);
      await this.assertSelected();
      let open = true;
      const assertInvocation = () => {
        if (!open || this.state.active !== this) throw required();
        this.assertMutationCurrent();
      };
      const call = async <R>(callback: () => Promise<R>): Promise<R> => {
        assertInvocation();
        const result = await callback();
        assertInvocation();
        return result;
      };
      let result: T;
      try {
        result = await work(Object.freeze({
          authority: Object.freeze({
            assertCurrent: () => call(() => this.authority.assertCurrent()),
            assertMutationCurrent: assertInvocation,
            onUncertain: (error: unknown) => { if (open && this.state.active === this) this.onUncertain(error); },
          }),
          assertCurrent: () => call(() => this.assertRoots()),
          acknowledgeCreatedDirectory: (path: string) => call(() => this.acknowledgeCreatedDirectory(path)),
          acknowledgePublishedCandidate: () => call(() => this.acknowledgePublishedCandidate()),
          acknowledgeRemovedRoot: (path: string) => call(() => this.acknowledgeRemovedRoot(path)),
        }));
      } finally { open = false; }
      await this.assertSelected();
      return result;
    });
  }

  private get phaseAuthority(): WorkspaceLegacyAdoptionMutationAuthority {
    return Object.freeze({
      assertCurrent: async () => { this.assertMutationCurrent(); await this.authority.assertCurrent(); this.assertMutationCurrent(); },
      assertMutationCurrent: () => this.assertMutationCurrent(),
      onUncertain: (error: unknown) => this.onUncertain(error),
    });
  }

  private assertPaths(paths: Readonly<WorkspaceLegacyAdoptionPaths>) {
    const captured = captureAdoptionRootPaths(paths);
    if (Object.entries(this.paths).some(([key, value]) => !samePath(value, captured[key as keyof WorkspaceLegacyAdoptionPaths]))) throw required();
  }

  private assertMutationCurrent() {
    if (this.state.failure !== undefined) throw this.state.failure.reason;
    assertAdoptionMutationCurrent(this.authority);
  }

  private async assertSelected() {
    this.assertMutationCurrent();
    await this.authority.assertCurrent();
    this.assertMutationCurrent();
    await this.assertRoots();
  }

  private async assertRoots(excluded: readonly string[] = []) {
    this.assertMutationCurrent();
    for (const entry of this.state.entries) {
      if (excluded.some(path => samePath(entry.path, path))) continue;
      const current = await directoryIdentity(entry.path, entry.privateMode, this.phaseAuthority);
      this.assertMutationCurrent();
      if (!sameIdentity(entry.identity, current)) throw required();
    }
  }

  private entry(path: string) {
    const entry = this.state.entries.find(value => samePath(value.path, path));
    if (entry === undefined) throw required();
    return entry;
  }

  private async acknowledgeCreatedDirectory(path: string) {
    this.assertMutationCurrent();
    const entry = this.entry(path);
    if (entry.identity !== undefined || samePath(path, this.paths.legacyRuntimeRoot) || samePath(path, this.paths.finalRoot) ||
        samePath(path, join(this.paths.finalRoot, 'runtime'))) throw required();
    const created = await directoryIdentity(entry.path, entry.privateMode, this.phaseAuthority);
    this.assertMutationCurrent();
    if (created === undefined) throw required();
    await this.assertRoots([entry.path]);
    if (!sameIdentity(created, await directoryIdentity(entry.path, entry.privateMode, this.phaseAuthority))) throw required();
    this.assertMutationCurrent();
    entry.identity = created;
  }

  private async acknowledgePublishedCandidate() {
    this.assertMutationCurrent();
    const { candidateRoot, candidateRuntimeRoot, finalRoot } = this.paths;
    const finalRuntimeRoot = join(finalRoot, 'runtime');
    const candidate = this.entry(candidateRoot), runtime = this.entry(candidateRuntimeRoot);
    const final = this.entry(finalRoot), finalRuntime = this.entry(finalRuntimeRoot);
    if (candidate.identity === undefined || runtime.identity === undefined || final.identity !== undefined || finalRuntime.identity !== undefined) throw required();
    const candidateIdentity = candidate.identity, runtimeIdentity = runtime.identity;
    const moved = [candidateRoot, candidateRuntimeRoot, finalRoot, finalRuntimeRoot];
    await this.assertRoots(moved);
    for (const [path, expected] of [[candidateRoot, undefined], [candidateRuntimeRoot, undefined],
      [finalRoot, candidateIdentity], [finalRuntimeRoot, runtimeIdentity]] as const) {
      if (!sameIdentity(expected, await directoryIdentity(path, true, this.phaseAuthority))) throw required();
      this.assertMutationCurrent();
    }
    await this.assertRoots(moved);
    candidate.identity = undefined;
    runtime.identity = undefined;
    final.identity = candidateIdentity;
    finalRuntime.identity = runtimeIdentity;
  }

  private async acknowledgeRemovedRoot(path: string) {
    this.assertMutationCurrent();
    const { operationRoot, candidateRoot, candidateRuntimeRoot, finalRoot } = this.paths;
    const removed = samePath(path, operationRoot) ? [operationRoot, candidateRoot, candidateRuntimeRoot]
      : samePath(path, finalRoot) ? [finalRoot, join(finalRoot, 'runtime')] : undefined;
    if (removed === undefined || this.entry(path).identity === undefined) throw required();
    await this.assertRoots(removed);
    for (const root of removed) {
      if (await directoryIdentity(root, true, this.phaseAuthority) !== undefined) throw required();
      this.assertMutationCurrent();
    }
    await this.assertRoots(removed);
    for (const root of removed) this.entry(root).identity = undefined;
  }

  private onUncertain(reason: unknown) {
    if (this.state.failure !== undefined) {
      if (reason instanceof AggregateError && reason.errors.includes(this.state.failure.reason)) this.state.failure.completion = reason;
      return;
    }
    this.state.failure = { reason };
    observeAdoptionMutationFailure(this.authority, reason);
  }

  private async run<T>(work: () => Promise<T>, readFailure?: () => { reason: unknown } | undefined): Promise<T> {
    // An expired idle view cannot poison its successor. In-flight loss is sticky.
    assertAdoptionMutationCurrent(this.authority);
    if (this.state.active !== undefined || this.state.failure !== undefined) {
      this.onUncertain(required());
      throw required(this.state.failure?.completion ?? this.state.failure?.reason);
    }
    this.state.active = this;
    try {
      this.assertMutationCurrent();
      const result = await work();
      this.assertMutationCurrent();
      return result;
    } catch (error) {
      const preceding = readFailure?.();
      this.onUncertain(preceding === undefined ? error
        : new AggregateError([preceding.reason, error], 'Adoption root read validation failed'));
      throw required(this.state.failure!.completion ?? this.state.failure!.reason);
    }
    finally { this.state.active = undefined; }
  }
}

function sameIdentity(left: Identity, right: Identity) {
  return left === undefined ? right === undefined : right !== undefined && left.dev === right.dev && left.ino === right.ino;
}

function required(cause?: unknown) {
  const error = new WorkspaceLegacyAdoptionError('WORKSPACE_ADOPTION_RECOVERY_REQUIRED');
  if (cause !== undefined) error.cause = cause;
  return error;
}
