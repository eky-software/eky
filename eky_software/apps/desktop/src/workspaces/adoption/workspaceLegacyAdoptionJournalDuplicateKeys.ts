import { WorkspaceLegacyAdoptionError } from './workspaceLegacyAdoptionError.js';

export function assertNoDuplicateWorkspaceLegacyAdoptionJournalKeys(
  source: string,
): void {
  try {
    const parser = new DuplicateKeyParser(source);
    parser.parseValue();
    parser.skipWhitespace();
    if (!parser.atEnd()) throw new Error('invalid');
  } catch {
    throw new WorkspaceLegacyAdoptionError('WORKSPACE_ADOPTION_INVALID');
  }
}

class DuplicateKeyParser {
  private index = 0;

  constructor(private readonly source: string) {}

  atEnd(): boolean {
    return this.index === this.source.length;
  }

  skipWhitespace(): void {
    while (/\s/u.test(this.source[this.index] ?? '')) this.index += 1;
  }

  parseValue(): void {
    this.skipWhitespace();
    const next = this.source[this.index];
    if (next === '{') return this.parseObject();
    if (next === '[') return this.parseArray();
    if (next === '"') {
      this.parseString();
      return;
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/u.exec(
      this.source.slice(this.index),
    );
    if (match === null) throw new Error('invalid');
    this.index += match[0].length;
  }

  private parseObject(): void {
    this.index += 1;
    this.skipWhitespace();
    const keys = new Set<string>();
    if (this.source[this.index] === '}') {
      this.index += 1;
      return;
    }
    while (true) {
      this.skipWhitespace();
      const key = this.parseString();
      if (keys.has(key)) throw new Error('duplicate');
      keys.add(key);
      this.skipWhitespace();
      this.expect(':');
      this.parseValue();
      this.skipWhitespace();
      if (this.source[this.index] === '}') {
        this.index += 1;
        return;
      }
      this.expect(',');
    }
  }

  private parseArray(): void {
    this.index += 1;
    this.skipWhitespace();
    if (this.source[this.index] === ']') {
      this.index += 1;
      return;
    }
    while (true) {
      this.parseValue();
      this.skipWhitespace();
      if (this.source[this.index] === ']') {
        this.index += 1;
        return;
      }
      this.expect(',');
    }
  }

  private parseString(): string {
    const start = this.index;
    this.expect('"');
    let escaped = false;
    while (this.index < this.source.length) {
      const value = this.source[this.index++];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (value === '\\') {
        escaped = true;
        continue;
      }
      if (value === '"') {
        return JSON.parse(this.source.slice(start, this.index)) as string;
      }
      if (value !== undefined && value < ' ') throw new Error('invalid');
    }
    throw new Error('invalid');
  }

  private expect(expected: string): void {
    if (this.source[this.index] !== expected) throw new Error('invalid');
    this.index += 1;
  }
}
