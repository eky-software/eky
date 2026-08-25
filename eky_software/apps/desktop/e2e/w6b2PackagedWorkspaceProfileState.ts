import {
  lstat,
  mkdir,
  readFile,
  realpath,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { validateWorkspaceId } from '../src/workspaces/registry/workspaceIdValidation.js';
import type { WorkspaceId } from '../src/workspaces/registry/workspaceRegistryTypes.js';
import {
  readW6b2BusinessAmounts,
  type W6b2PackagedWorkspaceBusinessFixture,
  type W6b2PackagedWorkspaceFixtureKey,
} from './w6b2PackagedWorkspaceBusinessFixture.js';
import type { W6b2PackagedWorkspaceEvidence } from './w6b2PackagedWorkspaceEvidence.js';

const profileStateFileName = 'w6b2-profile-state-v1.json';
const profileInputFileName = 'w6b2-profile-input-v1.json';
const maximumControlBytes = 128 * 1024;
const buildRevisionPattern = /^[0-9a-f]{40}$/u;
const profileIdPattern = /^[0-9a-f]{64}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;

export const w6b2PackagedWorkspaceFixtureKeys = Object.freeze([
  'A',
  'B',
  'C',
] as const);

export interface W6b2PackagedWorkspaceProfileInput {
  readonly formatVersion: 1;
  readonly sourceBuildRevision: string;
}

export interface W6b2PersistedWorkspaceFixture {
  readonly baseline: Readonly<W6b2PackagedWorkspaceEvidence>;
  readonly business: Readonly<W6b2PackagedWorkspaceBusinessFixture>;
  readonly fixtureKey: W6b2PackagedWorkspaceFixtureKey;
  readonly profileId: string;
  readonly workspaceId: WorkspaceId;
}

export interface W6b2PackagedWorkspaceProfileState {
  readonly buildRevision: string;
  readonly fixtures: readonly Readonly<W6b2PersistedWorkspaceFixture>[];
  readonly formatVersion: 1;
  readonly sourceVersion: '0.2.7';
  readonly targetVersion: '0.2.8';
}

export async function readW6b2PackagedWorkspaceProfileInput(
  proofRoot: string,
): Promise<Readonly<W6b2PackagedWorkspaceProfileInput>> {
  return parseW6b2PackagedWorkspaceProfileInput(
    await readPrivateJson(join(proofRoot, 'control', profileInputFileName)),
  );
}

export async function readW6b2PackagedWorkspaceProfileState(
  proofRoot: string,
): Promise<Readonly<W6b2PackagedWorkspaceProfileState>> {
  return parseW6b2PackagedWorkspaceProfileState(
    await readPrivateJson(join(proofRoot, 'evidence', profileStateFileName)),
  );
}

export async function writeW6b2PackagedWorkspaceProfileState(
  proofRoot: string,
  state: Readonly<W6b2PackagedWorkspaceProfileState>,
): Promise<void> {
  const validated = parseW6b2PackagedWorkspaceProfileState(state);
  const evidenceRoot = join(proofRoot, 'evidence');
  await mkdir(evidenceRoot, { mode: 0o700, recursive: true });
  const evidenceRootMetadata = await lstat(evidenceRoot);
  if (
    !evidenceRootMetadata.isDirectory() ||
    evidenceRootMetadata.isSymbolicLink() ||
    !samePath(await realpath(evidenceRoot), resolve(evidenceRoot))
  ) {
    throw new Error('W6B2_PROFILE_FILE_INVALID');
  }
  await writeFile(
    join(evidenceRoot, profileStateFileName),
    `${JSON.stringify(validated)}\n`,
    { encoding: 'utf8', flag: 'wx', mode: 0o600 },
  );
}

export function parseW6b2PackagedWorkspaceProfileInput(
  value: unknown,
): Readonly<W6b2PackagedWorkspaceProfileInput> {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['formatVersion', 'sourceBuildRevision']) ||
    value.formatVersion !== 1 ||
    typeof value.sourceBuildRevision !== 'string' ||
    !buildRevisionPattern.test(value.sourceBuildRevision)
  ) {
    throw new Error('W6B2_PROFILE_INPUT_INVALID');
  }
  return Object.freeze({
    formatVersion: 1,
    sourceBuildRevision: value.sourceBuildRevision,
  });
}

export function parseW6b2PackagedWorkspaceProfileState(
  value: unknown,
): Readonly<W6b2PackagedWorkspaceProfileState> {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'buildRevision',
      'fixtures',
      'formatVersion',
      'sourceVersion',
      'targetVersion',
    ]) ||
    value.formatVersion !== 1 ||
    value.sourceVersion !== '0.2.7' ||
    value.targetVersion !== '0.2.8' ||
    typeof value.buildRevision !== 'string' ||
    !buildRevisionPattern.test(value.buildRevision) ||
    !Array.isArray(value.fixtures) ||
    value.fixtures.length !== 3
  ) {
    throw new Error('W6B2_PROFILE_STATE_INVALID');
  }
  const fixtures = value.fixtures.map(parsePersistedFixture);
  if (
    w6b2PackagedWorkspaceFixtureKeys.some(
      (fixtureKey) =>
        fixtures.filter((fixture) => fixture.fixtureKey === fixtureKey)
          .length !== 1,
    )
  ) {
    throw new Error('W6B2_PROFILE_STATE_INVALID');
  }
  return Object.freeze({
    buildRevision: value.buildRevision,
    fixtures: Object.freeze(fixtures),
    formatVersion: 1,
    sourceVersion: '0.2.7',
    targetVersion: '0.2.8',
  });
}

function parsePersistedFixture(
  value: unknown,
): Readonly<W6b2PersistedWorkspaceFixture> {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'baseline',
      'business',
      'fixtureKey',
      'profileId',
      'workspaceId',
    ]) ||
    !w6b2PackagedWorkspaceFixtureKeys.includes(
      value.fixtureKey as W6b2PackagedWorkspaceFixtureKey,
    ) ||
    typeof value.profileId !== 'string' ||
    !profileIdPattern.test(value.profileId) ||
    !isEvidence(value.baseline) ||
    !isBusinessFixture(
      value.business,
      value.fixtureKey as W6b2PackagedWorkspaceFixtureKey,
    )
  ) {
    throw new Error('W6B2_PROFILE_STATE_INVALID');
  }
  return Object.freeze({
    baseline: value.baseline,
    business: value.business,
    fixtureKey: value.fixtureKey as W6b2PackagedWorkspaceFixtureKey,
    profileId: value.profileId,
    workspaceId: validateWorkspaceId(value.workspaceId),
  });
}

function isBusinessFixture(
  value: unknown,
  fixtureKey: W6b2PackagedWorkspaceFixtureKey,
): value is W6b2PackagedWorkspaceBusinessFixture {
  if (!isRecord(value)) return false;
  const amounts = readW6b2BusinessAmounts(fixtureKey);
  return (
    hasExactKeys(value, [
      'companySettingsId',
      'customerId',
      'customerNumber',
      'documentId',
      'draftId',
      'draftLineId',
      'grossCents',
      'invoiceId',
      'invoiceLineId',
      'invoiceNumber',
      'netCents',
      'pdfSha256',
      'pdfSize',
      'vatCents',
    ]) &&
    Object.entries(value).every(([key, item]) =>
      ['grossCents', 'netCents', 'pdfSize', 'vatCents'].includes(key)
        ? typeof item === 'number' && Number.isSafeInteger(item) && item >= 0
        : typeof item === 'string' && item.length > 0 && item.length <= 120,
    ) &&
    value.netCents === amounts.netCents &&
    value.vatCents === amounts.vatCents &&
    value.grossCents === amounts.grossCents &&
    typeof value.pdfSha256 === 'string' &&
    sha256Pattern.test(value.pdfSha256)
  );
}

function isEvidence(value: unknown): value is W6b2PackagedWorkspaceEvidence {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'archiveConfig',
      'archiveJournal',
      'archiveSentinel',
      'businessRowsSha256',
      'database',
      'pdf',
      'recoverySentinel',
      'secretSentinel',
    ]) &&
    typeof value.businessRowsSha256 === 'string' &&
    sha256Pattern.test(value.businessRowsSha256) &&
    [
      value.archiveConfig,
      value.archiveJournal,
      value.archiveSentinel,
      value.database,
      value.pdf,
      value.recoverySentinel,
      value.secretSentinel,
    ].every(isFileEvidence)
  );
}

function isFileEvidence(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['sha256', 'size']) &&
    typeof value.sha256 === 'string' &&
    sha256Pattern.test(value.sha256) &&
    typeof value.size === 'number' &&
    Number.isSafeInteger(value.size) &&
    value.size >= 0
  );
}

async function readPrivateJson(path: string): Promise<unknown> {
  const metadata = await lstat(path);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    metadata.size < 1 ||
    metadata.size > maximumControlBytes ||
    !samePath(await realpath(path), resolve(path))
  ) {
    throw new Error('W6B2_PROFILE_FILE_INVALID');
  }
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    throw new Error('W6B2_PROFILE_FILE_INVALID');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  return (
    actual.length === expectedKeys.length &&
    expectedKeys.every((key, index) => actual[index] === key)
  );
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}
