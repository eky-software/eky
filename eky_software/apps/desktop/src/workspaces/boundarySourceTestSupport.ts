import { readFile } from 'node:fs/promises';

export const boundarySourceReadBatchSize = 8;

export async function inspectBoundarySourcesForTest(
  sourceFiles: readonly string[],
  inspectSource: (source: string, sourceFile: string) => void,
  readSource: (sourceFile: string) => Promise<string> = (sourceFile) => readFile(sourceFile, 'utf8'),
): Promise<void> {
  for (let offset = 0; offset < sourceFiles.length; offset += boundarySourceReadBatchSize) {
    const batch = sourceFiles.slice(offset, offset + boundarySourceReadBatchSize);
    // Settle the entire owned batch before exposing any read or assertion error.
    const sources = await Promise.allSettled(batch.map(async (sourceFile) => ({
      sourceFile,
      source: await readSource(sourceFile),
    })));

    for (const source of sources) {
      if (source.status === 'rejected') throw source.reason;
      inspectSource(source.value.source, source.value.sourceFile);
    }
  }
}
