import { mkdir, readFile, rename, rmdir, writeFile, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, vi, type TestContext } from 'vitest';
import { createNodeCrashSafeFileSlotFileSystem } from '../persistence/crashSafeFileSlot.js';
import { maximumWorkspaceDeletionJournalBytes, parseWorkspaceDeletionJournalBytes, serializeWorkspaceDeletionJournal } from './workspaceDeletionJournalCodec.js';
import { WorkspaceDeletionJournalStore } from './workspaceDeletionJournalStore.js';
import { WorkspaceDeletionInventoryStore } from './workspaceDeletionInventoryStore.js';
import { createWorkspaceDeletionFinalizationTestFixture as fixture, captureWorkspaceDeletionPublicationPrefixTestFailure } from './workspaceDeletionFinalizationTestSupport.js';
import * as phases from './workspaceDeletionPhaseSelection.js';
type Prefix = NonNullable<Parameters<WorkspaceDeletionJournalStore['advance']>[2]>;
type Kind = 'advance' | 'recover';
const reached = new Error('SYNTHETIC_JOURNAL_TRANSITION_COMPLETE');
for (const first of [new Error('SYNTHETIC_PUBLICATION_EVIDENCE_FIRST'), undefined]) {
    it(`publication evidence helper retains ${first === undefined ? 'undefined' : 'error'} through native conversion`, async test => {
        expect(await captureWorkspaceDeletionPublicationPrefixTestFailure(test, first)).toBe(first);
    });
}
async function setup(test: TestContext, kind: Kind, enter?: (f: Awaited<ReturnType<typeof fixture>>) => Promise<void>, shape: {
    v2?: boolean;
    normal?: boolean;
    pair?: boolean;
} = {}) {
    const f = await fixture(test, shape.pair ?? false, false, { coldSelection: !shape.normal });
    if (shape.v2) {
        f.journalBytes = Buffer.from(serializeWorkspaceDeletionJournal({ ...parseWorkspaceDeletionJournalBytes(f.journalBytes), formatVersion: 2, originalJournalProofs: [] }));
        await writeFile(f.journalPaths.currentPath, f.journalBytes);
    }
    if (shape.pair)
        await writeFile(f.journalPaths.backupPath, serializeWorkspaceDeletionJournal({ ...parseWorkspaceDeletionJournalBytes(f.journalBytes), phase: 'purged' }));
    else if (kind === 'recover')
        await rename(f.journalPaths.currentPath, f.journalPaths.backupPath);
    const retainedSlots = [f.journalPaths.currentPath, f.journalPaths.nextPath, f.journalPaths.backupPath];
    const readRetainedSlots = () => Promise.all(retainedSlots.map(path => readFile(path).catch(error => {
        if (error.code === 'ENOENT')
            return undefined;
        throw error;
    })));
    const initialSlots = await readRetainedSlots();
    const fs = createNodeCrashSafeFileSlotFileSystem(f.journalPaths, maximumWorkspaceDeletionJournalBytes);
    let inside = false, full = 0, prefixes = 0, inventories = 0, reads = 0, completed = false;
    let saved: Prefix | undefined;
    const consume = WorkspaceDeletionInventoryStore.prototype.consumeSelectedRecords;
    vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'consumeSelectedRecords').mockImplementation(function (this: WorkspaceDeletionInventoryStore, ...args) {
        if (inside)
            inventories++;
        return consume.apply(this, args);
    });
    const advance = WorkspaceDeletionJournalStore.prototype.advance, recover = WorkspaceDeletionJournalStore.prototype.recover;
    let onPrefix: (round: number) => Promise<void> = async () => { };
    const wrap = (selection: Parameters<WorkspaceDeletionJournalStore['recover']>[0], read: Prefix | undefined) => {
        expect(read !== undefined).toBe(true);
        saved = read;
        const guarded = { ...selection, async assertExternalSelection() { full++; await selection.assertExternalSelection(); } };
        const prefix = read === undefined ? undefined : { async assertBeforeSlotRead() {
                prefixes++;
                await onPrefix(prefixes);
                await read.assertBeforeSlotRead();
            } };
        return { guarded, prefix };
    };
    const run = async <T>(work: () => Promise<T>) => {
        inside = true;
        try {
            await enter?.(f);
            const result = await work();
            completed = true;
            return result;
        }
        finally {
            inside = false;
        }
    };
    if (kind === 'advance')
        vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'advance').mockImplementation(async function (value, selection, read) {
            const { guarded, prefix } = wrap(selection, read);
            await run(() => advance.call(new WorkspaceDeletionJournalStore(f.root, fs), value, guarded, prefix));
            throw reached;
        });
    else
        vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'recover').mockImplementation(async function (selection, read) {
            const { guarded, prefix } = wrap(selection, read);
            await run(() => recover.call(new WorkspaceDeletionJournalStore(f.root, fs), guarded, prefix));
            throw reached;
        });
    const readSlot = fs.readSlot.bind(fs);
    let onRead: (slot: string) => Promise<void> = async () => { };
    fs.readSlot = async (...args) => { reads++; await onRead(args[0]); return readSlot(...args); };
    return { f, fs, setPrefix(hook: typeof onPrefix) { onPrefix = hook; }, setRead(hook: typeof onRead) { onRead = hook; },
        saved() { expect(saved).toBeDefined(); return saved!; },
        stats: () => ({ full, prefixes, inventories, reads, completed }),
        async outcome() { return f.run().then(() => ({ fulfilled: true as const }), error => ({ fulfilled: false as const, error })); },
        async unchanged() {
            expect(await readRetainedSlots()).toEqual(initialSlots);
            expect(await readFile(f.inventoryPaths.currentPath)).toEqual(f.inventoryBytes);
            await f.preserved();
        },
    };
}
for (const kind of ['advance', 'recover'] as const) {
    it(`${kind} measures actual journal slot guards without full finalization`, async (test) => {
        const s = await setup(test, kind), result = await s.outcome();
        expect(result).toEqual({ fulfilled: false, error: reached });
        const stats = s.stats();
        expect(stats.completed).toBe(true);
        expect(stats.reads).toBeGreaterThan(0);
        expect(stats.inventories).toBe(stats.full);
        expect(stats.full).toBe(stats.prefixes);
        {
            expect(stats.full).toBe(kind === 'advance' ? 10 : 4);
            const checks = s.f.fullProof.mock.calls.length;
            await expect(s.saved().assertBeforeSlotRead()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
            expect(s.f.fullProof.mock.calls.length).toBe(checks);
        }
        expect(parseWorkspaceDeletionJournalBytes(await readFile(s.f.journalPaths.currentPath)).phase)
            .toBe(kind === 'advance' ? 'registryPublished' : 'purged');
        expect(await readFile(s.f.inventoryPaths.currentPath)).toEqual(s.f.inventoryBytes);
        await s.f.preserved();
    });
    it(`${kind} rejects persistent returned payload before first mutation`, async (test) => {
        const s = await setup(test, kind);
        let added = false;
        // Inject immediately before the selected current-slot read, after either prefix.
        s.setRead(async (slot) => { if (!added && slot === 'current') {
            added = true;
            await mkdir(s.f.workspace.workspaceRoot, { mode: 0o700 });
        } });
        const result = await s.outcome();
        expect(result.fulfilled).toBe(false);
        if (result.fulfilled)
            throw new Error('EXPECTED_REJECTION');
        expect(result.error).not.toBe(reached);
        expect(added).toBe(true);
        expect(s.stats().completed).toBe(false);
        await s.unchanged();
        await rmdir(s.f.workspace.workspaceRoot);
    });
    it(`${kind} rejects lost owner before selected slot reading`, async (test) => {
        const s = await setup(test, kind);
        let revoked = false;
        s.setRead(async (slot) => { if (!revoked && slot === 'current') {
            revoked = true;
            s.f.revoke();
        } });
        const result = await s.outcome();
        expect(result).toEqual({ fulfilled: false, error: s.f.first });
        expect(revoked).toBe(true);
        expect(s.stats().completed).toBe(false);
        await s.unchanged();
    });
}
for (const kind of ['advance', 'recover'] as const)
    for (const first of [new Error('SYNTHETIC_PUBLICATION_PREFIX_FIRST'), undefined]) {
        it(`${kind} preserves prefix ${first === undefined ? 'undefined' : 'error'} and expires its scope`, async (test) => {
            const s = await setup(test, kind);
            let inPrefix = false;
            const capture = phases.captureWorkspaceDeletionPhaseSelection;
            vi.spyOn(phases, 'captureWorkspaceDeletionPhaseSelection').mockImplementation(async (input) => {
                const phase = await capture(input);
                return { ...phase, async assertExternalSelection() { if (inPrefix)
                        throw first; await phase.assertExternalSelection(); } };
            });
            s.setPrefix(async () => { inPrefix = true; });
            const result = await s.outcome();
            expect(result).toEqual({ fulfilled: false, error: first });
            expect(s.stats().completed).toBe(false);
            expect(s.stats().reads).toBe(0);
            await expect(s.saved().assertBeforeSlotRead()).rejects.toBe(first);
            await s.unchanged();
        });
    }
const publicationNative = vi.hoisted(() => ({ opened: undefined as ((file: FileHandle, path: unknown) => FileHandle) | undefined }));
vi.mock('node:fs/promises', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs/promises')>();
    return { ...actual, async open(...args: Parameters<typeof actual.open>) {
            const file = await actual.open(...args);
            return publicationNative.opened?.(file, args[0]) ?? file;
        } };
});
function publicationGate() {
    let release!: () => void;
    const promise = new Promise<void>(resolve => { release = resolve; });
    return { promise, release };
}
for (const kind of ['advance', 'recover'] as const) {
    for (const normal of [false, true])
        it(`${kind} covers V2 zero-proof ${normal ? 'normal' : 'cold'} selection and retained slots`, async (test) => {
            const s = await setup(test, kind, undefined, { v2: true, normal, pair: kind === 'recover' });
            const result = await s.outcome();
            expect(result).toEqual({ fulfilled: false, error: reached });
            expect(s.stats().completed).toBe(true);
            expect(s.stats().full).toBe((kind === 'advance' ? 10 : 4) * (1));
            const saved = parseWorkspaceDeletionJournalBytes(await readFile(s.f.journalPaths.currentPath));
            expect(saved.formatVersion).toBe(2);
            if (saved.formatVersion !== 2)
                throw new Error('V2_REQUIRED');
            expect(saved.originalJournalProofs).toHaveLength(0);
            expect(saved.phase).toBe('registryPublished');
            await expect(readFile(s.f.journalPaths.backupPath)).rejects.toMatchObject({ code: 'ENOENT' });
            await s.f.preserved();
        });
    it(`${kind} proves the transient payload observation difference`, async (test) => {
        const s = await setup(test, kind, f => mkdir(f.workspace.workspaceRoot, { mode: 0o700 }).then(() => { }));
        let removed = false;
        s.setRead(async (slot) => { if (!removed && slot === 'current') {
            await rmdir(s.f.workspace.workspaceRoot);
            removed = true;
        } });
        const result = await s.outcome();
        expect(result.fulfilled).toBe(false);
        if (result.fulfilled)
            throw new Error('EXPECTED_SENTINEL_OR_REJECTION');
        expect(s.stats().completed).toBe(true);
        expect(removed).toBe(true);
        expect(result.error).toBe(reached);
        await s.f.preserved();
    });
    it(`${kind} rejects identical bytes under a changed slot identity`, async (test) => {
        const s = await setup(test, kind);
        let replaced = false;
        const selected = kind === 'advance' ? 'current' : 'backup';
        const path = kind === 'advance' ? s.f.journalPaths.currentPath : s.f.journalPaths.backupPath;
        s.setRead(async (slot) => {
            if (replaced || slot !== selected)
                return;
            replaced = true;
            await rename(path, join(s.f.root, 'retained-original'));
            await writeFile(path, s.f.journalBytes, { mode: 0o600, flag: 'wx' });
        });
        const result = await s.outcome();
        expect(result.fulfilled).toBe(false);
        if (result.fulfilled)
            throw new Error('EXPECTED_REJECTION');
        expect(result.error).not.toBe(reached);
        expect(replaced).toBe(true);
        expect(s.stats().completed).toBe(false);
        await s.unchanged();
        expect(await readFile(join(s.f.root, 'retained-original'))).toEqual(s.f.journalBytes);
    });
}
{
    for (const kind of ['advance', 'recover'] as const)
        for (const boundary of (kind === 'advance'
            ? ['prepareDirectory', 'createNextWriter', 'moveSlot', 'removeSlot', 'syncDirectory']
            : ['moveSlot', 'syncDirectory']) as ('prepareDirectory' | 'createNextWriter' | 'moveSlot' | 'removeSlot' | 'syncDirectory')[]) {
            it(`${kind} retains the full payload guard at native ${boundary}`, async (test) => {
                const s = await setup(test, kind);
                const original = s.fs[boundary].bind(s.fs);
                let invoked = false, returned = false;
                let before: (Buffer | undefined)[] = [];
                const slots = [s.f.journalPaths.currentPath, s.f.journalPaths.nextPath, s.f.journalPaths.backupPath];
                const bytes = () => Promise.all(slots.map(path => readFile(path).catch(error => {
                    if (error.code === 'ENOENT')
                        return undefined;
                    throw error;
                })));
                // Preserve the real native operation and its guard, including after earlier owned writes.
                const intercept = async (...args: unknown[]) => {
                    expect(invoked).toBe(false);
                    invoked = true;
                    before = await bytes();
                    await mkdir(s.f.workspace.workspaceRoot, { mode: 0o700 });
                    const result = await Reflect.apply(original, s.fs, args);
                    returned = true;
                    return result;
                };
                Object.assign(s.fs, { [boundary]: intercept });
                const result = await s.outcome();
                expect(result.fulfilled).toBe(false);
                expect(invoked).toBe(true);
                expect(returned).toBe(false);
                expect(s.stats().completed).toBe(false);
                expect(await bytes()).toEqual(before);
                expect(await readFile(s.f.inventoryPaths.currentPath)).toEqual(s.f.inventoryBytes);
                await s.f.preserved();
                await rmdir(s.f.workspace.workspaceRoot);
            });
        }
    for (const mode of ['read', 'close'] as const)
        it(`actual selected handle ${mode} settles before lost-owner return`, async (test) => {
            const s = await setup(test, 'advance'), entered = publicationGate(), held = publicationGate();
            s.f.releases.push(held.release);
            let armed = false, captured = false, closed = 0, settled = false;
            let handle: FileHandle | undefined;
            test.onTestFinished(() => { publicationNative.opened = undefined; });
            s.setPrefix(async () => { armed = true; });
            publicationNative.opened = (file, path) => {
                if (!armed || captured || path !== s.f.journalPaths.currentPath)
                    return file;
                captured = true;
                handle = file;
                return new Proxy(file, { get(target, property) {
                        if (property === 'read')
                            return async (...args: Parameters<FileHandle['read']>) => {
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
            const outcome = s.outcome().finally(() => { settled = true; });
            try {
                await Promise.race([entered.promise, outcome.then(() => { throw new Error('ACTUAL_HANDLE_NOT_HELD'); })]);
                expect(settled).toBe(false);
                expect(closed).toBe(0);
                s.f.revoke();
                await Promise.resolve();
                expect(settled).toBe(false);
            }
            finally {
                held.release();
            }
            expect(await outcome).toEqual({ fulfilled: false, error: s.f.first });
            expect(closed).toBe(1);
            expect(handle).toBeDefined();
            await expect(handle!.stat()).rejects.toMatchObject({ code: 'EBADF' });
            await s.unchanged();
        });
    for (const kind of ['advance', 'recover'] as const)
        for (const errorKind of ['error', 'undefined'] as const)
            it(`${kind} preserves prefix ${errorKind} inside a native guard`, async (test) => {
                const s = await setup(test, kind), first = errorKind === 'error' ? new Error('SYNTHETIC_NATIVE_PREFIX_FIRST') : undefined;
                let inside = false, armed = false, normalized: unknown;
                const capture = phases.captureWorkspaceDeletionPhaseSelection;
                vi.spyOn(phases, 'captureWorkspaceDeletionPhaseSelection').mockImplementation(async (input) => {
                    const phase = await capture(input);
                    return { ...phase, async assertExternalSelection() { if (inside && armed)
                            throw first; await phase.assertExternalSelection(); } };
                });
                const method = kind === 'advance' ? 'prepareDirectory' : 'moveSlot';
                const native = s.fs[method].bind(s.fs);
                Object.assign(s.fs, { [method]: async (...args: unknown[]) => {
                        armed = true;
                        try {
                            return await Reflect.apply(native, s.fs, args);
                        }
                        catch (error) {
                            normalized = error;
                            throw error;
                        }
                    } });
                s.setPrefix(async () => { inside = true; });
                const result = await s.outcome();
                expect(result).toEqual({ fulfilled: false, error: first });
                expect(normalized).toMatchObject({ name: 'CrashSafeFileSlotError', failure: 'unavailable' });
                await s.unchanged();
                await expect(s.saved().assertBeforeSlotRead()).rejects.toBe(first);
            });
}
for (const failedPrefix of [false, true])
    it(`obsolete ${failedPrefix ? 'failed' : 'successful'} prefix cannot poison a fresh invocation`, async (test) => {
        const s = await setup(test, 'advance'), first = new Error('SYNTHETIC_OLD_PREFIX_FIRST');
        if (failedPrefix)
            s.setPrefix(async (round) => { if (round === 1)
                s.f.fullProof.mockRejectedValueOnce(first); });
        expect(await s.outcome()).toEqual({ fulfilled: false, error: failedPrefix ? first : reached });
        const old = s.saved(), capture = phases.captureWorkspaceDeletionPhaseSelection;
        let checked = false;
        vi.spyOn(phases, 'captureWorkspaceDeletionPhaseSelection').mockImplementation(async (input) => {
            if (!checked) {
                checked = true;
                const before = s.f.fullProof.mock.calls.length;
                if (failedPrefix)
                    await expect(old.assertBeforeSlotRead()).rejects.toBe(first);
                else
                    await expect(old.assertBeforeSlotRead()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
                expect(s.f.fullProof.mock.calls.length).toBe(before);
            }
            return capture(input);
        });
        s.setPrefix(async () => { });
        if (failedPrefix)
            expect(await s.outcome()).toEqual({ fulfilled: false, error: reached });
        else
            expect((await s.f.run()).phase).toBe('registryPublished');
        expect(checked).toBe(true);
        await s.f.preserved();
    });
it("next-current publication still rejects returned payload inside the second native move", async (test) => {
    const s = await setup(test, 'advance'), move = s.fs.moveSlot.bind(s.fs);
    const paths = [s.f.journalPaths.currentPath, s.f.journalPaths.nextPath, s.f.journalPaths.backupPath];
    const bytes = () => Promise.all(paths.map(path => readFile(path).catch(error => {
        if (error.code === 'ENOENT')
            return undefined;
        throw error;
    })));
    let moves = 0, attempted = false, returned = false, before: (Buffer | undefined)[] = [];
    s.fs.moveSlot = async (...args) => {
        moves++;
        if (args[0] === 'next' && args[1] === 'current') {
            attempted = true;
            before = await bytes();
            await mkdir(s.f.workspace.workspaceRoot, { mode: 0o700 });
            await move(...args);
            returned = true;
            return;
        }
        return move(...args);
    };
    const result = await s.outcome();
    expect(result.fulfilled).toBe(false);
    expect(moves).toBe(2);
    expect(attempted).toBe(true);
    expect(returned).toBe(false);
    expect(s.stats().completed).toBe(false);
    expect(await bytes()).toEqual(before);
    expect(before[0]).toBeUndefined();
    expect(before[1]).toBeDefined();
    expect(before[2]).toEqual(s.f.journalBytes);
    expect(await readFile(s.f.inventoryPaths.currentPath)).toEqual(s.f.inventoryBytes);
    await s.f.preserved();
    await rmdir(s.f.workspace.workspaceRoot);
});
