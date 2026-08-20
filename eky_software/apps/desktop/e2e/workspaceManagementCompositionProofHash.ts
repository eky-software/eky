import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export async function snapshotActiveWorkspace(input: {
  readonly databasePath: string;
  readonly pdfPath: string;
}) {
  return Object.freeze({
    databaseHash: await sha256File(input.databasePath),
    pdfHash: await sha256File(input.pdfPath),
  });
}

export async function sha256File(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

export async function sha256Tree(root: string): Promise<string> {
  const hash = createHash('sha256');
  await appendDirectoryHash(hash, root, '');
  return hash.digest('hex');
}

export function snapshotsEqual(first: unknown, second: unknown): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

async function appendDirectoryHash(
  hash: ReturnType<typeof createHash>,
  root: string,
  relativeRoot: string,
): Promise<void> {
  const entries = await readdir(join(root, relativeRoot), {
    withFileTypes: true,
  });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const relativePath = join(relativeRoot, entry.name);
    if (entry.isDirectory()) {
      hash.update(`directory:${relativePath}\n`);
      await appendDirectoryHash(hash, root, relativePath);
      continue;
    }
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error('WORKSPACE_COMPOSITION_PROOF_FAILED');
    }
    hash.update(`file:${relativePath}\n`);
    hash.update(await readFile(join(root, relativePath)));
  }
}
