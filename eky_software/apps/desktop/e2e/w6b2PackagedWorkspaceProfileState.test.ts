import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { validateWorkspaceId } from '../src/workspaces/registry/workspaceIdValidation.js';
import { readW6b2BusinessAmounts } from './w6b2PackagedWorkspaceBusinessFixture.js';
import {
  parseW6b2PackagedWorkspaceProfileInput,
  parseW6b2PackagedWorkspaceProfileState,
  readW6b2PackagedWorkspaceProfileInput,
  readW6b2PackagedWorkspaceProfileState,
  writeW6b2PackagedWorkspaceProfileState,
  type W6b2PackagedWorkspaceProfileState,
} from './w6b2PackagedWorkspaceProfileState.js';

const temporaryRoots: string[] = [];
const buildRevision = 'a'.repeat(40);

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('W6B.2 packaged workspace profile control contract', () => {
  it('accepts only the exact private source-build input', () => {
    expect(
      parseW6b2PackagedWorkspaceProfileInput({
        formatVersion: 1,
        sourceBuildRevision: buildRevision,
      }),
    ).toEqual({
      formatVersion: 1,
      sourceBuildRevision: buildRevision,
    });
    for (const invalid of [
      { formatVersion: 1, sourceBuildRevision: 'a'.repeat(39) },
      {
        extra: true,
        formatVersion: 1,
        sourceBuildRevision: buildRevision,
      },
      { formatVersion: 2, sourceBuildRevision: buildRevision },
    ]) {
      expect(() =>
        parseW6b2PackagedWorkspaceProfileInput(invalid),
      ).toThrowError('W6B2_PROFILE_INPUT_INVALID');
    }
  });

  it('reads only a bounded regular JSON control file', async () => {
    const root = await createRoot();
    const controlRoot = join(root, 'control');
    await mkdir(controlRoot, { recursive: true });
    await writeFile(
      join(controlRoot, 'w6b2-profile-input-v1.json'),
      JSON.stringify({
        formatVersion: 1,
        sourceBuildRevision: buildRevision,
      }),
    );

    await expect(readW6b2PackagedWorkspaceProfileInput(root)).resolves.toEqual(
      {
        formatVersion: 1,
        sourceBuildRevision: buildRevision,
      },
    );

    await writeFile(
      join(controlRoot, 'w6b2-profile-input-v1.json'),
      '{malformed',
    );
    await expect(
      readW6b2PackagedWorkspaceProfileInput(root),
    ).rejects.toThrowError('W6B2_PROFILE_FILE_INVALID');
  });
});

describe('W6B.2 packaged workspace profile state contract', () => {
  it('accepts exactly one coherent A, B and C fixture', () => {
    expect(parseW6b2PackagedWorkspaceProfileState(createState())).toEqual(
      createState(),
    );
  });

  it('rejects duplicate fixtures, version drift and incoherent business totals', () => {
    const state = createState();
    expect(() =>
      parseW6b2PackagedWorkspaceProfileState({
        ...state,
        fixtures: [state.fixtures[0], state.fixtures[0], state.fixtures[2]],
      }),
    ).toThrowError('W6B2_PROFILE_STATE_INVALID');
    expect(() =>
      parseW6b2PackagedWorkspaceProfileState({
        ...state,
        targetVersion: '0.2.9',
      }),
    ).toThrowError('W6B2_PROFILE_STATE_INVALID');
    expect(() =>
      parseW6b2PackagedWorkspaceProfileState({
        ...state,
        fixtures: state.fixtures.map((fixture, index) =>
          index === 0
            ? {
                ...fixture,
                business: { ...fixture.business, grossCents: 1 },
              }
            : fixture,
        ),
      }),
    ).toThrowError('W6B2_PROFILE_STATE_INVALID');
  });

  it('writes once and reads the exact private state without exposing extra keys', async () => {
    const root = await createRoot();
    const state = createState();

    await writeW6b2PackagedWorkspaceProfileState(root, state);

    await expect(readW6b2PackagedWorkspaceProfileState(root)).resolves.toEqual(
      state,
    );
    const raw = JSON.parse(
      await readFile(
        join(root, 'evidence', 'w6b2-profile-state-v1.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;
    expect(Object.keys(raw).sort()).toEqual([
      'buildRevision',
      'fixtures',
      'formatVersion',
      'sourceVersion',
      'targetVersion',
    ]);
    await expect(
      writeW6b2PackagedWorkspaceProfileState(root, state),
    ).rejects.toMatchObject({ code: 'EEXIST' });
  });
});

function createState(): Readonly<W6b2PackagedWorkspaceProfileState> {
  return Object.freeze({
    buildRevision,
    fixtures: Object.freeze(
      (['A', 'B', 'C'] as const).map((fixtureKey, index) => {
        const amounts = readW6b2BusinessAmounts(fixtureKey);
        const suffix = String(index + 1);
        return Object.freeze({
          baseline: createEvidence(suffix),
          business: Object.freeze({
            companySettingsId: `company-${suffix}`,
            customerId: `customer-${suffix}`,
            customerNumber: `W6B2-${suffix}`,
            documentId: `document-${suffix}`,
            draftId: `draft-${suffix}`,
            draftLineId: `draft-line-${suffix}`,
            grossCents: amounts.grossCents,
            invoiceId: `invoice-${suffix}`,
            invoiceLineId: `invoice-line-${suffix}`,
            invoiceNumber: `62000${suffix}`,
            netCents: amounts.netCents,
            pdfSha256: suffix.repeat(64),
            pdfSize: 100 + index,
            vatCents: amounts.vatCents,
          }),
          fixtureKey,
          profileId: suffix.repeat(64),
          workspaceId: validateWorkspaceId(
            `11111111-1111-4111-8111-11111111111${suffix}`,
          ),
        });
      }),
    ),
    formatVersion: 1,
    sourceVersion: '0.2.7',
    targetVersion: '0.2.8',
  });
}

function createEvidence(seed: string) {
  const file = Object.freeze({ sha256: seed.repeat(64), size: 10 });
  return Object.freeze({
    archiveConfig: file,
    archiveJournal: file,
    archiveSentinel: file,
    businessRowsSha256: seed.repeat(64),
    database: file,
    pdf: file,
    recoverySentinel: file,
    secretSentinel: file,
  });
}

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'eky-w6b2-profile-state-'));
  temporaryRoots.push(root);
  return root;
}
