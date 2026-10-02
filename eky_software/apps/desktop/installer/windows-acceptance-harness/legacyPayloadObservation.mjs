import { createHash } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
import { resolve } from 'node:path';

const MAX_BYTES = 32 * 1024 * 1024;
const CANDIDATES = Object.freeze([
  Object.freeze({ name: 'dxcompiler.dll', code: 'dxcompiler' }),
  Object.freeze({ name: 'vk_swiftshader.dll', code: 'vkSwiftshader' }),
  Object.freeze({ name: 'vulkan-1.dll', code: 'vulkanLoader' }),
]);
const BYTE_CLASSES = ['BytesUnchanged', 'BytesChanged', 'BytesUnavailable'];
const MSI_CLASSES = ['MsiEqualVersionRetained', 'MsiOverwriteScheduled', 'MsiConflicting', 'MsiUnavailable'];
export const LEGACY_PAYLOAD_OBSERVATIONS = Object.freeze(CANDIDATES.flatMap(({ code }) =>
  [...BYTE_CLASSES, ...MSI_CLASSES].map(suffix => code + suffix)));

function windowsPath(path) { return path.replaceAll('/', '\\').toLowerCase(); }

// Deliberately incomplete English MSI grammar. No basename matching or cross-line inference.
export function classifyLegacyPayloadMsiLog(text, installRoot) {
  const unavailable = () => CANDIDATES.map(({ code }) => code + 'MsiUnavailable');
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BYTES || text.includes('\0')) return unavailable();
  const lines = text.split(/\r?\n/);
  const boundary = lines.findIndex(line =>
    /^Action start \d{1,2}:\d{2}:\d{2}: RemoveExistingProducts\.$/.test(line) ||
    /^MSI \(s\) \([\da-f]{2}:[\da-f]{2}\)(?: \[\d{2}:\d{2}:\d{2}:\d{3}\])?: Doing action: RemoveExistingProducts$/i.test(line));
  if (boundary < 0 || lines.some(line => /^Rollback: |^MSI \(s\).*: Rolling back action: /.test(line))) return unavailable();
  const states = CANDIDATES.map(({ name }) => ({
    path: windowsPath(resolve(installRoot, name)), decisions: new Set(), unsupported: false,
  }));
  for (const line of lines.slice(0, boundary)) {
    const record = /^MSI \(s\) \([\da-f]{2}:[\da-f]{2}\)(?: \[\d{2}:\d{2}:\d{2}:\d{3}\])?: File: ([^;]+);(.*)$/i.exec(line);
    if (!record) continue;
    const state = states.find(candidate => candidate.path === windowsPath(record[1]));
    if (!state) continue;
    const tokens = record[2].split(';').map(token => token.trim());
    if (tokens.length === 3 && tokens[1] === "Won't patch") tokens.splice(1, 1);
    if (tokens.length === 2 && tokens[0] === "Won't Overwrite" && tokens[1] === 'Existing file is of an equal version') {
      state.decisions.add('MsiEqualVersionRetained');
    } else if (tokens.length === 2 && tokens[0] === 'Overwrite' && [
      'Existing file is a lower version',
      'REINSTALLMODE specifies all files to be overwritten',
      'Existing file is corrupt (invalid checksum)',
    ].includes(tokens[1])) {
      state.decisions.add('MsiOverwriteScheduled');
    } else state.unsupported = true;
  }
  return states.map((state, index) => CANDIDATES[index].code + (
    state.decisions.size > 1 ? 'MsiConflicting' :
      state.unsupported || state.decisions.size === 0 ? 'MsiUnavailable' : [...state.decisions][0]
  ));
}

async function readBoundedFile(path, { readMetadata, openFile }) {
  let handle;
  try {
    const before = await readMetadata(path, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n ||
        before.size < 1n || before.size > BigInt(MAX_BYTES)) return null;
    handle = await openFile(path, 'r');
    const actual = await handle.stat({ bigint: true });
    if (!actual.isFile() || actual.ino !== before.ino || actual.dev !== before.dev ||
        actual.nlink !== 1n || actual.size !== before.size || actual.mtimeNs !== before.mtimeNs) return null;
    const bytes = Buffer.alloc(Math.min(Number(actual.size) + 1, MAX_BYTES));
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    const after = await handle.stat({ bigint: true });
    if (bytesRead !== Number(actual.size) || after.size !== actual.size ||
        after.mtimeNs !== actual.mtimeNs || after.nlink !== 1n) return null;
    const current = await readMetadata(path, { bigint: true });
    if (!current.isFile() || current.isSymbolicLink() || current.ino !== actual.ino ||
        current.dev !== actual.dev || current.nlink !== 1n || current.size !== actual.size ||
        current.mtimeNs !== actual.mtimeNs) return null;
    return bytes.subarray(0, bytesRead);
  } catch { return null; }
  finally { await handle?.close().catch(() => undefined); }
}

export function createLegacyPayloadObservation(installRoot, logPath, {
  readMetadata = lstat, openFile = open,
} = {}) {
  const io = { readMetadata, openFile };
  let source = null;
  async function fingerprints() {
    const values = CANDIDATES.map(() => null);
    try {
      const root = await readMetadata(installRoot, { bigint: true });
      if (!root.isDirectory() || root.isSymbolicLink()) return values;
      for (const [index, candidate] of CANDIDATES.entries()) {
        const bytes = await readBoundedFile(resolve(installRoot, candidate.name), io);
        if (bytes !== null) values[index] = createHash('sha256').update(bytes).digest('hex');
      }
    } catch { /* Missing evidence is never a negative observation. */ }
    return values;
  }
  return Object.freeze({
    async captureSource() { source = await fingerprints(); },
    async observeRejection(report) {
      function emit(code) {
        try { report?.(code); } catch { /* Optional evidence cannot replace the payload failure. */ }
      }
      const target = await fingerprints();
      for (const [index, candidate] of CANDIDATES.entries()) {
        emit(candidate.code + (source?.[index] == null || target[index] === null
          ? 'BytesUnavailable' : source[index] === target[index] ? 'BytesUnchanged' : 'BytesChanged'));
      }
      let text = null;
      const bytes = await readBoundedFile(logPath, io);
      try {
        if (bytes !== null) text = bytes[0] === 0xff && bytes[1] === 0xfe
          ? new TextDecoder('utf-16le', { fatal: true }).decode(bytes.subarray(2))
          : new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch { /* Unsupported or incomplete text stays unavailable. */ }
      for (const code of classifyLegacyPayloadMsiLog(text, installRoot)) emit(code);
    },
  });
}
