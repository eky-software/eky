import { mkdir, readFile, readdir, rename, rmdir, unlink, writeFile, type FileHandle as TerminalHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, vi, type TestContext as TerminalContext } from 'vitest';
import { createNodeCrashSafeFileSlotFileSystem } from '../persistence/crashSafeFileSlot.js';
import { deletionTestJournal as terminalFulfilledJournal } from './workspaceDeletionDataTestSupport.js';
import * as terminalFinalizers from './workspaceDeletionFinalization.js';
import type { WorkspaceDeletionTerminalPhaseEvent } from './workspaceDeletionFinalization.js';
import { createWorkspaceDeletionFinalizationTestFixture as fixture, captureWorkspaceDeletionTerminalPrefixTestFailure } from './workspaceDeletionFinalizationTestSupport.js';
import { maximumWorkspaceDeletionJournalBytes } from './workspaceDeletionJournalCodec.js';
import { WorkspaceDeletionJournalStore } from './workspaceDeletionJournalStore.js';
import * as terminalPhase from './workspaceDeletionPhaseSelection.js';
import { workspaceRemnantBindingKey as terminalChangedBindingKey } from './workspaceRemnantBindingCodec.js';
import { createWorkspaceRemnantBindingPaths } from './workspaceRemnantBindingPaths.js';
import { WorkspaceRemnantBindingStore } from './workspaceRemnantBindingStore.js';
function journalSystem(f: Awaited<ReturnType<typeof fixture>>) {
  return createNodeCrashSafeFileSlotFileSystem(f.journalPaths, maximumWorkspaceDeletionJournalBytes);
}
const terminalNative = vi.hoisted(() => ({ opened: undefined as ((file: TerminalHandle, path: unknown) => TerminalHandle) | undefined }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, async open(...args: Parameters<typeof actual.open>) {
      const file = await actual.open(...args);
      return terminalNative.opened?.(file, args[0]) ?? file;
    } };
});
async function terminalFixture(test: TerminalContext, original = false) {
  const terminalEvents: WorkspaceDeletionTerminalPhaseEvent[] = [];
  const f = await fixture(test, true, original, { coldSelection: true,
    observeTerminalPhase(event) { terminalEvents.push(event); } });
  await unlink(f.inventoryPaths.currentPath);
  await rmdir(f.inventoryPaths.directoryPath);
  test.onTestFinished(() => { terminalNative.opened = undefined; });
  return { ...f, terminalEvents };
}
function terminalGate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
type TerminalFixture = Awaited<ReturnType<typeof terminalFixture>>;
type TerminalPrefix = NonNullable<Parameters<WorkspaceDeletionJournalStore['clearTerminal']>[2]>;
function terminalPrefixHook(f: TerminalFixture, hook: (prefix: TerminalPrefix, round: number) => Promise<void>, fileSystem?: ReturnType<typeof journalSystem>) {
  const clear = WorkspaceDeletionJournalStore.prototype.clearTerminal;
  let saved: TerminalPrefix | undefined, rounds = 0;
  vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'clearTerminal').mockImplementation(function (this: WorkspaceDeletionJournalStore, selection, terminal, readSelection) {
    if (readSelection === undefined)
      throw new Error('TERMINAL_PREFIX_NOT_FORWARDED');
    saved = readSelection;
    return clear.call(fileSystem === undefined ? this : new WorkspaceDeletionJournalStore(f.root, fileSystem), selection, terminal, { async assertBeforeSlotRead() { rounds++; await hook(readSelection, rounds); } });
  });
  return { saved() { if (saved === undefined)
      throw new Error('TERMINAL_PREFIX_NOT_CAPTURED'); return saved; }, rounds: () => rounds };
}
for (const round of [1, 2, 3, 4])
  for (const kind of ['error', 'undefined'] as const) {
    it(`terminal finalizer prefix preserves ${kind} at guard ${round} before native normalization`, async (test) => {
      const f = await terminalFixture(test), first = kind === 'error' ? new Error('SYNTHETIC_TERMINAL_PREFIX_FIRST') : undefined;
      let inPrefix = false, injected = false, normalized: unknown;
      const capture = terminalPhase.captureWorkspaceDeletionPhaseSelection;
      vi.spyOn(terminalPhase, 'captureWorkspaceDeletionPhaseSelection').mockImplementation(async (input) => {
        const selected = await capture(input);
        return { ...selected, async assertExternalSelection() {
            if (inPrefix && scope.rounds() === round) {
              injected = true;
              throw first;
            }
            await selected.assertExternalSelection();
          } };
      });
      const fs = journalSystem(f), remove = fs.removeSlot.bind(fs);
      fs.removeSlot = async (...args) => {
        try {
          return await remove(...args);
        }
        catch (error) {
          normalized = error;
          throw error;
        }
      };
      const scope = terminalPrefixHook(f, async (prefix) => {
        inPrefix = true;
        try {
          await prefix.assertBeforeSlotRead();
        }
        finally {
          inPrefix = false;
        }
      }, fs);
      const result = await f.run().then(() => ({ ok: true }), (error: unknown) => ({ error }));
      expect('error' in result).toBe(true);
      expect((result as {
        error: unknown;
      }).error).toBe(first);
      expect(injected).toBe(true);
      expect(scope.rounds()).toBe(round);
      if (round === 2)
        expect(normalized).toMatchObject({ name: 'CrashSafeFileSlotError', failure: 'unavailable' });
      if (round < 3)
        expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
      else
        await expect(readFile(f.journalPaths.currentPath)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(scope.saved().assertBeforeSlotRead()).rejects.toBe(first);
      await f.preserved();
    });
  }
it('terminal finalizer prefix expires successful callbacks without IO', async (test) => {
  const f = await terminalFixture(test);
  let checks = 0;
  const capture = terminalPhase.captureWorkspaceDeletionPhaseSelection;
  vi.spyOn(terminalPhase, 'captureWorkspaceDeletionPhaseSelection').mockImplementation(async (input) => {
    const selected = await capture(input);
    return { ...selected, async assertExternalSelection() { checks++; await selected.assertExternalSelection(); } };
  });
  const scope = terminalPrefixHook(f, prefix => prefix.assertBeforeSlotRead());
  expect((await f.run()).phase).toBe('registryPublished');
  expect(scope.rounds()).toBe(4);
  const before = checks;
  await expect(scope.saved().assertBeforeSlotRead()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  expect(checks).toBe(before);
  await f.preserved();
});

for (const kind of ['error', 'undefined'] as const) {
  it(`terminal evidence helper proves rejection for first ${kind}`, async test => {
    const first = kind === 'error' ? new Error('SYNTHETIC_TERMINAL_EVIDENCE_FIRST') : undefined;
    expect(await captureWorkspaceDeletionTerminalPrefixTestFailure(test, first)).toBe(first);
  });
}

it('terminal evidence helper rejects swallowed undefined failure', async test => {
  const create = terminalFinalizers.createWorkspaceDeletionFinalizer;
  const factory = vi.spyOn(terminalFinalizers, 'createWorkspaceDeletionFinalizer').mockImplementation(input => {
    const command = create(input);
    return async (...args) => {
      try { return await command(...args); }
      catch (error) {
        if (error !== undefined) throw error;
        return terminalFulfilledJournal('registryPublished');
      }
    };
  });
  try {
    await expect(captureWorkspaceDeletionTerminalPrefixTestFailure(test, undefined)).rejects.toMatchObject({ name: 'AssertionError' });
  } finally { factory.mockRestore(); }
});
for (const mode of ['read', 'close'] as const) {
  it(`terminal finalizer prefix joins actual held ${mode} before returning revoked authority`, async (test) => {
    const f = await terminalFixture(test), held = terminalGate(), entered = terminalGate();
    f.releases.push(held.release);
    let armed = false, captured = false, closed = 0, settled = false, handle: TerminalHandle | undefined;
    terminalPrefixHook(f, async (prefix) => { await prefix.assertBeforeSlotRead(); armed = true; });
    terminalNative.opened = (file, path) => {
      if (!armed || captured || path !== f.journalPaths.currentPath)
        return file;
      captured = true;
      handle = file;
      return new Proxy(file, { get(target, property) {
          if (property === 'read')
            return async (...args: Parameters<TerminalHandle['read']>) => {
              if (mode === 'read') {
                entered.release();
                await held.promise;
              }
              return Reflect.apply(target.read, target, args);
            };
          if (property === 'close')
            return async () => {
              if (mode === 'close') {
                entered.release();
                await held.promise;
              }
              await target.close();
              closed++;
            };
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        } });
    };
    const outcome = f.run().then(() => ({ ok: true }), (error: unknown) => ({ error })).finally(() => { settled = true; });
    try {
      await Promise.race([entered.promise, outcome.then(() => { throw new Error('TERMINAL_NATIVE_IO_NOT_HELD'); })]);
      expect(settled).toBe(false);
      expect(closed).toBe(0);
      expect(f.terminalEvents.filter(event => event.phase === 'terminalJournalClear').map(event => event.event)).toEqual(['entered']);
      expect(handle!.fd).toBeGreaterThanOrEqual(0);
      f.revoke();
      await expect(f.run()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
      expect(settled).toBe(false);
    }
    finally {
      held.release();
    }
    const result = await outcome;
    expect('error' in result).toBe(true);
    expect((result as {
      error: unknown;
    }).error).toBe(f.first);
    expect(closed).toBe(1);
    expect(f.terminalEvents.filter(event => event.phase === 'terminalJournalClear').map(event => event.event)).toEqual(['entered', 'rejected']);
    expect(handle!.fd).toBe(-1);
    terminalNative.opened = undefined;
    expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
    await f.preserved();
  });
}
for (const change of ['metadata', 'originalPayload', 'operationRoot', 'parentIdentity', 'stable'] as const) {
  it(`terminal finalizer prefix blocks persistent ${change} before real journal removal`, async (test) => {
    const f = await terminalFixture(test, change === 'originalPayload');
    const fs = journalSystem(f), remove = fs.removeSlot.bind(fs), first = new Error('SYNTHETIC_TERMINAL_STABLE_CHANGED');
    let injected = false, removes = 0;
    fs.removeSlot = async (...args) => { removes++; return remove(...args); };
    const bindingPaths = createWorkspaceRemnantBindingPaths(f.root, terminalChangedBindingKey(f.originalBinding));
    const moved = `${f.inventoryPaths.parentPath}-retained`;
    terminalPrefixHook(f, async (prefix, round) => {
      await prefix.assertBeforeSlotRead();
      if (round !== 1)
        return;
      injected = true;
      if (change === 'metadata')
        await new WorkspaceRemnantBindingStore(f.root, terminalChangedBindingKey(f.originalBinding)).publish(f.originalBinding, f.external);
      else if (change === 'originalPayload') {
        await mkdir(f.originalPaths.candidateRoot, { recursive: true, mode: 0o700 });
        await writeFile(join(f.originalPaths.candidateRoot, 'retained'), 'returned original payload', { flag: 'wx', mode: 0o600 });
      }
      else if (change === 'operationRoot')
        await mkdir(f.inventoryPaths.directoryPath, { mode: 0o700 });
      else if (change === 'parentIdentity') {
        await rename(f.inventoryPaths.parentPath, moved);
        await mkdir(f.inventoryPaths.parentPath, { mode: 0o700 });
      }
      else
        f.fullProof.mockRejectedValue(first);
    }, fs);
    const outcome = await f.run().then(() => ({ ok: true }), (error: unknown) => ({ error }));
    expect('error' in outcome).toBe(true);
    expect(injected).toBe(true);
    expect(removes).toBe(0);
    if (change === 'stable')
      expect((outcome as {
        error: unknown;
      }).error).toBe(first);
    expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
    if (change === 'metadata')
      expect(JSON.parse(await readFile(bindingPaths.currentPath, 'utf8'))).toEqual(f.originalBinding);
    else if (change === 'originalPayload')
      expect(await readFile(join(f.originalPaths.candidateRoot, 'retained'), 'utf8')).toBe('returned original payload');
    else if (change === 'operationRoot')
      expect(await readdir(f.inventoryPaths.directoryPath)).toEqual([]);
    else if (change === 'parentIdentity') {
      expect(await readdir(moved)).toEqual([]);
      expect(await readdir(f.inventoryPaths.parentPath)).toEqual([]);
    }
    await f.preserved();
  });
}
for (const optimized of [false, true]) {
  it(`terminal finalizer prefix models real metadata restored wholly within slots (optimized: ${optimized})`, async (test) => {
    const f = await terminalFixture(test), fs = journalSystem(f), clear = WorkspaceDeletionJournalStore.prototype.clearTerminal;
    const store = new WorkspaceRemnantBindingStore(f.root, terminalChangedBindingKey(f.originalBinding));
    const paths = createWorkspaceRemnantBindingPaths(f.root, terminalChangedBindingKey(f.originalBinding));
    let published = false, restored = false;
    const read = fs.readSlot.bind(fs);
    fs.readSlot = async (...args) => {
      const result = await read(...args);
      if (args[0] === 'backup' && published && !restored) {
        await unlink(paths.currentPath);
        restored = true;
      }
      return result;
    };
    vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'clearTerminal').mockImplementation(async (selection, terminal, readSelection) => {
      expect(readSelection).toBeDefined();
      await store.publish(f.originalBinding, f.external);
      published = true;
      return clear.call(new WorkspaceDeletionJournalStore(f.root, fs), selection, terminal, optimized ? readSelection : undefined);
    });
    if (optimized) {
      expect((await f.run()).phase).toBe('registryPublished');
      expect(restored).toBe(true);
      await expect(readFile(f.journalPaths.currentPath)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(paths.currentPath)).rejects.toMatchObject({ code: 'ENOENT' });
    }
    else {
      await expect(f.run()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
      expect(restored).toBe(false);
      expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
      expect(JSON.parse(await readFile(paths.currentPath, 'utf8'))).toEqual(f.originalBinding);
    }
    expect(published).toBe(true);
    await f.preserved();
  });
}
it('terminal finalizer prefix does not poison a fresh authorized call with an expired failed callback', async (test) => {
  const f = await terminalFixture(test), first = new Error('SYNTHETIC_TERMINAL_ONE_CALL_FAILURE');
  let fault = true, inPrefix = false, old: TerminalPrefix | undefined, inspected = false, checks = 0;
  const capture = terminalPhase.captureWorkspaceDeletionPhaseSelection;
  vi.spyOn(terminalPhase, 'captureWorkspaceDeletionPhaseSelection').mockImplementation(async (input) => {
    const selected = await capture(input);
    return { ...selected, async assertExternalSelection() {
        checks++;
        if (fault && inPrefix)
          throw first;
        await selected.assertExternalSelection();
      } };
  });
  const scope = terminalPrefixHook(f, async (prefix) => {
    if (old !== undefined && !inspected) {
      const before = checks;
      await expect(old.assertBeforeSlotRead()).rejects.toBe(first);
      expect(checks).toBe(before);
      inspected = true;
    }
    inPrefix = true;
    try {
      await prefix.assertBeforeSlotRead();
    }
    finally {
      inPrefix = false;
    }
  });
  await expect(f.run()).rejects.toBe(first);
  old = scope.saved();
  fault = false;
  // An explicit new test invocation, not an application retry loop.
  expect((await f.run()).phase).toBe('registryPublished');
  expect(inspected).toBe(true);
  await f.preserved();
});
it('terminal finalizer prefix joins a held prefix selection before rejection', async (test) => {
  const f = await terminalFixture(test), held = terminalGate(), entered = terminalGate();
  f.releases.push(held.release);
  let inPrefix = false, intercepted = false, settled = false, slotReads = 0;
  const fs = journalSystem(f), read = fs.readSlot.bind(fs);
  fs.readSlot = async (...args) => { slotReads++; return read(...args); };
  const capture = terminalPhase.captureWorkspaceDeletionPhaseSelection;
  vi.spyOn(terminalPhase, 'captureWorkspaceDeletionPhaseSelection').mockImplementation(async (input) => {
    const selected = await capture(input);
    return { ...selected, async assertExternalSelection() {
        if (inPrefix && !intercepted) {
          intercepted = true;
          entered.release();
          await held.promise;
        }
        await selected.assertExternalSelection();
      } };
  });
  terminalPrefixHook(f, async (prefix) => {
    inPrefix = true;
    try {
      await prefix.assertBeforeSlotRead();
    }
    finally {
      inPrefix = false;
    }
  }, fs);
  const outcome = f.run().then(() => ({ ok: true }), (error: unknown) => ({ error })).finally(() => { settled = true; });
  try {
    await Promise.race([entered.promise, outcome.then(() => { throw new Error('TERMINAL_PREFIX_NOT_HELD'); })]);
    f.revoke();
    expect(settled).toBe(false);
    expect(slotReads).toBe(0);
    await expect(f.run()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
    expect(settled).toBe(false);
  }
  finally {
    held.release();
  }
  const result = await outcome;
  expect('error' in result).toBe(true);
  expect((result as {
    error: unknown;
  }).error).toBe(f.first);
  expect(slotReads).toBe(0);
  expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
  await f.preserved();
});
