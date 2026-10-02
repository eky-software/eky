import assert from 'node:assert/strict';
import { link, lstat, mkdir, mkdtemp, open, rename, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  LEGACY_PAYLOAD_OBSERVATIONS,
  classifyLegacyPayloadMsiLog,
  createLegacyPayloadObservation,
} from './legacyPayloadObservation.mjs';

const FILES = ['dxcompiler.dll', 'vk_swiftshader.dll', 'vulkan-1.dll'];
const PREFIXES = ['dxcompiler', 'vkSwiftshader', 'vulkanLoader'];
const ROOT = resolve(tmpdir(), 'eky-payload-parser-synthetic');
const MAX_BYTES = 32 * 1024 * 1024;
const SERVER = 'MSI (s) (10:20) [12:00:00:001]: ';
const START = SERVER + 'Doing action: InstallFiles';
const NEXT = SERVER + 'Doing action: InstallFinalize';
const REMOVE = SERVER + 'Doing action: RemoveExistingProducts';
const EQUAL = "Won't Overwrite; Existing file is of an equal version";
const OVERWRITE = 'Overwrite; Existing file is a lower version';
const unavailableMsi = () => PREFIXES.map(prefix => prefix + 'MsiUnavailable');
const unavailableBytes = () => PREFIXES.map(prefix => prefix + 'BytesUnavailable');

function record(root, name = FILES[0], decision = EQUAL, server = SERVER) {
  return `${server}File: ${resolve(root, name)}; ${decision}`;
}

function windowLog(records, boundary = REMOVE) {
  return [START, ...records, NEXT, boundary].join('\r\n');
}

function assertClosed(codes, length) {
  assert.equal(codes.length, length);
  for (const code of codes) {
    assert.equal(typeof code, 'string');
    assert.ok(LEGACY_PAYLOAD_OBSERVATIONS.includes(code));
    assert.match(code, /^(dxcompiler|vkSwiftshader|vulkanLoader)(Bytes(Unchanged|Changed|Unavailable)|Msi(EqualVersionRetained|OverwriteScheduled|Conflicting|Unavailable))$/);
  }
  assert.doesNotMatch(JSON.stringify(codes), /private-sentinel|\.dll|[\\/]|[a-f0-9]{64}/i);
}

async function observe(observation) {
  const codes = [];
  await observation.observeRejection((...args) => {
    assert.equal(args.length, 1);
    codes.push(args[0]);
  });
  assertClosed(codes, 6);
  return codes;
}

for (const decision of [EQUAL, "Won't Overwrite; Won't patch; Existing file is of an equal version"]) {
  test(`MSI equal-version decision accepts its complete primary form: ${decision.includes("Won't patch") ? 'with patch clause' : 'without patch clause'}`, () => {
    const codes = classifyLegacyPayloadMsiLog(windowLog(FILES.map(name => record(ROOT, name, decision))), ROOT);
    assert.deepEqual(codes, PREFIXES.map(prefix => prefix + 'MsiEqualVersionRetained'));
    assertClosed(codes, 3);
  });
}

for (const reason of ['Existing file is a lower version', 'REINSTALLMODE specifies all files to be overwritten',
  'Existing file is corrupt (invalid checksum)']) {
  test(`MSI overwrite decision remains a schedule observation: ${reason}`, () => {
    assert.deepEqual(classifyLegacyPayloadMsiLog(windowLog([record(ROOT, FILES[0], `Overwrite; ${reason}`)]), ROOT),
      ['dxcompilerMsiOverwriteScheduled', ...unavailableMsi().slice(1)]);
  });
}

test('MSI comparison uses the complete path with Windows case and separator normalization', () => {
  const row = record(ROOT).replace(resolve(ROOT, FILES[0]), resolve(ROOT, FILES[0]).replaceAll('\\', '/').toUpperCase());
  assert.deepEqual(classifyLegacyPayloadMsiLog(windowLog([row]), ROOT),
    ['dxcompilerMsiEqualVersionRetained', ...unavailableMsi().slice(1)]);
});

const preRemovalLogs = [
  ['without InstallFiles start', [SERVER + 'Doing action: FileCost', record(ROOT), NEXT, REMOVE].join('\n')],
  ['during costing before InstallFiles', [SERVER + 'Doing action: FileCost', record(ROOT), START, NEXT, REMOVE].join('\n')],
  ['after the next action', [START, NEXT, record(ROOT), REMOVE].join('\n')],
  ['with another server context', windowLog([record(ROOT, FILES[0], EQUAL, SERVER.replace('(10:20)', '(30:40)'))])],
  ['with repeated InstallFiles actions', [START, record(ROOT), NEXT, START, record(ROOT), NEXT, REMOVE].join('\n')],
];
for (const [label, text] of preRemovalLogs) {
  test(`MSI accepts exact-path pre-removal decisions ${label}`, () => {
    const codes = classifyLegacyPayloadMsiLog(text, ROOT);
    assert.deepEqual(codes, ['dxcompilerMsiEqualVersionRetained', ...unavailableMsi().slice(1)]);
    assertClosed(codes, 3);
  });
}

test('MSI contradictory pre-removal decisions produce only the closed conflicting class', () => {
  const codes = classifyLegacyPayloadMsiLog(windowLog([record(ROOT), record(ROOT, FILES[0], OVERWRITE)]), ROOT);
  assert.deepEqual(codes, ['dxcompilerMsiConflicting', ...unavailableMsi().slice(1)]);
  assertClosed(codes, 3);
});

const invalidLogs = [
  ['same basename in another directory', windowLog([record(resolve(ROOT, 'other'))])],
  ['basename without the installed directory', windowLog([`${SERVER}File: ${FILES[0]}; ${EQUAL}`])],
  ['cross-line decision', windowLog([record(ROOT, FILES[0], "Won't Overwrite"), 'Existing file is of an equal version'])],
  ['client rather than server record', windowLog([record(ROOT, FILES[0], EQUAL, SERVER.replace('(s)', '(c)'))])],
  ['unknown reason', windowLog([record(ROOT, FILES[0], "Won't Overwrite; private-sentinel")])],
  ['unknown clause after a recognized decision', windowLog([record(ROOT, FILES[0], EQUAL + '; private-sentinel')])],
  ['unknown record alongside recognized record', windowLog([record(ROOT), record(ROOT, FILES[0], 'private-sentinel')])],
  ['absent removal boundary', [START, record(ROOT), NEXT].join('\n')],
  ['malformed removal boundary', windowLog([record(ROOT)], REMOVE + ' private-sentinel')],
  ['file record after removal boundary', [START, NEXT, REMOVE, record(ROOT)].join('\n')],
  ['rollback text', windowLog([record(ROOT)]) + '\nRollback: InstallFiles'],
  ['server rollback action', windowLog([record(ROOT)]) + '\n' + SERVER + 'Rolling back action: InstallFiles'],
  ['nul in text', windowLog([record(ROOT)]) + '\0'],
  ['missing text', null],
];
for (const [label, text] of invalidLogs) {
  test(`MSI evidence is unavailable for ${label}`, () => {
    const codes = classifyLegacyPayloadMsiLog(text, ROOT);
    assert.deepEqual(codes, unavailableMsi());
    assertClosed(codes, 3);
  });
}

for (const boundary of [REMOVE, 'Action start 12:00:01: RemoveExistingProducts.']) {
  test(`MSI ignores old-product file decisions beyond ${boundary.startsWith('Action') ? 'action-start' : 'server-action'} removal boundary`, () => {
    const text = windowLog([record(ROOT)], boundary) + '\n' + record(ROOT, FILES[0], OVERWRITE);
    assert.deepEqual(classifyLegacyPayloadMsiLog(text, ROOT),
      ['dxcompilerMsiEqualVersionRetained', ...unavailableMsi().slice(1)]);
  });
}

test('MSI parser refuses text beyond the byte limit', () => {
  assert.deepEqual(classifyLegacyPayloadMsiLog('x'.repeat(MAX_BYTES + 1), ROOT), unavailableMsi());
});

async function fixture(context) {
  const root = await mkdtemp(resolve(tmpdir(), 'eky-payload-observation-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const installRoot = resolve(root, 'payload');
  const logPath = resolve(root, 'majorUpgrade.log');
  await mkdir(installRoot);
  for (const name of FILES) await writeFile(resolve(installRoot, name), 'original');
  const log = windowLog(FILES.map(name => record(installRoot, name)));
  await writeFile(logPath, log);
  return { root, installRoot, logPath, log };
}

test('regular files produce only unchanged, changed and unavailable byte classes and one log read', async (context) => {
  const { installRoot, logPath } = await fixture(context);
  const opened = [];
  let closed = 0;
  const observation = createLegacyPayloadObservation(installRoot, logPath, {
    async openFile(path, mode) {
      opened.push(path);
      const handle = await open(path, mode);
      return {
        stat: options => handle.stat(options),
        read: (...args) => handle.read(...args),
        async close() { await handle.close(); closed += 1; },
      };
    },
  });
  assert.deepEqual(Object.keys(observation).sort(), ['captureSource', 'observeRejection']);
  assert.equal(await observation.captureSource(), undefined);
  assert.equal(opened.includes(logPath), false);
  assert.equal(closed, 3);
  await writeFile(resolve(installRoot, FILES[1]), 'modified');
  await rm(resolve(installRoot, FILES[2]));
  const codes = await observe(observation);
  assert.deepEqual(codes, ['dxcompilerBytesUnchanged', 'vkSwiftshaderBytesChanged', 'vulkanLoaderBytesUnavailable',
    ...PREFIXES.map(prefix => prefix + 'MsiEqualVersionRetained')]);
  assert.equal(opened.filter(path => path === logPath).length, 1);
  assert.equal(closed, opened.length);
});

test('absent capture or missing source never becomes changed-byte evidence', async (context) => {
  const { installRoot, logPath } = await fixture(context);
  const observation = createLegacyPayloadObservation(installRoot, logPath);
  assert.deepEqual((await observe(observation)).slice(0, 3), unavailableBytes());
  await rm(resolve(installRoot, FILES[0]));
  await observation.captureSource();
  await writeFile(resolve(installRoot, FILES[0]), 'modified');
  assert.equal((await observe(observation))[0], 'dxcompilerBytesUnavailable');
});

test('hardlinked payload and log files are rejected without opening their bytes', async (context) => {
  const { root, installRoot, logPath } = await fixture(context);
  const filePath = resolve(installRoot, FILES[0]);
  await link(filePath, resolve(root, 'synthetic-payload-link'));
  await link(logPath, resolve(root, 'synthetic-log-link'));
  const opened = [];
  const observation = createLegacyPayloadObservation(installRoot, logPath, {
    async openFile(path, mode) { opened.push(path); return open(path, mode); },
  });
  await observation.captureSource();
  const codes = await observe(observation);
  assert.equal(codes[0], 'dxcompilerBytesUnavailable');
  assert.deepEqual(codes.slice(3), unavailableMsi());
  assert.equal(opened.includes(filePath), false);
  assert.equal(opened.includes(logPath), false);
});

for (const kind of ['missing', 'directory', 'empty', 'oversize']) {
  test(`bounded file reader rejects ${kind} payload and log without opening them`, async (context) => {
    const { installRoot, logPath } = await fixture(context);
    const filePath = resolve(installRoot, FILES[0]);
    for (const path of [filePath, logPath]) {
      await rm(path);
      if (kind === 'directory') await mkdir(path);
      if (kind === 'empty' || kind === 'oversize') await writeFile(path, '');
      if (kind === 'oversize') await truncate(path, MAX_BYTES + 1);
    }
    const opened = [];
    const observation = createLegacyPayloadObservation(installRoot, logPath, {
      async openFile(path, mode) { opened.push(path); return open(path, mode); },
    });
    await observation.captureSource();
    const codes = await observe(observation);
    assert.equal(codes[0], 'dxcompilerBytesUnavailable');
    assert.deepEqual(codes.slice(3), unavailableMsi());
    assert.equal(opened.includes(filePath), false);
    assert.equal(opened.includes(logPath), false);
  });
}

// Deterministic faults exercise handle checks without scheduling races or installed files.
function faultIo(fault = {}) {
  const filePath = resolve(ROOT, FILES[0]);
  const payload = Buffer.from('data');
  const stable = { isFile: () => true, isSymbolicLink: () => false, nlink: 1n,
    size: 4n, ino: 1n, dev: 1n, mtimeNs: 1n, ctimeNs: 1n };
  const calls = { opens: 0, reads: 0, closes: 0 };
  return {
    calls,
    async readMetadata(path) {
      if (path === ROOT) return { isDirectory: () => true, isSymbolicLink: () => false, ...fault.root };
      if (path !== filePath) throw new Error('private-sentinel');
      return { ...stable, ...fault.before };
    },
    async openFile() {
      calls.opens += 1;
      if (fault.openFails) throw new Error('private-sentinel');
      let stats = 0;
      return {
        async stat() {
          stats += 1;
          return { ...stable, ...fault.actual, ...(stats > 1 ? fault.after : {}) };
        },
        async read(buffer, offset, length, position) {
          calls.reads += 1;
          if (fault.readFails) throw new Error('private-sentinel');
          payload.copy(buffer, offset, position, Math.min(payload.length, position + length));
          return { bytesRead: fault.bytesRead ?? payload.length };
        },
        async close() { calls.closes += 1; },
      };
    },
  };
}

const readFaults = [
  ['symbolic file', { before: { isSymbolicLink: () => true } }],
  ['symbolic root', { root: { isSymbolicLink: () => true } }],
  ['non-directory root', { root: { isDirectory: () => false } }],
  ['open failure', { openFails: true }],
  ['read failure', { readFails: true }],
  ['incomplete read', { bytesRead: 3 }],
  ['extra byte read', { bytesRead: 5 }],
  ['changed handle inode', { actual: { ino: 2n } }],
  ['changed handle device', { actual: { dev: 2n } }],
  ['changed handle type', { actual: { isFile: () => false } }],
  ['changed handle size', { actual: { size: 5n } }],
  ['changed handle timestamp', { actual: { mtimeNs: 2n } }],
  ['hardlinked handle', { actual: { nlink: 2n } }],
  ['size changed during read', { after: { size: 5n } }],
  ['timestamp changed during read', { after: { mtimeNs: 2n } }],
  ['link count changed during read', { after: { nlink: 2n } }],
];
for (const [label, fault] of readFaults) {
  test(`bounded file reader makes ${label} unavailable and closes opened handles`, async () => {
    const io = faultIo(fault);
    const observation = createLegacyPayloadObservation(ROOT, resolve(ROOT, 'majorUpgrade.log'), io);
    await observation.captureSource();
    assert.deepEqual(await observe(observation), [...unavailableBytes(), ...unavailableMsi()]);
    assert.equal(io.calls.closes, fault.openFails ? 0 : io.calls.opens);
    assert.ok(io.calls.reads <= 2);
  });
}

test('pathname replacement during a held read is unavailable, not unchanged', async (context) => {
  const { root, installRoot, logPath } = await fixture(context);
  const filePath = resolve(installRoot, FILES[0]);
  let replaceDuringRead = false;
  let replaced = false;
  const observation = createLegacyPayloadObservation(installRoot, logPath, {
    async openFile(path, mode) {
      const handle = await open(path, mode);
      return {
        stat: options => handle.stat(options),
        async read(...args) {
          const result = await handle.read(...args);
          if (replaceDuringRead && path === filePath && !replaced) {
            await rename(filePath, resolve(root, 'original-private-bytes'));
            await writeFile(filePath, 'modified');
            replaced = true;
          }
          return result;
        },
        close: () => handle.close(),
      };
    },
  });
  await observation.captureSource();
  replaceDuringRead = true;
  const codes = await observe(observation);
  assert.equal(replaced, true);
  assert.equal(codes[0], 'dxcompilerBytesUnavailable');
  assert.equal((await lstat(filePath)).nlink, 1);
});

for (const encoding of ['utf8', 'utf8-bom', 'utf16le-bom']) {
  test(`log reader accepts complete ${encoding} text`, async (context) => {
    const { installRoot, logPath, log } = await fixture(context);
    const bytes = encoding === 'utf16le-bom'
      ? Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(log, 'utf16le')])
      : Buffer.concat([Buffer.from(encoding === 'utf8-bom' ? [0xef, 0xbb, 0xbf] : []), Buffer.from(log)]);
    await writeFile(logPath, bytes);
    const observation = createLegacyPayloadObservation(installRoot, logPath);
    assert.deepEqual((await observe(observation)).slice(3), PREFIXES.map(prefix => prefix + 'MsiEqualVersionRetained'));
  });
}

for (const encoding of ['invalid-utf8', 'incomplete-utf16le', 'unpaired-utf16le', 'utf16be']) {
  test(`log reader treats ${encoding} as unavailable even after a valid decision`, async (context) => {
    const { installRoot, logPath, log } = await fixture(context);
    const bytes = encoding === 'invalid-utf8' ? Buffer.concat([Buffer.from(log), Buffer.from([0xc3, 0x28])])
      : encoding === 'utf16be' ? Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(log, 'utf16le').swap16()])
        : Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(log, 'utf16le'),
          Buffer.from(encoding === 'incomplete-utf16le' ? [0x61] : [0x00, 0xd8])]);
    await writeFile(logPath, bytes);
    const observation = createLegacyPayloadObservation(installRoot, logPath);
    assert.deepEqual((await observe(observation)).slice(3), unavailableMsi());
  });
}

test('throwing report callbacks cannot stop the six closed observations or expose private data', async (context) => {
  const { installRoot, logPath } = await fixture(context);
  const observation = createLegacyPayloadObservation(installRoot, logPath);
  await observation.captureSource();
  const calls = [];
  await assert.doesNotReject(observation.observeRejection((...args) => {
    calls.push(args);
    throw new Error('private-sentinel');
  }));
  assert.ok(calls.every(args => args.length === 1));
  assertClosed(calls.map(args => args[0]), 6);
  await assert.doesNotReject(observation.observeRejection());
});
