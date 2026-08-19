import { WorkspaceSwitchError } from './workspaceSwitchError.js';

export function assertNoDuplicateWorkspaceSwitchJournalKeys(
  source: string,
): void {
  let offset = 0;

  function invalid(): never {
    throw new WorkspaceSwitchError('WORKSPACE_SWITCH_INVALID');
  }

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
    if (source[offset] !== '"') return invalid();
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
          return invalid();
        }
      }
      offset += 1;
    }
    return invalid();
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
    if (offset === start) return invalid();
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
      if (keys.has(key)) return invalid();
      keys.add(key);
      skipWhitespace();
      if (source[offset] !== ':') return invalid();
      offset += 1;
      readValue();
      skipWhitespace();
      if (source[offset] === '}') {
        offset += 1;
        return;
      }
      if (source[offset] !== ',') return invalid();
      offset += 1;
    }
    return invalid();
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
      if (source[offset] !== ',') return invalid();
      offset += 1;
    }
    return invalid();
  }

  readValue();
  skipWhitespace();
  if (offset !== source.length) invalid();
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
