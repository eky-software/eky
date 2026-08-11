const fields = new Set([
  'acceptedAt',
  'appVersion',
  'buildRevision',
  'formatVersion',
  'releaseChannel',
]);
const semVerPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const revisionPattern = /^[0-9a-f]{7,40}$/;

export interface AcceptedBuildMetadata {
  acceptedAt: string;
  appVersion: string;
  buildRevision: string;
  formatVersion: 1;
  releaseChannel: 'pilot';
}

export function parseAcceptedBuildMetadata(value: unknown): Readonly<AcceptedBuildMetadata> {
  if (!isRecord(value) || Object.keys(value).length !== fields.size ||
    Object.keys(value).some((key) => !fields.has(key)) ||
    value.formatVersion !== 1 || value.releaseChannel !== 'pilot' ||
    typeof value.appVersion !== 'string' || !semVerPattern.test(value.appVersion) ||
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

function isUtcTimestamp(value: string): boolean {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
