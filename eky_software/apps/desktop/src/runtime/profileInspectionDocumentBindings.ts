import { createProfileSnapshotArtifactIdentity, type ProfileSnapshotArtifactIdentityItem } from './profileInspectionArtifactIdentity.js';

export const profileInspectionDocumentBindingsFileName = 'cold-document-bindings-v1.json';
export const profileInspectionMaximumCatalogBytes = 64 * 1024 ** 2;
export const profileInspectionMaximumDocumentCount = 100_000;
export const profileInspectionMaximumDocumentBytes = 10 * 1024 ** 2;
export const profileInspectionMaximumDocumentTotalBytes = 20 * 1024 ** 3;
const maximumTextBytes = 1_024;
const utf8 = new TextDecoder('utf-8', { fatal: true });

export interface ProfileInspectionDocumentBinding extends ProfileSnapshotArtifactIdentityItem {
  readonly storagePath: string;
}

export interface ProfileInspectionDocumentSummary {
  readonly artifactCount: number;
  readonly artifactTotalByteSize: number;
  readonly artifactIdentity: string;
}

/** Ephemeral utility output, not a backup catalog or a business read model. */
export function encodeProfileInspectionDocumentBindings(documents: readonly ProfileInspectionDocumentBinding[]): Buffer {
  const parsed = parseDocuments(documents);
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, documents: parsed }), 'utf8');
  if (bytes.length > profileInspectionMaximumCatalogBytes) throw invalid();
  return bytes;
}

export function decodeProfileInspectionDocumentBindings(
  bytes: Buffer, expected: ProfileInspectionDocumentSummary,
): readonly ProfileInspectionDocumentBinding[] {
  if (bytes.length < 1 || bytes.length > profileInspectionMaximumCatalogBytes) throw invalid();
  let value: unknown;
  try { value = JSON.parse(utf8.decode(bytes)); } catch { throw invalid(); }
  const record = dataRecord(value, ['schemaVersion', 'documents']);
  if (record === undefined || record.schemaVersion !== 1) throw invalid();
  const documents = parseDocuments(record.documents);
  const total = documents.reduce((sum, document) => sum + document.byteSize, 0);
  if (documents.length !== expected.artifactCount || total !== expected.artifactTotalByteSize ||
      createProfileSnapshotArtifactIdentity(documents) !== expected.artifactIdentity) throw invalid();
  return documents;
}

function parseDocuments(value: unknown): readonly ProfileInspectionDocumentBinding[] {
  if (!Array.isArray(value) || value.length > profileInspectionMaximumDocumentCount) throw invalid();
  const logicalPaths = new Set<string>();
  const storagePaths = new Set<string>();
  let total = 0;
  let encodedBytes = Buffer.byteLength('{"schemaVersion":1,"documents":[]}', 'utf8');
  const documents: ProfileInspectionDocumentBinding[] = [];
  for (const item of value) {
    const row = dataRecord(item, ['logicalPath', 'storagePath', 'byteSize', 'sha256']);
    if (row === undefined || typeof row.logicalPath !== 'string' ||
        !/^artifacts\/invoicing\/invoice-documents\/[a-f0-9]{64}\.pdf$/.test(row.logicalPath) ||
        !isSafeStoragePath(row.storagePath) || typeof row.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.sha256) ||
        typeof row.byteSize !== 'number' || !Number.isSafeInteger(row.byteSize) || row.byteSize < 5 ||
        row.byteSize > profileInspectionMaximumDocumentBytes) throw invalid();
    const foldedPath = row.storagePath.toLowerCase();
    // Portable files must also be unambiguous when restored on Windows.
    if (logicalPaths.has(row.logicalPath) || storagePaths.has(foldedPath)) throw invalid();
    logicalPaths.add(row.logicalPath);
    storagePaths.add(foldedPath);
    total += row.byteSize;
    if (!Number.isSafeInteger(total) || total > profileInspectionMaximumDocumentTotalBytes) throw invalid();
    const document = Object.freeze({ logicalPath: row.logicalPath, storagePath: row.storagePath,
      byteSize: row.byteSize, sha256: row.sha256 });
    encodedBytes += Buffer.byteLength(JSON.stringify(document), 'utf8') + (documents.length === 0 ? 0 : 1);
    if (encodedBytes > profileInspectionMaximumCatalogBytes) throw invalid();
    documents.push(document);
  }
  return Object.freeze(documents);
}

function isSafeStoragePath(value: unknown): value is string {
  if (typeof value !== 'string' || value === '' || Buffer.byteLength(value, 'utf8') > maximumTextBytes ||
      Buffer.from(value, 'utf8').toString('utf8') !== value || /[\\:\u0000-\u001f\u007f]/u.test(value)) return false;
  return value.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..');
}

function dataRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some(key => typeof key !== 'string' || !keys.includes(key))) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (keys.some(key => !Object.hasOwn(descriptors[key]!, 'value'))) return undefined;
  return Object.fromEntries(keys.map(key => [key, descriptors[key]!.value as unknown]));
}

function invalid(): Error { return new Error('PROFILE_INSPECTION_PROTOCOL_INVALID'); }
