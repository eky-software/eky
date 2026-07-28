import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readNewestJsonlLines } from './boundedJsonlSourceReader.js';

const roots: string[] = [];

describe('readNewestJsonlLines', () => {
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('returns complete non-empty lines in newest-first order', () => {
    const filePath = createSource(
      '{"id":"first"}\r\n\n{"id":"second"}\n',
    );

    expect(readNewestJsonlLines(filePath, 1_024)).toEqual({
      bytesRead: Buffer.byteLength(
        '{"id":"first"}\r\n\n{"id":"second"}\n',
      ),
      lines: ['{"id":"second"}', '{"id":"first"}'],
      sourceTruncated: false,
    });
  });

  it('drops a partial oldest line when the byte budget starts inside it', () => {
    const filePath = createSource(
      '{"id":"partial-oldest"}\n{"id":"newest"}\n',
    );
    const maximumBytes = Buffer.byteLength(
      'oldest"}\n{"id":"newest"}\n',
    );

    expect(readNewestJsonlLines(filePath, maximumBytes)).toEqual({
      bytesRead: maximumBytes,
      lines: ['{"id":"newest"}'],
      sourceTruncated: true,
    });
  });

  it('marks a source without a final newline as truncated', () => {
    const filePath = createSource('{"id":"unfinished"}');

    expect(readNewestJsonlLines(filePath, 1_024)).toEqual({
      bytesRead: Buffer.byteLength('{"id":"unfinished"}'),
      lines: ['{"id":"unfinished"}'],
      sourceTruncated: true,
    });
  });

  it('distinguishes an empty regular file from unsafe or missing paths', () => {
    const root = createRoot();
    const emptyFilePath = join(root, 'empty.jsonl');
    const directoryPath = join(root, 'directory.jsonl');
    writeFileSync(emptyFilePath, '', 'utf8');
    mkdirSync(directoryPath);

    expect(readNewestJsonlLines(emptyFilePath, 1_024)).toEqual({
      bytesRead: 0,
      lines: [],
      sourceTruncated: false,
    });
    expect(readNewestJsonlLines(directoryPath, 1_024)).toEqual({
      bytesRead: 0,
      lines: [],
      sourceTruncated: true,
    });
    expect(
      readNewestJsonlLines(join(root, 'missing.jsonl'), 1_024),
    ).toEqual({
      bytesRead: 0,
      lines: [],
      sourceTruncated: true,
    });
  });
});

function createSource(content: string): string {
  const filePath = join(createRoot(), 'source.jsonl');
  writeFileSync(filePath, content, 'utf8');
  return filePath;
}

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'eky-bounded-jsonl-'));
  roots.push(root);
  return root;
}
