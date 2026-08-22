import assert from 'node:assert/strict';
import {
  link,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, test } from 'node:test';

import {
  assertApprovedHistoricalSourceIdentity,
  createGitBlobObjectId,
  parseHistoricalGitTreeManifest,
  validateExtractedHistoricalSource,
  withMaterializedHistoricalWindowsInstallerSource,
} from './materializeHistoricalWindowsInstallerSource.mjs';

const approvedCommit = '6ed99f5319c328f4d3cfbc03b912f21dbc4d1032';
const approvedTree = '324953c8d36a824e6ff4e414afe73f84e7d0d7d7';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

test('parses and hashes a closed regular-file Git tree manifest', () => {
  const first = Buffer.from('first\n');
  const second = Buffer.from('second\n');
  const manifest = Buffer.from(
    `100644 blob ${createGitBlobObjectId(first)} ${first.length}\teky_software/README.md\0` +
      `100755 blob ${createGitBlobObjectId(second)} ${second.length}\teky_software/tool.mjs\0`,
  );

  const parsed = parseHistoricalGitTreeManifest(manifest);

  assert.equal(parsed.entries.length, 2);
  assert.match(parsed.manifestSha256, /^[0-9a-f]{64}$/u);
  assert.equal(parsed.totalSize, first.length + second.length);
});

test('rejects links, submodules, unsafe paths and non-regular tree entries', () => {
  const objectId = 'a'.repeat(40);
  for (const record of [
    `120000 blob ${objectId} 4\teky_software/link\0`,
    `160000 commit ${objectId} -\teky_software/submodule\0`,
    `100644 blob ${objectId} 4\teky_software/../escape\0`,
    `100644 blob ${objectId} 4\teky_software/.gitmodules\0`,
    `100644 blob ${objectId} 4\teky_software/node_modules/file.js\0`,
  ]) {
    assert.throws(
      () => parseHistoricalGitTreeManifest(Buffer.from(record)),
      /HISTORICAL_SOURCE_TREE_(ENTRY_FORBIDDEN|PATH_INVALID)/,
    );
  }
});

test('accepts only the closed historical commit, tree and ancestor relation', () => {
  assert.doesNotThrow(() =>
    assertApprovedHistoricalSourceIdentity({
      commit: approvedCommit,
      isAncestor: true,
      tree: approvedTree,
    }),
  );

  for (const candidate of [
    { commit: 'unknown', isAncestor: true, tree: approvedTree },
    { commit: approvedCommit.slice(0, 12), isAncestor: true, tree: approvedTree },
    { commit: approvedCommit, isAncestor: false, tree: approvedTree },
  ]) {
    assert.throws(
      () => assertApprovedHistoricalSourceIdentity(candidate),
      /HISTORICAL_SOURCE_COMMIT_INVALID/,
    );
  }
  assert.throws(
    () =>
      assertApprovedHistoricalSourceIdentity({
        commit: approvedCommit,
        isAncestor: true,
        tree: 'a'.repeat(40),
      }),
    /HISTORICAL_SOURCE_TREE_MISMATCH/,
  );
});

test('validates extracted bytes against the exact Git object inventory', async () => {
  const root = await createTemporaryDirectory();
  const content = Buffer.from('approved source bytes\n');
  await mkdir(join(root, 'eky_software'), { recursive: true });
  await writeFile(join(root, 'eky_software', 'README.md'), content);

  await assert.doesNotReject(
    validateExtractedHistoricalSource({
      entries: [
        {
          mode: '100644',
          objectId: createGitBlobObjectId(content),
          path: 'eky_software/README.md',
          size: content.length,
        },
      ],
      sourceRoot: root,
    }),
  );
});

test('rejects changed, extra and LFS placeholder files after extraction', async () => {
  const root = await createTemporaryDirectory();
  const approved = Buffer.from('approved\n');
  const filePath = join(root, 'eky_software', 'README.md');
  await mkdir(join(root, 'eky_software'), { recursive: true });
  await writeFile(filePath, 'modified\n');
  const entries = [
    {
      mode: '100644',
      objectId: createGitBlobObjectId(approved),
      path: 'eky_software/README.md',
      size: approved.length,
    },
  ];

  await assert.rejects(
    validateExtractedHistoricalSource({ entries, sourceRoot: root }),
    /HISTORICAL_SOURCE_EXTRACTED_FILE_MISMATCH/,
  );
  await writeFile(filePath, approved);
  await writeFile(join(root, 'eky_software', 'extra.txt'), 'extra\n');
  await assert.rejects(
    validateExtractedHistoricalSource({ entries, sourceRoot: root }),
    /HISTORICAL_SOURCE_EXTRACTED_INVENTORY_MISMATCH/,
  );
  await rm(join(root, 'eky_software', 'extra.txt'));
  const lfsPointer = Buffer.from(
    'version https://git-lfs.github.com/spec/v1\noid sha256:' +
      `${'a'.repeat(64)}\nsize 123\n`,
  );
  await writeFile(filePath, lfsPointer);
  await assert.rejects(
    validateExtractedHistoricalSource({
      entries: [
        {
          ...entries[0],
          objectId: createGitBlobObjectId(lfsPointer),
          size: lfsPointer.length,
        },
      ],
      sourceRoot: root,
    }),
    /HISTORICAL_SOURCE_LFS_POINTER_FORBIDDEN/,
  );
});

test('rejects a hard-linked extracted source file', async () => {
  const root = await createTemporaryDirectory();
  const sourceRoot = join(root, 'source');
  const content = Buffer.from('approved\n');
  const filePath = join(sourceRoot, 'eky_software', 'README.md');
  await mkdir(join(sourceRoot, 'eky_software'), { recursive: true });
  await writeFile(filePath, content);
  await link(filePath, join(root, 'hard-link-proof'));

  await assert.rejects(
    validateExtractedHistoricalSource({
      entries: [
        {
          mode: '100644',
          objectId: createGitBlobObjectId(content),
          path: 'eky_software/README.md',
          size: content.length,
        },
      ],
      sourceRoot,
    }),
    /HISTORICAL_SOURCE_EXTRACTED_FILE_INVALID/,
  );
});

test('materializes the approved source and removes staging after success', async () => {
  let operationRoot;
  const result = await withMaterializedHistoricalWindowsInstallerSource(
    async (materialized) => {
      operationRoot = materialized.operationRoot;
      assert.match(basename(operationRoot), /^[0-9a-f]{16}$/u);
      assert.equal(basename(materialized.sourceRoot), 's');
      assert.equal(
        JSON.parse(
          await readFile(
            join(materialized.workspaceRoot, 'apps/desktop/package.json'),
            'utf8',
          ),
        ).version,
        '0.2.6',
      );
      assert.match(
        materialized.provenance.sourceArchiveManifestSha256,
        /^[0-9a-f]{64}$/u,
      );
      return 'complete';
    },
  );

  assert.equal(result, 'complete');
  await assert.rejects(readFile(join(operationRoot, 'source.tar')));
});

test('removes staging when the materialized-source consumer fails', async () => {
  let operationRoot;
  await assert.rejects(
    withMaterializedHistoricalWindowsInstallerSource(async (materialized) => {
      operationRoot = materialized.operationRoot;
      throw new Error('synthetic consumer failure');
    }),
    /synthetic consumer failure/,
  );
  await assert.rejects(readFile(join(operationRoot, 'source.tar')));
});

test('removes staging when the materialized-source consumer is cancelled', async () => {
  let operationRoot;
  const cancellation = new Error('synthetic cancellation');
  cancellation.name = 'AbortError';
  await assert.rejects(
    withMaterializedHistoricalWindowsInstallerSource(async (materialized) => {
      operationRoot = materialized.operationRoot;
      throw cancellation;
    }),
    (error) => error === cancellation,
  );
  await assert.rejects(readFile(join(operationRoot, 'source.tar')));
});

async function createTemporaryDirectory() {
  const root = await mkdtemp(join(tmpdir(), 'eky-historical-source-'));
  temporaryDirectories.push(root);
  return root;
}
