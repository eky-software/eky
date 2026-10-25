import { isSemVer } from '../release/desktopBuildInfo.js';
import { compareSemanticVersions } from './semanticVersionComparison.js';

const fields = new Set([
  'acceptedAt',
  'appVersion',
  'buildRevision',
  'formatVersion',
  'releaseChannel',
]);
const revisionPattern = /^[0-9a-f]{7,40}$/;
const scopedFields = new Set([
  'acceptanceScope',
  'acceptedBuild',
  'businessBaseline',
  'formatVersion',
]);

export interface AcceptedBuildMetadata {
  acceptedAt: string;
  appVersion: string;
  buildRevision: string;
  formatVersion: 1;
  releaseChannel: 'pilot';
}

export interface ScopedAcceptedBuildMetadata {
  readonly formatVersion: 2;
  readonly acceptanceScope: 'selector' | 'business';
  readonly acceptedBuild: Readonly<AcceptedBuildMetadata>;
  readonly businessBaseline: Readonly<AcceptedBuildMetadata>;
}

export type VersionedAcceptedBuildMetadata =
  | Readonly<AcceptedBuildMetadata>
  | Readonly<ScopedAcceptedBuildMetadata>;

export function parseAcceptedBuildMetadata(value: unknown): Readonly<AcceptedBuildMetadata> {
  if (!isRecord(value) || Object.keys(value).length !== fields.size ||
    Object.keys(value).some((key) => !fields.has(key)) ||
    value.formatVersion !== 1 || value.releaseChannel !== 'pilot' ||
    typeof value.appVersion !== 'string' || !isSemVer(value.appVersion) ||
    typeof value.buildRevision !== 'string' || !revisionPattern.test(value.buildRevision) ||
    typeof value.acceptedAt !== 'string' || !isUtcTimestamp(value.acceptedAt)) {
    throw new Error('ACCEPTED_BUILD_METADATA_INVALID');
  }
  return Object.freeze({
    acceptedAt: value.acceptedAt,
    appVersion: value.appVersion,
    buildRevision: value.buildRevision,
    formatVersion: 1,
    releaseChannel: 'pilot',
  });
}

export function parseVersionedAcceptedBuildMetadata(value: unknown): VersionedAcceptedBuildMetadata {
  if (isRecord(value) && value.formatVersion === 1) {
    return parseAcceptedBuildMetadata(value);
  }
  if (!isRecord(value) || Object.keys(value).length !== scopedFields.size ||
    Object.keys(value).some(key => !scopedFields.has(key)) ||
    value.formatVersion !== 2 ||
    (value.acceptanceScope !== 'selector' && value.acceptanceScope !== 'business')) {
    throw new Error('ACCEPTED_BUILD_METADATA_INVALID');
  }
  const acceptedBuild = parseAcceptedBuildMetadata(value.acceptedBuild);
  const businessBaseline = parseAcceptedBuildMetadata(value.businessBaseline);
  if (value.acceptanceScope === 'business'
    ? !sameAcceptedMetadata(acceptedBuild, businessBaseline)
    : compareSemanticVersions(acceptedBuild.appVersion, businessBaseline.appVersion) <= 0 ||
      acceptedBuild.releaseChannel !== businessBaseline.releaseChannel) {
    throw new Error('ACCEPTED_BUILD_METADATA_INVALID');
  }
  return Object.freeze({
    formatVersion: 2,
    acceptanceScope: value.acceptanceScope,
    acceptedBuild,
    businessBaseline,
  });
}

export function readAcceptedApplicationBuild(value: VersionedAcceptedBuildMetadata): Readonly<AcceptedBuildMetadata> {
  return value.formatVersion === 1 ? value : value.acceptedBuild;
}

export function readAcceptedBusinessBaseline(value: VersionedAcceptedBuildMetadata): Readonly<AcceptedBuildMetadata> {
  return value.formatVersion === 1 ? value : value.businessBaseline;
}

export function readAcceptedBusinessBuild(value: VersionedAcceptedBuildMetadata): Readonly<AcceptedBuildMetadata> | undefined {
  return value.formatVersion === 1
    ? value
    : value.acceptanceScope === 'business' ? value.acceptedBuild : undefined;
}

export function createBusinessAcceptedBuildMetadata(
  previous: VersionedAcceptedBuildMetadata | undefined,
  target: Readonly<AcceptedBuildMetadata>,
): VersionedAcceptedBuildMetadata {
  const acceptedBuild = parseAcceptedBuildMetadata(target);
  return previous?.formatVersion === 2
    ? Object.freeze({ formatVersion: 2, acceptanceScope: 'business', acceptedBuild, businessBaseline: acceptedBuild })
    : acceptedBuild;
}

// This only constructs validated metadata; publication still requires the owning startup gates.
export function createSelectorAcceptedBuildMetadata(
  previous: VersionedAcceptedBuildMetadata,
  target: Readonly<AcceptedBuildMetadata>,
): Readonly<ScopedAcceptedBuildMetadata> {
  const source = parseVersionedAcceptedBuildMetadata(previous);
  const acceptedBuild = parseAcceptedBuildMetadata(target);
  if (compareSemanticVersions(acceptedBuild.appVersion, readAcceptedApplicationBuild(source).appVersion) <= 0) {
    throw new Error('ACCEPTED_BUILD_METADATA_INVALID');
  }
  return Object.freeze({
    formatVersion: 2,
    acceptanceScope: 'selector',
    acceptedBuild,
    businessBaseline: readAcceptedBusinessBaseline(source),
  });
}

function sameAcceptedMetadata(left: Readonly<AcceptedBuildMetadata>, right: Readonly<AcceptedBuildMetadata>): boolean {
  return left.appVersion === right.appVersion &&
    left.buildRevision === right.buildRevision &&
    left.releaseChannel === right.releaseChannel &&
    left.acceptedAt === right.acceptedAt;
}

function isUtcTimestamp(value: string): boolean {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
