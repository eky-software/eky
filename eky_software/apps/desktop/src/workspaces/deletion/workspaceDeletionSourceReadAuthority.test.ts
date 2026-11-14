import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, type TestContext } from 'vitest';
import { acquireWorkspaceProcessReservation, readWorkspaceProcessReservationIdentity } from '../../runtime/workspaceProcessReservation.js';
import { deletionTestHeader as header, deletionTestId as id } from './workspaceDeletionDataTestSupport.js';
import { captureWorkspaceDeletionInventorySources as capture } from './workspaceDeletionInventorySources.js';
import { workspaceDeletionRemnantReads as nativeReads } from './workspaceDeletionRemnantCensus.js';
import type { WorkspaceDeletionSourceReadAuthority as SourceReadPort } from './workspaceDeletionRemnantCensusSelection.js';
import { deletionRoleSourceFixture as fixture } from './workspaceDeletionRolesTestSupport.js';
import { remnantTestBinding } from './workspaceRemnantBindingTestSupport.js';
import { deriveWorkspaceReplacementRemnantParents } from './workspaceReplacementRemnantPaths.js';

const compareRecords = (source: Awaited<ReturnType<typeof capture>>, port: SourceReadPort) => source.records(port);

const readPort = (f: Awaited<ReturnType<typeof fixture>>, overrides: Partial<SourceReadPort> = {}): SourceReadPort => ({
    assertAuthority: f.authority.assertAuthority,
    assertExternalSelection: async () => { f.authority.assertAuthority(); },
    assertWritersAbsent: f.authority.assertWritersAbsent,
    onFailure: () => undefined,
    ...overrides,
});

async function physicalProof(context: TestContext) {
    const parent = await mkdtemp(join(tmpdir(), 'eky-deletion-source-proof-'));
    const root = join(parent, 'reservation');
    const displaced = join(parent, 'displaced');
    await mkdir(root, { mode: 0o700 });
    const expected = await readWorkspaceProcessReservationIdentity(root);
    const owner = await acquireWorkspaceProcessReservation({ userDataRoot: root, expectedIdentity: expected, signal: context.signal });
    let calls = 0, swapped = false;
    const restore = async () => {
        if (!swapped) return;
        await rm(root, { recursive: true, force: true });
        await rename(displaced, root);
        swapped = false;
    };
    context.onTestFinished(async () => {
        await restore();
        await owner.release();
        if (context.task.result?.state === 'pass') await rm(parent, { recursive: true, force: true });
    });
    return { owner, async assertWritersAbsent() { calls++; await owner.assertOwned(); },
        async swap() { await rename(root, displaced); await mkdir(root, { mode: 0o700 }); swapped = true; },
        restore, reset() { calls = 0; }, calls: () => calls };
}

it('recovery source comparison uses a bounded physical owner while default reads keep the physical proof', async context => {
    const f = await fixture(context), physical = await physicalProof(context);
    const authority = { ...f.authority, assertWritersAbsent: physical.assertWritersAbsent };
    const source = await capture(f.root, header, f.rootIdentity, authority);
    const before = await f.preserved();
    let current = 0;
    physical.reset();
    const port = readPort(f, { assertWritersAbsent: physical.assertWritersAbsent,
        assertRecoverySourceReadCurrent() { current++; context.signal.throwIfAborted(); } });
    expect(await f.collect(compareRecords(source, port))).toEqual([source.workspace]);
    const recoveryPhysical = physical.calls();
    expect(recoveryPhysical).toBeGreaterThan(0);
    expect(current).toBeGreaterThan(recoveryPhysical);
    physical.reset();
    expect(await f.collect(compareRecords(source, readPort(f, { assertWritersAbsent: physical.assertWritersAbsent }))))
        .toEqual([source.workspace]);
    expect(physical.calls()).toBeGreaterThan(recoveryPhysical);
    expect(physical.owner.invalidated.aborted).toBe(false);
    expect(await f.preserved()).toEqual(before);
});

it('recovery source comparison rejects a lost current proof during a held read and joins the read', async context => {
    const f = await fixture(context), physical = await physicalProof(context);
    let armed = false, lost = false, entered!: () => void, release!: () => void;
    const reached = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const reads = { ...nativeReads, async directoryIdentity(...args: Parameters<typeof nativeReads.directoryIdentity>) {
        if (armed) { armed = false; entered(); await held; }
        return nativeReads.directoryIdentity(...args);
    } };
    const source = await capture(f.root, header, f.rootIdentity,
        { ...f.authority, assertWritersAbsent: physical.assertWritersAbsent }, reads);
    const before = await f.preserved();
    const first = new Error('SYNTHETIC_RECOVERY_SOURCE_OWNER_LOST');
    const port = readPort(f, { assertWritersAbsent: physical.assertWritersAbsent,
        assertRecoverySourceReadCurrent() { if (lost) throw first; } });
    armed = true;
    const work = f.collect(compareRecords(source, port)).then(() => ({ rejected: false, error: undefined as unknown }),
        (error: unknown) => ({ rejected: true, error }));
    const abort = () => release();
    context.signal.addEventListener('abort', abort, { once: true });
    try {
        await Promise.race([reached, work]);
        lost = true;
    } finally { release(); await work; context.signal.removeEventListener('abort', abort); }
    expect(await work).toEqual({ rejected: true, error: first });
    await expect(source.assertUnchanged()).rejects.toBe(first);
    expect(await f.preserved()).toEqual(before);
});

it('recovery source comparison rejects a nonvoid asynchronous current proof', async context => {
    const f = await fixture(context), source = await f.capture(), before = await f.preserved();
    const port = readPort(f, { assertRecoverySourceReadCurrent: (() => Promise.reject(
        new Error('SYNTHETIC_ASYNC_PROOF_REJECTED'))) as never });
    await expect(f.collect(compareRecords(source, port))).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
    expect(await f.preserved()).toEqual(before);
});
it.for(['restored', 'default', 'persistent'] as const)(
    'recovery source comparison keeps physical proof at the read boundary: %s', async (mode, context) => {
        const f = await fixture(context), physical = await physicalProof(context);
        const binding = await f.publish(remnantTestBinding());
        await f.payload(join(deriveWorkspaceReplacementRemnantParents(f.root)[1]!.parentPath, binding.operationId));
        let armed = false, switched = false;
        const reads = { ...nativeReads, async openDirectory(path: string) {
            const directory = await nativeReads.openDirectory(path);
            if (!armed) return directory;
            armed = false;
            return { async read() {
                const row = await directory.read();
                if (!switched) { switched = true; await physical.swap(); }
                return row;
            }, async close() {
                await directory.close();
                if (mode !== 'persistent') await physical.restore();
            } };
        } };
        const source = await capture(f.root, header, f.rootIdentity,
            { ...f.authority, assertWritersAbsent: physical.assertWritersAbsent }, reads);
        const before = await f.preserved();
        armed = true;
        const port = readPort(f, { assertWritersAbsent: physical.assertWritersAbsent,
            ...(mode === 'default' ? {} : { assertRecoverySourceReadCurrent() { context.signal.throwIfAborted(); } }) });
        try {
            if (mode === 'restored') {
                const records = await f.collect(compareRecords(source, port));
                expect(records).toContainEqual(source.workspace);
                expect(records.length).toBeGreaterThan(1);
                expect(physical.owner.invalidated.aborted).toBe(false);
            } else {
                await expect(f.collect(compareRecords(source, port))).rejects.toThrow();
            }
            expect(switched).toBe(true);
        } finally { await physical.restore(); }
        expect(await f.preserved()).toEqual(before);
    });
it('source comparison counts full/read authority separately and retains original bytes', async (context) => {
    const f = await fixture(context);
    let full = 0, light = 0, writer = 0;
    const authority = { ...f.authority,
        async assertExternalSelection() { full++; await f.authority.assertExternalSelection(); },
        async assertWritersAbsent() { writer++; await f.authority.assertWritersAbsent(); } };
    const source = await capture(f.root, header, f.rootIdentity, authority);
    const before = await f.preserved();
    full = 0;
    writer = 0;
    const rows = await f.collect(compareRecords(source, readPort(f, {
        async assertExternalSelection() { light++; f.authority.assertAuthority(); },
    })));
    expect(rows).toEqual([source.workspace]);
    expect(full).toBeGreaterThan(0);
    expect(writer).toBeGreaterThan(0);
    expect(light > 0).toBe(true);
    expect(full).toBe(2);
    expect(await f.preserved()).toEqual(before);
});
it.for(['selection', 'writer'] as const)('source comparison rejects persistent %s changes', async (kind, context) => {
    const f = await fixture(context), source = await f.capture(), before = await f.preserved();
    if (kind === 'selection')
        f.changeTarget();
    else
        f.unsettled();
    await expect(f.collect(compareRecords(source, readPort(f)))).rejects.toThrow();
    expect(await f.preserved()).toEqual(before);
});
it('source comparison exposes only the approved restored selection observation difference', async (context) => {
    const f = await fixture(context);
    let transient = false, armed = false, changed = false;
    const authority = { ...f.authority, async assertExternalSelection() {
            await f.authority.assertExternalSelection();
            if (transient)
                throw new Error('SYNTHETIC_TRANSIENT_SELECTION');
        } };
    const source = await capture(f.root, header, f.rootIdentity, authority, { ...nativeReads,
        async directoryIdentity(...args) {
            const value = await nativeReads.directoryIdentity(...args);
            if (armed && !changed) {
                changed = true;
                transient = true;
            }
            return value;
        } });
    const before = await f.preserved();
    armed = true;
    const work = f.collect(compareRecords(source, readPort(f, { async assertExternalSelection() { transient = false; } })));
    expect(await work).toEqual([source.workspace]);
    expect(changed).toBe(true);
    expect(await f.preserved()).toEqual(before);
});
it.for(['expired', 'nonvoidSync', 'nonvoidAsync'] as const)('source comparison validates the new %s port before accepting rows', async (kind, context) => {
    const f = await fixture(context);
    let io = 0, live = true;
    const source = await f.capture({ ...nativeReads, async directoryIdentity(...args) {
            io++;
            return nativeReads.directoryIdentity(...args);
        }, async openDirectory(path) { io++; return nativeReads.openDirectory(path); } });
    const before = await f.preserved(), initialIo = io;
    const port = readPort(f, kind === 'expired' ? {
        assertAuthority() { if (!live)
            throw new Error('SYNTHETIC_EXPIRED_READ'); },
    } : kind === 'nonvoidSync' ? { assertAuthority: () => 1 as never }
        : { assertExternalSelection: async () => 1 as never });
    const rows = compareRecords(source, port);
    expect(io).toBe(initialIo);
    live = false;
    const work = f.collect(rows);
    const result = await work.then(() => ({ rejected: false }), error => ({ rejected: true, error }));
    expect(result.rejected).toBe(true);
    expect(io).toBe(initialIo);
    expect(await f.preserved()).toEqual(before);
});
it.for(['portless', 'scoped'] as const)('source comparison rejects %s overlap without releasing the original reader', async (kind, context) => {
    const f = await fixture(context), source = await f.capture(), before = await f.preserved();
    const port = readPort(f), rows = compareRecords(source, port);
    expect((await rows.next()).value).toEqual(source.workspace);
    const rival = kind === 'portless' ? source.records() : compareRecords(source, readPort(f));
    try {
        await expect(rival.next()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
        await expect(source.assertUnchanged()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
        const third = compareRecords(source, readPort(f));
        await expect(third.next()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
        await third.return(undefined);
        expect((await rows.next()).done).toBe(true);
        await source.assertUnchanged();
    }
    finally {
        await rows.return(undefined);
        await rival.return(undefined);
    }
    expect(await f.preserved()).toEqual(before);
});
it('source comparison retains an undefined first failure for later receipt calls', async (context) => {
    const f = await fixture(context), source = await f.capture();
    let expired = false;
    const port = readPort(f, { assertAuthority() { if (expired)
            throw undefined; } });
    const rows = compareRecords(source, port);
    expect((await rows.next()).done).toBe(false);
    expired = true;
    const result = await rows.next().then(() => ({ failed: false }), cause => ({ failed: true, cause }));
    expect(result).toEqual({ failed: true, cause: undefined });
    await expect(source.assertUnchanged()).rejects.toBeUndefined();
    await expect(source.records().next()).rejects.toBeUndefined();
});
it('source comparison detects persistent payload after the first row and preserves its bytes', async (context) => {
    const f = await fixture(context), source = await f.capture(), rows = compareRecords(source, readPort(f));
    expect((await rows.next()).value).toEqual(source.workspace);
    const path = join(deriveWorkspaceReplacementRemnantParents(f.root)[1]!.parentPath, id(99));
    await f.payload(path);
    const before = await f.preserved();
    await expect(f.collect(rows)).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
    expect(await f.preserved()).toEqual(before);
});
it('source comparison rejects old callbacks during a later valid consumption', async (context) => {
    const f = await fixture(context);
    let armed = false, old: (() => void) | undefined, second = false, rejected = false;
    const source = await f.capture({ ...nativeReads, async directoryIdentity(path, guard) {
            if (armed && old === undefined)
                old = guard;
            if (second && old !== undefined && !rejected) {
                expect(old).toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
                rejected = true;
            }
            return nativeReads.directoryIdentity(path, guard);
        } });
    armed = true;
    const before = await f.preserved();
    expect(await f.collect(compareRecords(source, readPort(f)))).toEqual([source.workspace]);
    second = true;
    expect(await f.collect(compareRecords(source, readPort(f)))).toEqual([source.workspace]);
    expect(rejected).toBe(true);
    expect(await f.preserved()).toEqual(before);
});
it.for([
    { emptyCause: false, namedProof: false }, { emptyCause: true, namedProof: false },
    { emptyCause: false, namedProof: true }, { emptyCause: true, namedProof: true },
])('source comparison keeps a guard failure plus a separate close failure: %j', async ({ emptyCause, namedProof }, context) => {
    const f = await fixture(context), binding = await f.publish(remnantTestBinding());
    await f.payload(join(deriveWorkspaceReplacementRemnantParents(f.root)[1]!.parentPath, binding.operationId));
    let armed = false, lost = false, entered!: () => void, release!: () => void, settled = false;
    const reached = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const first = emptyCause ? undefined : new Error('SYNTHETIC_GUARD_READ_FAILURE');
    const close = new Error('SYNTHETIC_GUARD_CLOSE_FAILURE');
    const authority = { ...f.authority, assertAuthority() {
            f.authority.assertAuthority();
            if (lost && !namedProof)
                throw first;
        } };
    const source = await capture(f.root, header, f.rootIdentity, authority, { ...nativeReads,
        async openDirectory(path) {
            const directory = await nativeReads.openDirectory(path);
            if (!armed)
                return directory;
            return { async read() { const row = await directory.read(); lost = true; return row; }, async close() {
                    entered();
                    await held;
                    await directory.close();
                    throw close;
                } };
        } });
    const before = await f.preserved();
    armed = true;
    const port = readPort(f, { assertAuthority: authority.assertAuthority,
        ...(namedProof ? { assertRecoverySourceReadCurrent() { if (lost) throw first; } } : {}) });
    const work = f.collect(compareRecords(source, port)).then(() => undefined, error => error).finally(() => { settled = true; });
    const abort = () => release();
    context.signal.addEventListener('abort', abort, { once: true });
    try {
        await Promise.race([reached, work]);
        expect(settled).toBe(false);
    }
    finally {
        release();
        await work;
        context.signal.removeEventListener('abort', abort);
    }
    expect(await work).toBeInstanceOf(AggregateError);
    expect((await work as AggregateError).errors).toEqual([first, close]);
    await expect(source.assertUnchanged()).rejects.toBe(first);
    expect(await f.preserved()).toEqual(before);
});
it('source comparison reserves a public read before any scoped rival can start', async (context) => {
    const f = await fixture(context), binding = await f.publish(remnantTestBinding());
    await f.payload(join(deriveWorkspaceReplacementRemnantParents(f.root)[1]!.parentPath, binding.operationId));
    let armed = false, enter!: () => void, release!: () => void;
    const reached = new Promise<void>(resolve => { enter = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const source = await f.capture({ ...nativeReads, async openDirectory(path) {
            const directory = await nativeReads.openDirectory(path);
            if (!armed)
                return directory;
            return { async read() { enter(); await held; return directory.read(); }, close: () => directory.close() };
        } });
    const before = await f.preserved();
    armed = true;
    const work = source.assertUnchanged();
    const abort = () => release();
    context.signal.addEventListener('abort', abort, { once: true });
    try {
        await Promise.race([reached, work]);
        for (let index = 0; index < 2; index++) {
            const rival = compareRecords(source, readPort(f));
            await expect(rival.next()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
            await rival.return(undefined);
        }
    }
    finally {
        release();
        await work;
        context.signal.removeEventListener('abort', abort);
    }
    const rows = await f.collect(compareRecords(source, readPort(f)));
    expect(rows).toContainEqual(source.workspace);
    expect(rows.map(row => row.role).sort()).toEqual([deriveWorkspaceReplacementRemnantParents(f.root)[1]!.role, 'workspace'].sort());
    expect(await f.preserved()).toEqual(before);
});
it('source comparison preserves two portless readers without imposing the new exclusion', async (context) => {
    const f = await fixture(context), source = await f.capture();
    const left = source.records(), right = source.records();
    try {
        expect((await left.next()).value).toEqual(source.workspace);
        expect((await right.next()).value).toEqual(source.workspace);
        expect((await left.next()).done).toBe(true);
        expect((await right.next()).done).toBe(true);
    }
    finally {
        await left.return(undefined);
        await right.return(undefined);
    }
});
it('source comparison awaits held directory close and retains first plus close failure', async (context) => {
    const f = await fixture(context);
    const binding = await f.publish(remnantTestBinding());
    await f.payload(join(deriveWorkspaceReplacementRemnantParents(f.root)[1]!.parentPath, binding.operationId));
    let armed = false, closing!: () => void, release!: () => void, settled = false, opened = 0, closed = 0;
    const entered = new Promise<void>(resolve => { closing = resolve; });
    const pending = new Promise<void>(resolve => { release = resolve; });
    const first = new Error('SYNTHETIC_SOURCE_COMPARISON_READ'), close = new Error('SYNTHETIC_SOURCE_COMPARISON_CLOSE');
    const source = await f.capture({ ...nativeReads, async openDirectory(path) {
            const directory = await nativeReads.openDirectory(path);
            if (!armed)
                return directory;
            opened++;
            return { async read() { throw first; }, async close() {
                    closing();
                    await pending;
                    await directory.close();
                    closed++;
                    throw close;
                } };
        } });
    const before = await f.preserved();
    armed = true;
    const work = f.collect(compareRecords(source, readPort(f))).then(() => undefined, error => error)
        .finally(() => { settled = true; });
    try {
        await Promise.race([entered, work]);
        expect(settled).toBe(false);
        expect(opened).toBe(1);
        expect(closed).toBe(0);
    }
    finally {
        release();
        await work;
    }
    const error = await work;
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors).toEqual([first, close]);
    expect(opened).toBe(closed);
    expect(await f.preserved()).toEqual(before);
    await expect(source.assertUnchanged()).rejects.toBe(error);
});
