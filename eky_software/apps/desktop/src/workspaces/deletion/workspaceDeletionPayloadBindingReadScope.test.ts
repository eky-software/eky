import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { afterEach, expect, it, vi, type TestContext } from 'vitest';
import { removeWorkspaceEntry } from "../registry/workspaceRegistryMutations.js";
import { WORKSPACE_REGISTRY_FILE_NAME } from "../registry/workspaceRegistryPaths.js";
import { serializeWorkspaceRegistry, workspaceRegistryEntrySha256 } from "../registry/workspaceRegistrySerializer.js";
import { WorkspaceRegistryStore } from "../registry/workspaceRegistryStore.js";
import { createSwitchRegistry } from "../switch/workspaceSwitchTestSupport.js";
import { captureWorkspaceDeletionPayloadBinding } from "./workspaceDeletionPayloadBinding.js";
import { deletionTestDigest as hash, deletionTestId as id, deletionTestJournal } from "./workspaceDeletionDataTestSupport.js";
import { captureDeletionInventoryHeader, captureDeletionInventoryRecord } from "./workspaceDeletionInventoryCodec.js";
import { WorkspaceDeletionJournalStore, createWorkspaceDeletionJournalPaths } from "./workspaceDeletionJournalStore.js";
import { captureWorkspaceDeletionJournal } from "./workspaceDeletionJournalCodec.js";
import { captureWorkspaceDeletionPhaseSelection } from "./workspaceDeletionPhaseSelection.js";
import { workspaceRemnantBindingSha256 } from "./workspaceRemnantBindingCodec.js";
import { WorkspaceRemnantBindingStore } from "./workspaceRemnantBindingStore.js";
import { remnantBindingFixture } from "./workspaceRemnantBindingTestSupport.js";
const io = vi.hoisted(() => ({
  path: undefined as string | undefined,
  beforeOpen: undefined as (() => Promise<void>) | undefined,
  beforeRead: undefined as (() => Promise<void>) | undefined,
  afterRead: undefined as (() => Promise<void>) | undefined,
  beforeClose: undefined as (() => Promise<void>) | undefined,
  handles: [] as FileHandle[], live: new Set<FileHandle>(), opened: 0, closed: 0
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual, async open(...args: Parameters<typeof actual.open>) {
      if (args[0] !== io.path)
        return actual.open(...args);
      const before = io.beforeOpen;
      io.beforeOpen = undefined;
      await before?.();
      const handle = await actual.open(...args);
      io.handles.push(handle);
      io.live.add(handle);
      io.opened++;
      return new Proxy(handle, {
        get(target, key) {
          if (key === 'read')
            return async (...readArgs: Parameters<FileHandle['read']>) => {
              const beforeRead = io.beforeRead;
              io.beforeRead = undefined;
              await beforeRead?.();
              const result = await Reflect.apply(target.read, target, readArgs);
              const afterRead = io.afterRead;
              io.afterRead = undefined;
              await afterRead?.();
              return result;
            };
          if (key === 'close')
            return async () => {
              const beforeClose = io.beforeClose;
              io.beforeClose = undefined;
              await beforeClose?.();
              await target.close();
              io.live.delete(target);
              io.closed++;
            };
          const value = Reflect.get(target, key, target);
          return typeof value === 'function' ? value.bind(target) : value;
        }
      });
    }
  };
});
const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
async function snapshot(root: string) {
  const result: Record<string, string> = {};
  const visit = async (path: string, prefix: string) => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const key = `${prefix}${entry.name}`, child = join(path, entry.name);
      if (entry.isDirectory()) {
        result[`${key}/`] = 'directory';
        await visit(child, `${key}/`);
      }
      else
        result[key] = (await readFile(child)).toString('hex');
    }
  };
  await visit(root, '');
  return result;
}
async function fixture(test: TestContext) {
  const f = await remnantBindingFixture(test, 'workspaceImport');
  let current = true, owned = true, writersAbsent = true;
  const ownerError = new Error('SYNTHETIC_READ_SCOPE_OWNER_LOST');
  const reservationError = new Error('SYNTHETIC_READ_SCOPE_RESERVATION_LOST');
  const writerError = new Error('SYNTHETIC_READ_SCOPE_WRITER_PRESENT');
  const assertCurrent = () => {
    test.signal.throwIfAborted(); if (!current)
      throw ownerError;
  };
  const authority = {
    assertCurrent, async assertOwned() {
      assertCurrent(); if (!owned)
        throw reservationError;
    }
  };
  const assertWritersAbsent = async () => {
    assertCurrent(); if (!writersAbsent)
      throw writerError;
  };
  const external = { assertAuthority: assertCurrent, async assertExternalSelection() { await authority.assertOwned(); await assertWritersAbsent(); } };
  const base = createSwitchRegistry();
  const entry = { ...base.workspaces[1]!, workspaceId: f.binding.workspaceId, lineageIdentity: f.binding.lineageIdentity };
  const before = { ...base, formatVersion: 2 as const, workspaces: [base.workspaces[0]!, entry] };
  const after = removeWorkspaceEntry({ registry: before, targetWorkspaceId: entry.workspaceId, expectedActiveWorkspaceId: before.activeWorkspaceId });
  const registryPath = join(f.root, WORKSPACE_REGISTRY_FILE_NAME);
  const registry = new WorkspaceRegistryStore({ installationRoot: f.root, filePath: registryPath });
  await registry.write(before);
  const target = captureDeletionInventoryHeader({
    ...deletionTestJournal().target, operationId: id(200),
    workspaceId: entry.workspaceId, lineageIdentity: entry.lineageIdentity, registryEntrySha256: workspaceRegistryEntrySha256(entry)
  });
  const value = captureWorkspaceDeletionJournal({
    ...deletionTestJournal(), target,
    previousActiveWorkspaceId: before.activeWorkspaceId, registryBeforeSha256: digest(await readFile(registryPath)),
    registryAfterSha256: digest(serializeWorkspaceRegistry(after))
  });
  const journal = new WorkspaceDeletionJournalStore(f.root), journalPaths = createWorkspaceDeletionJournalPaths(f.root);
  await journal.publish(value, { ...external, slots: (await journal.inspect(assertCurrent)).slots });
  await f.store().publish(f.binding, external);
  const phase = await captureWorkspaceDeletionPhaseSelection({ operationId: target.operationId, registry, journal, authority, assertWritersAbsent });
  const row = captureDeletionInventoryRecord({
    role: 'importCandidate', ownerOperationId: f.binding.operationId,
    generationId: null, member: null, rootIdentity: hash('payload-root'), parentIdentity: hash('payload-parent'),
    bindingSha256: workspaceRemnantBindingSha256(f.binding)
  });
  const bindingWriters = vi.fn(assertWritersAbsent);
  const bindingSelection = vi.fn(phase.assertSelected);
  const selected = await captureWorkspaceDeletionPayloadBinding(f.root, target, row, {
    assertAuthority: phase.assertCurrent, assertExternalSelection: bindingSelection, assertWritersAbsent: bindingWriters,
  });
  io.path = f.paths.currentPath;
  io.handles = [];
  io.live.clear();
  io.opened = 0;
  io.closed = 0;
  test.onTestFinished(() => { phase.revoke(); vi.restoreAllMocks(); });
  return {
    ...f, selected, registryPath, journalPaths, journal, value, external, phase,
    ownerError, reservationError, writerError, bindingWriters, bindingSelection, assertWritersAbsent,
    revoke() { current = false; }, loseReservation() { owned = false; }, addWriter() { writersAbsent = false; },
  };
}
afterEach(() => {
  expect(io.live.size).toBe(0);
  expect(io.opened).toBe(io.closed);
  for (const handle of io.handles)
    expect(handle.fd).toBe(-1);
  io.path = undefined;
  io.beforeOpen = undefined;
  io.beforeRead = undefined;
  io.afterRead = undefined;
  io.beforeClose = undefined;
  vi.restoreAllMocks();
});
it('keeps a successful real metadata observation read-only with all handles closed', async (test) => {
  const f = await fixture(test), before = await snapshot(f.root);
  f.bindingSelection.mockClear();
  await f.selected.assertSelected();
  {
    expect(f.bindingSelection).toHaveBeenCalledTimes(2);
  }
  expect(await snapshot(f.root)).toEqual(before);
  expect(io.opened).toBeGreaterThan(0);
});
it.for(['registryIdentity', 'journalIdentity', 'phase', 'bindingIdentity', 'sideSlot'] as const)('rejects changed %s before returning the observation and preserves remaining bytes', async (change, test) => {
  const f = await fixture(test);
  const mutate = async () => {
    if (change === 'phase')
      await f.journal.advance({ ...f.value, phase: 'quarantined' }, {
        ...f.external, slots: (await f.journal.inspect(f.external.assertAuthority)).slots,
      });
    else if (change === 'sideSlot')
      await writeFile(f.paths.backupPath, await readFile(f.paths.currentPath), { mode: 0o600, flag: 'wx' });
    else {
      const path = change === 'registryIdentity' ? f.registryPath : change === 'journalIdentity' ? f.journalPaths.currentPath : f.paths.currentPath;
      const bytes = await readFile(path);
      await rename(path, `${path}.retained`);
      await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
    }
  };
  let attacked!: Record<string, string>;
  const inject = async () => { await mutate(); attacked = await snapshot(f.root); };
  if (change === 'bindingIdentity' || change === 'sideSlot')
    io.beforeOpen = inject;
  else
    io.afterRead = inject;
  const error = await f.selected.assertSelected().then(() => undefined, error => error);
  expect(error).toBeInstanceOf(Error);
  expect(attacked).toBeDefined();
  expect(error.message).toBe(change === 'bindingIdentity' ? 'CRASH_SAFE_FILE_SLOT_INVALID'
    : change === 'sideSlot' ? 'WORKSPACE_REMNANT_BINDING_INVALID' : 'WORKSPACE_DELETE_JOURNAL_CONFLICT');
  expect(await snapshot(f.root)).toEqual(attacked);
  f.revoke();
  await expect(f.selected.assertSelected()).rejects.toBe(error);
});
it.for(['owner', 'reservation', 'writer'] as const)('rejects lost %s authority during the inner file read and retains its first cause', async (change, test) => {
  const f = await fixture(test), before = await snapshot(f.root);
  io.afterRead = async () => {
    if (change === 'owner')
      f.revoke();
    else if (change === 'reservation')
      f.loseReservation();
    else
      f.addWriter();
  };
  const expected = change === 'owner' ? f.ownerError : change === 'reservation' ? f.reservationError : f.writerError;
  await expect(f.selected.assertSelected()).rejects.toBe(expected);
  f.revoke();
  await expect(f.selected.assertSelected()).rejects.toBe(expected);
  expect(await snapshot(f.root)).toEqual(before);
});
it.for((['opening', 'closing'] as const).flatMap(boundary => (['phase', 'registryIdentity'] as const).flatMap(change => (['return', 'throw'] as const).map(outcome => ({ boundary, change, outcome })))))('rejects $change during the $boundary writer callback with $outcome and retains bytes', async ({ boundary, change, outcome }, test) => {
  const f = await fixture(test);
  const writerFailure = new Error('SYNTHETIC_READ_BOUNDARY_WRITER_FAILED');
  let closing = false, inspected = 0, injected = false;
  let attacked: Record<string, string> | undefined;
  const inspect = WorkspaceRemnantBindingStore.prototype.inspect;
  vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'inspect').mockImplementation(async function(this: WorkspaceRemnantBindingStore, authority) {
    const value = await inspect.call(this, authority);
    inspected++;
    if (inspected === 2)
      closing = true;
    return value;
  });
  f.bindingWriters.mockImplementation(async () => {
    await f.assertWritersAbsent();
    if (injected || (boundary === 'closing' && !closing))
      return;
    injected = true;
    expect(io.live.size).toBe(0);
    expect(inspected).toBe(boundary === 'opening' ? 0 : 2);
    if (boundary === 'closing')
      expect(io.opened).toBeGreaterThan(0);
    if (change === 'phase') {
      await f.journal.advance({ ...f.value, phase: 'quarantined' }, {
        ...f.external, slots: (await f.journal.inspect(f.external.assertAuthority)).slots,
      });
    }
    else {
      const bytes = await readFile(f.registryPath);
      await rename(f.registryPath, `${f.registryPath}.retained`);
      await writeFile(f.registryPath, bytes, { flag: 'wx', mode: 0o600 });
    }
    attacked = await snapshot(f.root);
    if (outcome === 'throw')
      throw writerFailure;
  });
  const error = await f.selected.assertSelected().then(() => undefined, error => error);
  expect(injected).toBe(true);
  expect(attacked).toBeDefined();
  if (outcome === 'throw')
    expect(error).toBe(writerFailure);
  else {
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  }
  expect(io.live.size).toBe(0);
  expect(io.opened).toBe(io.closed);
  for (const handle of io.handles)
    expect(handle.fd).toBe(-1);
  expect(await snapshot(f.root)).toEqual(attacked);
  f.revoke();
  await expect(f.selected.assertSelected()).rejects.toBe(error);
  expect(await snapshot(f.root)).toEqual(attacked);
});
it('joins an open native file read after revocation before returning and closes its actual handle', async (test) => {
  const f = await fixture(test), before = await snapshot(f.root);
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  io.beforeRead = async () => { enter(); await held; };
  let settled = false;
  const result = f.selected.assertSelected().then(() => { settled = true; return undefined; }, error => { settled = true; return error; });
  test.onTestFinished(async () => { release(); await result; });
  try {
    await Promise.race([entered, result.then(() => { throw new Error('SYNTHETIC_NATIVE_READ_NOT_PENDING'); })]);
    expect(io.live.size).toBe(1);
    expect(io.handles[0]!.fd).toBeGreaterThanOrEqual(0);
    const opened = io.opened;
    f.revoke();
    await setImmediate();
    expect(settled).toBe(false);
    expect(io.opened).toBe(opened);
  }
  finally {
    release();
    await result;
  }
  expect(await result).toBe(f.ownerError);
  expect(io.live.size).toBe(0);
  expect(await snapshot(f.root)).toEqual(before);
});
it('joins pending close after revocation and returns only after the actual descriptor closes', async (test) => {
  const f = await fixture(test), before = await snapshot(f.root);
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  io.beforeClose = async () => { enter(); await held; };
  let settled = false;
  const result = f.selected.assertSelected().then(() => { settled = true; return undefined; }, error => { settled = true; return error; });
  test.onTestFinished(async () => { release(); await result; });
  try {
    await Promise.race([entered, result.then(() => { throw new Error('SYNTHETIC_NATIVE_CLOSE_NOT_PENDING'); })]);
    expect(io.live.size).toBe(1);
    expect(io.handles[0]!.fd).toBeGreaterThanOrEqual(0);
    const opened = io.opened;
    f.revoke();
    await setImmediate();
    expect(settled).toBe(false);
    expect(io.opened).toBe(opened);
  }
  finally {
    release();
    await result;
  }
  expect(await result).toBe(f.ownerError);
  expect(io.live.size).toBe(0);
  expect(await snapshot(f.root)).toEqual(before);
});
it('expires each inner read scope without reviving it in the next observation', async (test) => {
  const f = await fixture(test), before = await snapshot(f.root), scopes: Parameters<WorkspaceRemnantBindingStore['inspect']>[0][] = [];
  const inspect = WorkspaceRemnantBindingStore.prototype.inspect;
  const inspection = vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'inspect').mockImplementation(async function(this: WorkspaceRemnantBindingStore, authority) {
    scopes.push(authority);
    return inspect.call(this, authority);
  });
  await f.selected.assertSelected();
  const expired = [...scopes];
  expect(expired.length).toBeGreaterThan(0);
  for (const authority of expired) {
    expect(() => authority.assertAuthority()).toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
    await expect(authority.assertExternalSelection()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  }
  expect(() => f.phase.assertCurrent()).not.toThrow();
  let challengedDuringFreshRead = false;
  inspection.mockImplementation(async function(this: WorkspaceRemnantBindingStore, authority) {
    authority.assertAuthority();
    await authority.assertExternalSelection();
    for (const old of expired) {
      expect(() => old.assertAuthority()).toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
      await expect(old.assertExternalSelection()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
    }
    authority.assertAuthority();
    challengedDuringFreshRead = true;
    return inspect.call(this, authority);
  });
  await f.selected.assertSelected();
  expect(challengedDuringFreshRead).toBe(true);
  expect(await snapshot(f.root)).toEqual(before);
});
