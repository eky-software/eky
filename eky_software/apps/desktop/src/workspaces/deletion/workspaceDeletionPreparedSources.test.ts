import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, it, vi, type TestContext } from 'vitest';
import { validateWorkspaceBackupImportOperationId } from "../import/workspaceBackupImportOperationId.js";
import { deriveWorkspaceBackupImportPaths } from "../import/workspaceBackupImportPaths.js";
import { deletionTestDigest as hash, deletionTestHeader as header, deletionTestId as id } from "./workspaceDeletionDataTestSupport.js";
import { captureDeletionInventoryRecord, deletionInventoryRecordKey } from './workspaceDeletionInventoryCodec.js';
import { captureWorkspaceDeletionInventorySources as capture } from "./workspaceDeletionInventorySources.js";
import { workspaceDeletionRemnantReads as nativeReads } from "./workspaceDeletionRemnantCensus.js";
import { captureWorkspaceRemnantBinding, serializeWorkspaceRemnantBinding, workspaceRemnantBindingKey, workspaceRemnantBindingSha256 } from './workspaceRemnantBindingCodec.js';
import { createWorkspaceRemnantBindingPaths } from "./workspaceRemnantBindingPaths.js";
import { remnantTestBinding } from "./workspaceRemnantBindingTestSupport.js";
import { deriveWorkspaceReplacementRemnantParents } from "./workspaceReplacementRemnantPaths.js";
import { deletionRoleSourceFixture as fixture } from "./workspaceDeletionRolesTestSupport.js";
import { workspaceDeletionDirectoryEntryPageSize as pageSize } from "./workspaceDeletionDirectoryEntries.js";
import * as census from "./workspaceDeletionRemnantCensus.js";
import { prepareWorkspaceDeletionRemnantBindings as prepareRemnants } from "./workspaceDeletionRemnantCensusSelection.js";
type PreparedRemnants = Awaited<ReturnType<typeof prepareRemnants>>;
type PreparationContext = Parameters<PreparedRemnants["captureInventoryCensus"]>[0];
type SourceObservation = ReturnType<typeof census.observeWorkspaceDeletionRemnants> extends AsyncGenerator<infer Row> ? Row : never;
function track<T>(context: TestContext, work: Promise<T>) {
    context.onTestFinished(async () => { await work.catch(() => undefined); });
    return work;
}
async function preparedFixture(context: TestContext, reads = nativeReads) {
    const f = await fixture(context);
    const prepare = () => track(context, prepareRemnants(f.root, header, f.authority, reads));
    const source = (prepared: PreparedRemnants) => track(context,
        capture(f.root, header, f.rootIdentity, f.authority, reads, undefined, prepared));
    return { ...f, reads, prepare, source, context: { userDataRoot: f.root, target: header,
            baseAuthority: f.authority, reads, originals: undefined } satisfies PreparationContext };
}
it("prepared source one fresh initial scan and every later EOF", async (context) => {
    let passes = 0;
    const original = census.observeWorkspaceDeletionRemnants;
    const spy = vi.spyOn(census, "observeWorkspaceDeletionRemnants").mockImplementation(async function* (...args) {
        passes++;
        yield* original(...args);
    });
    context.onTestFinished(() => spy.mockRestore());
    const f = await preparedFixture(context), before = await f.preserved(), prepared = await f.prepare();
    expect(passes).toBe(2);
    const source = await f.source(prepared);
    expect(passes).toBe(3);
    for (let index = 0; index < 3; index++) {
        expect(await f.collect(source.records())).toEqual([source.workspace]);
        expect(passes).toBe(3 + index + 1);
    }
    expect(await f.preserved()).toEqual(before);
});
it("prepared source persistent foreign side", async (context) => {
    const f = await preparedFixture(context);
    const foreign = await f.publish({ ...remnantTestBinding("workspaceImport"), workspaceId: id(99) });
    const paths = createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(foreign));
    const prepared = await f.prepare(), bytes = await readFile(paths.currentPath);
    await writeFile(paths.nextPath, bytes, { flag: "wx", mode: 0o600 });
    const before = await f.preserved();
    await expect(f.source(prepared)).rejects.toThrow("WORKSPACE_REMNANT_BINDING_INVALID");
    expect(await readFile(paths.nextPath)).toEqual(bytes);
    expect(await f.preserved()).toEqual(before);
    await rm(paths.nextPath);
    await expect(f.source(prepared)).rejects.toThrow("WORKSPACE_REMNANT_BINDING_INVALID");
});
it.for(["raw", "lateForeign", "unknownRoot"] as const)("prepared source rejects persistent %s before returning a source", async (kind, context) => {
    const f = await preparedFixture(context);
    const foreign = await f.publish({ ...remnantTestBinding("workspaceImport"), workspaceId: id(99) });
    const path = createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(foreign)).currentPath;
    const prepared = await f.prepare();
    if (kind === "raw")
        await writeFile(path, ` ${serializeWorkspaceRemnantBinding(foreign).toString("utf8")}`, { mode: 0o600 });
    if (kind === "lateForeign")
        await f.publish({ ...foreign, operationId: id(0) });
    if (kind === "unknownRoot")
        await f.payload(join(deriveWorkspaceReplacementRemnantParents(f.root)[1]!.parentPath, id(98)));
    const before = await f.preserved();
    await expect(f.source(prepared)).rejects.toThrow();
    expect(await f.preserved()).toEqual(before);
});
it.for(["root", "target", "authority", "reads", "originals"] as const)("prepared source rejects mismatched %s without a census or revival", async (kind, context) => {
    const f = await preparedFixture(context), prepared = await f.prepare(), before = await f.preserved();
    const changed = { ...f.context };
    if (kind === "root")
        changed.userDataRoot = join(f.root, "other");
    if (kind === "target")
        changed.target = { ...header, registryEntrySha256: hash("other") };
    if (kind === "authority")
        changed.baseAuthority = { ...f.authority };
    if (kind === "reads")
        changed.reads = { ...f.reads };
    if (kind === "originals")
        Object.assign(changed, { originals: {} });
    let passes = 0;
    const spy = vi.spyOn(census, "observeWorkspaceDeletionRemnants").mockImplementation(async function* () {
        passes++;
        throw new Error("SYNTHETIC_UNEXPECTED_CENSUS");
    });
    context.onTestFinished(() => spy.mockRestore());
    await expect(track(context, prepared.captureInventoryCensus(changed, f.authority, () => { }))).rejects.toThrow();
    await expect(track(context, prepared.captureInventoryCensus(f.context, f.authority, () => { }))).rejects.toThrow();
    expect(passes).toBe(0);
    expect(await f.preserved()).toEqual(before);
});
it("prepared source allows one admission and no invalid preparation fallback", async (context) => {
    const f = await preparedFixture(context), prepared = await f.prepare();
    const source = await f.source(prepared);
    expect(await f.collect(source.records())).toEqual([source.workspace]);
    await expect(f.source(prepared)).rejects.toThrow();
    await expect(track(context, capture(f.root, header, f.rootIdentity, f.authority, f.reads, undefined, {} as PreparedRemnants))).rejects.toThrow();
});
it.for(["lease", "target", "writers"] as const)("prepared source rejects %s loss during held initialization and joins close", async (kind, context) => {
    let armed = false, opened = 0, closed = 0, entered!: () => void, release!: () => void;
    const reached = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const reads = { ...nativeReads, async openDirectory(path: string) {
            const handle = await nativeReads.openDirectory(path);
            if (!armed)
                return handle;
            opened++;
            return { async read() { entered(); await gate; return handle.read(); }, async close() { await handle.close(); closed++; } };
        } };
    const f = await preparedFixture(context, reads);
    await f.publish({ ...remnantTestBinding("workspaceImport"), workspaceId: id(99) });
    const prepared = await f.prepare(), before = await f.preserved();
    armed = true;
    let settled = false;
    const work = f.source(prepared).then(value => ({ value }), error => ({ error })).finally(() => { settled = true; });
    try {
        await Promise.race([reached, work]);
        expect(opened).toBe(1);
        expect(settled).toBe(false);
        expect(closed).toBe(0);
        if (kind === "lease")
            f.expire();
        else if (kind === "target")
            f.changeTarget();
        else
            f.unsettled();
        expect(settled).toBe(false);
    }
    finally {
        release();
        await work;
    }
    expect(await work).toMatchObject({ error: { message: kind === "lease" ? "SYNTHETIC_LEASE_LOST" : kind === "target" ? "SYNTHETIC_TARGET_CHANGED" : "SYNTHETIC_WRITER_UNSETTLED" } });
    expect(closed).toBe(opened);
    expect(await f.preserved()).toEqual(before);
});
it.for(["error", "undefined"] as const)("prepared source preserves read %s before held real close failure", async (kind, context) => {
    let armed = false, entered!: () => void, release!: () => void, closed = 0;
    const reached = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const first = kind === "error" ? new Error("SYNTHETIC_FIRST_READ") : undefined, cleanup = new Error("SYNTHETIC_CLOSE");
    const reads = { ...nativeReads, async openDirectory(path: string) {
            const handle = await nativeReads.openDirectory(path);
            if (!armed)
                return handle;
            return { async read() { throw first; }, async close() { entered(); await gate; await handle.close(); closed++; throw cleanup; } };
        } };
    const f = await preparedFixture(context, reads);
    await f.publish({ ...remnantTestBinding("workspaceImport"), workspaceId: id(99) });
    const prepared = await f.prepare();
    armed = true;
    let settled = false;
    const work = f.source(prepared).then(value => ({ value }), error => ({ error })).finally(() => { settled = true; });
    try {
        await Promise.race([reached, work]);
        expect(settled).toBe(false);
        expect(closed).toBe(0);
    }
    finally {
        release();
        await work;
    }
    const outcome = await work;
    expect(outcome).toMatchObject({ error: { errors: [first, cleanup] } });
    expect(closed).toBe(1);
});
it("prepared source expires escaped observation callbacks without adding preparation to future EOF", async (context) => {
    const f = await preparedFixture(context);
    await f.publish({ ...remnantTestBinding("workspaceImport"), workspaceId: id(99) });
    const prepared = await f.prepare();
    let escaped: (() => Promise<void>) | undefined;
    const receipt = await track(context, prepared.captureInventoryCensus(f.context, f.authority, row => {
        if (row.kind === "metadataCandidate")
            escaped = row.selection.assertSelected;
    }));
    expect(escaped).toBeTypeOf("function");
    await expect(escaped!()).rejects.toThrow();
    await track(context, receipt.assertUnchanged());
    await expect(escaped!()).rejects.toThrow();
});
it.for([1, pageSize - 1, pageSize, pageSize + 1])("prepared source retains page boundary %s and three fresh EOF checks", async (count, context) => {
    const f = await preparedFixture(context), binding = await f.publish(remnantTestBinding("workspaceImport"));
    await f.payload(deriveWorkspaceBackupImportPaths(f.root, validateWorkspaceBackupImportOperationId(binding.operationId), binding.workspaceId).candidateRoot);
    let specimen: Extract<SourceObservation, {
        kind: "metadataCandidate";
    }> | undefined;
    for await (const row of census.observeWorkspaceDeletionRemnants(f.root, f.authority)) {
        if (row.kind === "metadataCandidate")
            specimen = row;
    }
    if (specimen === undefined)
        throw new Error("SYNTHETIC_SPECIMEN_MISSING");
    const original = specimen;
    const synthetic = Array.from({ length: count - 1 }, (_, index) => {
        const binding = captureWorkspaceRemnantBinding({ ...original.selection.binding, operationId: id(100 + index) });
        const bindingSha256 = workspaceRemnantBindingSha256(binding);
        return { ...original, observation: { ...original.observation, key: workspaceRemnantBindingKey(binding),
                binding: { ...original.observation.binding, value: binding, bindingSha256 } },
            selection: { ...original.selection, binding, bindingSha256, rootIdentity: hash("root-" + index) } };
    });
    let scans = 0;
    const spy = vi.spyOn(census, "observeWorkspaceDeletionRemnants").mockImplementation(async function* (_root, authority) {
        scans++;
        authority.assertAuthority();
        for (const row of synthetic) {
            authority.assertAuthority();
            yield row;
            authority.assertAuthority();
        }
    });
    context.onTestFinished(() => spy.mockRestore());
    const prepared = await f.prepare(), source = await f.source(prepared), initial = 3;
    expect(scans).toBe(initial);
    const expected = [source.workspace, ...synthetic.map(row => captureDeletionInventoryRecord({ role: "importCandidate",
            ownerOperationId: row.selection.binding.operationId, generationId: null, member: null,
            bindingSha256: row.selection.bindingSha256, rootIdentity: row.selection.rootIdentity,
            parentIdentity: row.selection.parentIdentity }))].sort((a, b) => deletionInventoryRecordKey(a) < deletionInventoryRecordKey(b) ? -1 : 1);
    for (let pass = 1; pass <= 3; pass++) {
        const rows = await f.collect(source.records());
        expect(rows).toEqual(expected);
        expect(new Set(rows.map(deletionInventoryRecordKey)).size).toBe(count);
        expect(rows.every(Object.isFrozen)).toBe(true);
        expect(scans).toBe(count < pageSize ? initial + pass : initial + 2 + (pass - 1) * 3);
    }
});
it('prepared source rejects a capture-only transient even after restoration', async context => {
    const f = await preparedFixture(context);
    const foreign = await f.publish({ ...remnantTestBinding("workspaceImport"), workspaceId: id(99) });
    const paths = createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(foreign));
    const bytes = await readFile(paths.currentPath), before = await f.preserved();
    let pass = 0;
    const original = census.observeWorkspaceDeletionRemnants;
    const spy = vi.spyOn(census, "observeWorkspaceDeletionRemnants").mockImplementation(async function* (...args) {
        pass++;
        const change = pass === 3;
        if (change)
            await writeFile(paths.nextPath, bytes, { flag: "wx", mode: 0o600 });
        try {
            yield* original(...args);
        }
        finally {
            if (change)
                await rm(paths.nextPath);
        }
    });
    context.onTestFinished(() => spy.mockRestore());
    const prepared = await f.prepare();
    await expect(f.source(prepared)).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
    expect(await f.preserved()).toEqual(before);
});
it.for(["error", "undefined"] as const)("prepared source joins projection %s and actual close before rejecting", async (kind, context) => {
    const f = await preparedFixture(context);
    const binding = await f.publish({ ...remnantTestBinding("workspaceImport"), workspaceId: id(99) });
    const prepared = await f.prepare(), before = await f.preserved();
    const paths = createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(binding));
    const handle = await nativeReads.openDirectory(dirname(paths.currentPath));
    const original = census.observeWorkspaceDeletionRemnants;
    const first = kind === "error" ? new Error("SYNTHETIC_PROJECTION_FIRST") : undefined, cleanup = new Error("SYNTHETIC_PROJECTION_CLOSE");
    let entered!: () => void, release!: () => void, finished!: () => void, closed = 0, settled = false, passes = 0;
    let escaped: (() => Promise<void>) | undefined;
    const reached = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const drained = new Promise<void>(resolve => { finished = resolve; });
    const spy = vi.spyOn(census, "observeWorkspaceDeletionRemnants").mockImplementation(async function* (...args) {
        passes++;
        try {
            yield* original(...args);
        }
        finally {
            entered();
            await gate;
            try {
                await handle.close();
                closed++;
            }
            finally {
                finished();
            }
            throw cleanup;
        }
    });
    context.onTestFinished(() => spy.mockRestore());
    const work = track(context, prepared.captureInventoryCensus(f.context, f.authority, row => {
        if (row.kind === "metadataCandidate") {
            escaped = row.selection.assertSelected;
            throw first;
        }
    }))
        .then(value => ({ value }), error => ({ error })).finally(() => { settled = true; });
    try {
        await Promise.race([reached, work]);
        expect(settled).toBe(false);
        expect(closed).toBe(0);
        expect(escaped).toBeTypeOf("function");
        await expect(escaped!()).rejects.toThrow();
    }
    finally {
        release();
        await drained;
        await work;
    }
    const outcome = await work;
    expect(outcome).toMatchObject({ error: { errors: [first, cleanup] } });
    expect(closed).toBe(1);
    const previous = "error" in outcome ? outcome.error : undefined;
    await expect(track(context, prepared.captureInventoryCensus(f.context, f.authority, () => { }))).rejects.toBe(previous);
    await expect(track(context, prepared.assertUnchanged())).rejects.toBe(previous);
    expect(passes).toBe(1);
    expect(await f.preserved()).toEqual(before);
});
it("prepared source rechecks pinned workspace after the fresh census before returning", async (context) => {
    const f = await preparedFixture(context), prepared = await f.prepare();
    const original = census.observeWorkspaceDeletionRemnants;
    const retained = join(f.root, "retained-workspace");
    const spy = vi.spyOn(census, "observeWorkspaceDeletionRemnants").mockImplementationOnce(async function* (...args) {
        yield* original(...args);
        await rename(f.workspace.workspaceRoot, retained);
        await mkdir(f.workspace.workspaceRoot, { mode: 0o700 });
    });
    context.onTestFinished(() => spy.mockRestore());
    await expect(f.source(prepared)).rejects.toThrow();
    expect(await readFile(join(retained, "retained-payload"), "utf8")).toBe("retained synthetic bytes");
    expect(await readdir(f.workspace.workspaceRoot)).toEqual([]);
});
it('prepared source accepts a transient restored between capture and fresh EOF', async context => {
    const f = await preparedFixture(context);
    const binding = await f.publish({ ...remnantTestBinding("workspaceImport"), workspaceId: id(99) });
    const paths = createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(binding));
    const bytes = await readFile(paths.currentPath), before = await f.preserved(), prepared = await f.prepare();
    const source = await track(context, capture(f.root, header, f.rootIdentity, f.authority, f.reads, undefined, prepared));
    await writeFile(paths.nextPath, bytes, { flag: "wx", mode: 0o600 });
    try {
        expect(await readFile(paths.nextPath)).toEqual(bytes);
    }
    finally {
        await rm(paths.nextPath);
    }
    expect(await f.collect(source.records())).toEqual([source.workspace]);
    expect(await f.preserved()).toEqual(before);
});
it("prepared source keeps an old observation expired during a subsequent held EOF", async (context) => {
    let armed = false, entered!: () => void, release!: () => void, closed = 0;
    const reached = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const reads = { ...nativeReads, async openDirectory(path: string) {
            const handle = await nativeReads.openDirectory(path);
            if (!armed)
                return handle;
            return { async read() { entered(); await gate; return handle.read(); }, async close() { await handle.close(); closed++; } };
        } };
    const f = await preparedFixture(context, reads);
    await f.publish({ ...remnantTestBinding("workspaceImport"), workspaceId: id(99) });
    const prepared = await f.prepare();
    let escaped: (() => Promise<void>) | undefined;
    const receipt = await track(context, prepared.captureInventoryCensus(f.context, f.authority, row => {
        if (row.kind === "metadataCandidate")
            escaped = row.selection.assertSelected;
    }));
    armed = true;
    const work = track(context, receipt.assertUnchanged());
    try {
        await Promise.race([reached, work]);
        expect(escaped).toBeTypeOf("function");
        await expect(escaped!()).rejects.toThrow();
    }
    finally {
        release();
        await work;
    }
    expect(closed).toBeGreaterThan(0);
});
