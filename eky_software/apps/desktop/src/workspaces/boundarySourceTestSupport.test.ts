import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';

import { describe, expect, it, vi } from 'vitest';

import {
  boundarySourceReadBatchSize,
  inspectBoundarySourcesForTest,
} from './boundarySourceTestSupport.js';

describe('workspace boundary source reading', () => {
  it('is excluded from the production build through the existing test-support rule', async () => {
    const configuration = JSON.parse(await readFile(
      new URL('../../tsconfig.build.json', import.meta.url), 'utf8',
    )) as { exclude?: unknown };
    expect(configuration.exclude).toContain('src/**/*TestSupport.ts');
  });

  it('bounds reads and inspects every source in order including test files and the final partial batch', async () => {
    const sourceFiles = Array.from(
      { length: boundarySourceReadBatchSize * 2 + 1 },
      (_, index) => `source-${index}.test.ts`,
    );
    let activeReads = 0;
    let peakReads = 0;
    const readSource = vi.fn(async (file: string) => {
      activeReads += 1;
      peakReads = Math.max(peakReads, activeReads);
      await Promise.resolve();
      activeReads -= 1;
      return `contents:${file}`;
    });
    const inspectSource = vi.fn((_source: string, _file: string) => {
      expect(activeReads).toBe(0);
    });

    await inspectBoundarySourcesForTest(sourceFiles, inspectSource, readSource);

    expect(readSource.mock.calls.map(([file]) => file)).toEqual(sourceFiles);
    expect(inspectSource.mock.calls).toEqual(sourceFiles.map((file) => [`contents:${file}`, file]));
    expect(peakReads).toBe(boundarySourceReadBatchSize);
    expect(activeReads).toBe(0);
  });

  it.each(['synchronous', 'asynchronous'] as const)(
    'drains a batch before its %s read failure and starts no later batch',
    async (failureMode) => {
      const sourceFiles = Array.from(
        { length: boundarySourceReadBatchSize + 1 },
        (_, index) => `source-${index}.ts`,
      );
      const readFailure = new Error('SOURCE_READ_FAILED');
      let releaseReads!: () => void;
      const pendingReads = new Promise<void>((resolve) => { releaseReads = resolve; });
      const readSource = vi.fn((file: string): Promise<string> => {
        if (file === sourceFiles[0]) {
          if (failureMode === 'synchronous') throw readFailure;
          return Promise.reject(readFailure);
        }
        return pendingReads.then(() => '');
      });
      const inspectSource = vi.fn();
      let finished = false;
      const result = inspectBoundarySourcesForTest(sourceFiles, inspectSource, readSource).then(
        () => { finished = true; return undefined; },
        (error: unknown) => { finished = true; return error; },
      );

      try {
        await setImmediate();
        expect(finished).toBe(false);
        expect(readSource.mock.calls.map(([file]) => file)).toEqual(sourceFiles.slice(0, boundarySourceReadBatchSize));
        expect(inspectSource).not.toHaveBeenCalled();
      } finally {
        releaseReads();
      }

      expect(await result).toBe(readFailure);
      expect(readSource).toHaveBeenCalledTimes(boundarySourceReadBatchSize);
      expect(inspectSource).not.toHaveBeenCalled();
    },
  );

  it('preserves source-order error selection when a later read fails first', async () => {
    const firstFailure = new Error('FIRST_SOURCE_FAILED');
    const laterFailure = new Error('LATER_SOURCE_FAILED');
    const inspectSource = vi.fn();
    await expect(inspectBoundarySourcesForTest(['first.ts', 'later.ts'], inspectSource, async (file) => {
      if (file === 'first.ts') {
        await setImmediate();
        throw firstFailure;
      }
      throw laterFailure;
    })).rejects.toBe(firstFailure);
    expect(inspectSource).not.toHaveBeenCalled();
  });

  it('keeps an inspection failure and starts no later batch', async () => {
    const sourceFiles = Array.from(
      { length: boundarySourceReadBatchSize + 1 },
      (_, index) => `source-${index}.ts`,
    );
    const inspectionFailure = new Error('BOUNDARY_VIOLATION');
    const readSource = vi.fn(async (_file: string) => '');
    const inspectSource = vi.fn(() => { throw inspectionFailure; });
    await expect(inspectBoundarySourcesForTest(sourceFiles, inspectSource, readSource))
      .rejects.toBe(inspectionFailure);
    expect(readSource).toHaveBeenCalledTimes(boundarySourceReadBatchSize);
    expect(inspectSource).toHaveBeenCalledTimes(1);
  });

  it('does not read or inspect an empty source list', async () => {
    const readSource = vi.fn(async () => '');
    const inspectSource = vi.fn();
    await inspectBoundarySourcesForTest([], inspectSource, readSource);
    expect(readSource).not.toHaveBeenCalled();
    expect(inspectSource).not.toHaveBeenCalled();
  });
});
