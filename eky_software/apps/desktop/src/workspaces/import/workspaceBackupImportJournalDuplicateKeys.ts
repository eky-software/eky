import {
  workspaceBackupImportJournalInvalid,
} from './workspaceBackupImportJournalError.js';

export function assertNoDuplicateWorkspaceBackupImportJournalKeys(
  source: string,
): void {
  let offset = 0;

  function skipWhitespace(): void {
    while (
      source[offset] === ' ' ||
      source[offset] === '\t' ||
      source[offset] === '\n' ||
      source[offset] === '\r'
    ) {
      offset += 1;
    }
  }

  function readString(): string {
    if (source[offset] !== '"') return workspaceBackupImportJournalInvalid();
    const start = offset;
    offset += 1;
    while (offset < source.length) {
      if (source[offset] === '\\') {
        offset += 2;
        continue;
      }
      if (source[offset] === '"') {
        offset += 1;
        try {
          return JSON.parse(source.slice(start, offset)) as string;
        } catch {
          return workspaceBackupImportJournalInvalid();
        }
      }
      offset += 1;
    }
    return workspaceBackupImportJournalInvalid();
  }

  function readValue(): void {
    skipWhitespace();
    if (source[offset] === '{') return readObject();
    if (source[offset] === '[') return readArray();
    if (source[offset] === '"') {
      readString();
      return;
    }
    const start = offset;
    while (offset < source.length && !isJsonDelimiter(source[offset] ?? '')) {
      offset += 1;
    }
    if (offset === start) return workspaceBackupImportJournalInvalid();
  }

  function readObject(): void {
    const keys = new Set<string>();
    offset += 1;
    skipWhitespace();
    if (source[offset] === '}') {
      offset += 1;
      return;
    }
    while (offset < source.length) {
      skipWhitespace();
      const key = readString();
      if (keys.has(key)) return workspaceBackupImportJournalInvalid();
      keys.add(key);
      skipWhitespace();
      if (source[offset] !== ':') return workspaceBackupImportJournalInvalid();
      offset += 1;
      readValue();
      skipWhitespace();
      if (source[offset] === '}') {
        offset += 1;
        return;
      }
      if (source[offset] !== ',') return workspaceBackupImportJournalInvalid();
      offset += 1;
    }
    return workspaceBackupImportJournalInvalid();
  }

  function readArray(): void {
    offset += 1;
    skipWhitespace();
    if (source[offset] === ']') {
      offset += 1;
      return;
    }
    while (offset < source.length) {
      readValue();
      skipWhitespace();
      if (source[offset] === ']') {
        offset += 1;
        return;
      }
      if (source[offset] !== ',') return workspaceBackupImportJournalInvalid();
      offset += 1;
    }
    return workspaceBackupImportJournalInvalid();
  }

  readValue();
  skipWhitespace();
  if (offset !== source.length) return workspaceBackupImportJournalInvalid();
}

function isJsonDelimiter(value: string): boolean {
  return (
    value === ' ' ||
    value === '\t' ||
    value === '\n' ||
    value === '\r' ||
    value === ',' ||
    value === ']' ||
    value === '}'
  );
}
