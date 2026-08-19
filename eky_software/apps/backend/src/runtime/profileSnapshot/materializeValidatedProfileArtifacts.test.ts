import { createHash } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { materializeValidatedProfileArtifacts } from './materializeValidatedProfileArtifacts.js';
import type { ValidatedProfileArtifact } from './validateProfileArtifactCatalog.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) =>
      rm(path, { force: true, recursive: true }),
    ),
  );
});

describe('materializeValidatedProfileArtifacts', () => {
  it('copies validated artifacts to an empty private destination', async () => {
    const fixture = await createFixture();
    const first = await addArtifact(fixture, 'first', 'company/invoice-1.pdf');
    const second = await addArtifact(fixture, 'second', 'company/invoice-2.pdf');

    await materializeValidatedProfileArtifacts({
      artifacts: [first.artifact, second.artifact],
      destinationRoot: fixture.destinationRoot,
      sourceRoot: fixture.sourceRoot,
    });

    await expect(readFile(first.destinationPath)).resolves.toEqual(first.content);
    await expect(readFile(second.destinationPath)).resolves.toEqual(second.content);
    await expect(lstat(first.destinationPath)).resolves.toMatchObject({ nlink: 1 });
  });

  it('rejects a source changed after validation and removes partial output', async () => {
    const fixture = await createFixture();
    const first = await addArtifact(fixture, 'first', 'company/invoice-1.pdf');
    const second = await addArtifact(fixture, 'second', 'company/invoice-2.pdf');
    await writeFile(second.sourcePath, '%PDF-1.7\nchanged\n');

    const result = materializeValidatedProfileArtifacts({
      artifacts: [first.artifact, second.artifact],
      destinationRoot: fixture.destinationRoot,
      sourceRoot: fixture.sourceRoot,
    });

    await expect(result).rejects.toThrow(
      'PROFILE_ARTIFACT_MATERIALIZATION_FAILED',
    );
    await expect(lstat(fixture.destinationRoot)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('does not overwrite or remove a pre-existing destination', async () => {
    const fixture = await createFixture();
    const item = await addArtifact(fixture, 'first', 'company/invoice-1.pdf');
    const sentinelPath = join(fixture.destinationRoot, 'existing.txt');
    await writeFile(sentinelPath, 'keep');

    await expect(
      materializeValidatedProfileArtifacts({
        artifacts: [item.artifact],
        destinationRoot: fixture.destinationRoot,
        sourceRoot: fixture.sourceRoot,
      }),
    ).rejects.toThrow('PROFILE_ARTIFACT_MATERIALIZATION_FAILED');
    await expect(readFile(sentinelPath, 'utf8')).resolves.toBe('keep');
  });

  it('returns only a safe error without local path details', async () => {
    const fixture = await createFixture();
    const item = await addArtifact(fixture, 'missing', 'company/invoice.pdf');
    await rm(item.sourcePath);

    const result = materializeValidatedProfileArtifacts({
      artifacts: [item.artifact],
      destinationRoot: fixture.destinationRoot,
      sourceRoot: fixture.sourceRoot,
    });

    await expect(result).rejects.toThrow(
      'PROFILE_ARTIFACT_MATERIALIZATION_FAILED',
    );
    await result.catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(fixture.root);
      expect(message).not.toContain('missing.pdf');
      expect(message).not.toContain('stack');
    });
  });
});

interface Fixture {
  destinationRoot: string;
  root: string;
  sourceRoot: string;
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'eky-artifact-materialize-'));
  temporaryRoots.push(root);
  const sourceRoot = join(root, 'source');
  const destinationRoot = join(root, 'destination');
  await createPrivateDirectory(sourceRoot);
  await createPrivateDirectory(destinationRoot);
  return { destinationRoot, root, sourceRoot };
}

async function addArtifact(
  fixture: Fixture,
  name: string,
  storagePath: string,
): Promise<{
  artifact: ValidatedProfileArtifact;
  content: Buffer;
  destinationPath: string;
  sourcePath: string;
}> {
  const logicalPath = `artifacts/${name}.pdf`;
  const sourcePath = join(fixture.sourceRoot, ...logicalPath.split('/'));
  const destinationPath = join(
    fixture.destinationRoot,
    ...storagePath.split('/'),
  );
  const content = Buffer.from(`%PDF-1.7\n${name}\n`, 'utf8');
  await createPrivateDirectory(join(fixture.sourceRoot, 'artifacts'));
  await writeFile(sourcePath, content, { mode: 0o600 });
  return {
    artifact: {
      byteSize: content.byteLength,
      logicalPath,
      sha256: createHash('sha256').update(content).digest('hex'),
      storagePath,
    },
    content,
    destinationPath,
    sourcePath,
  };
}

async function createPrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { mode: 0o700, recursive: true });
  if (process.platform !== 'win32') await chmod(path, 0o700);
}
