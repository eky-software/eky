export const profileInspectionNativeContract = Object.freeze({
  schemaVersion: 1,
  purpose: 'profileInspection',
  directoryName: 'profile-inspection-native',
  fileName: 'better_sqlite3.node',
  metadataFileName: 'inspection-native.json',
  packageVersion: '13.0.2',
  addonApiVersion: '8.9.1',
  sourceIntegrity: 'sha512-jW6oufeDhXZaiX9Lw5A+oerVClx4iFrI6uDj1zu7SqUAjak9vbJvA0NEcKLNxHiQHb6kYCoFzzXYV0YOauhV3g==',
  addonApiIntegrity: 'sha512-4eUQWVPCUUUiBjLnHS3cXWeC6ryoPUc0U3rP7IuzapoGbzMqd/r6KKO0clr0b+snQhsrueFEhCZDdK+LK7hxKg==',
  patchIdentity: 'sqlite-memory-accounting-v1',
  sourceDefine: 'SQLITE_DEFAULT_MEMSTATUS=0',
  targetDefine: 'SQLITE_DEFAULT_MEMSTATUS=1',
  nodeVersion: '24.19.0',
  nodeGypVersion: '12.4.0',
  napiVersion: 10,
  minimumNativeBytes: 100_000,
  maximumNativeBytes: 25 * 1024 * 1024,
  maximumMetadataBytes: 16_384,
});

export interface ProfileInspectionNativeMetadata {
  readonly schemaVersion: 1;
  readonly purpose: 'profileInspection';
  readonly packageVersion: string;
  readonly addonApiVersion: string;
  readonly sourceIntegrity: string;
  readonly addonApiIntegrity: string;
  readonly patchIdentity: string;
  readonly sourceIdentity: string;
  readonly patchedSourceIdentity: string;
  readonly platform: 'win32' | 'linux';
  readonly arch: 'x64';
  readonly nodeVersion: string;
  readonly nodeGypVersion: string;
  readonly napiVersion: 10;
  readonly sqliteSourceId: string;
  readonly compileOptions: readonly string[];
  readonly nativeSize: number;
  readonly nativeSha256: string;
}

const metadataKeys = [
  'schemaVersion', 'purpose', 'packageVersion', 'addonApiVersion',
  'sourceIntegrity', 'addonApiIntegrity', 'patchIdentity', 'sourceIdentity',
  'patchedSourceIdentity', 'platform', 'arch', 'nodeVersion', 'nodeGypVersion',
  'napiVersion', 'sqliteSourceId', 'compileOptions', 'nativeSize', 'nativeSha256',
].sort();
const sha256Pattern = /^[0-9a-f]{64}$/;

export function parseProfileInspectionNativeMetadata(
  value: unknown,
  target: { platform: string; arch: string },
): ProfileInspectionNativeMetadata {
  const invalid = () => { throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID'); };
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join('\0') !== metadataKeys.join('\0')) return invalid();
  for (const key of [
    'schemaVersion', 'purpose', 'packageVersion', 'addonApiVersion',
    'sourceIntegrity', 'addonApiIntegrity', 'patchIdentity', 'nodeVersion',
    'nodeGypVersion', 'napiVersion',
  ] as const) {
    if (row[key] !== profileInspectionNativeContract[key]) return invalid();
  }
  if (!['win32', 'linux'].includes(target.platform) || target.arch !== 'x64' ||
      row.platform !== target.platform || row.arch !== target.arch) return invalid();
  for (const key of ['sourceIdentity', 'patchedSourceIdentity', 'nativeSha256']) {
    if (typeof row[key] !== 'string' || !sha256Pattern.test(row[key])) return invalid();
  }
  if (row.sourceIdentity === row.patchedSourceIdentity ||
      !Number.isSafeInteger(row.nativeSize) || typeof row.nativeSize !== 'number' ||
      row.nativeSize < profileInspectionNativeContract.minimumNativeBytes ||
      row.nativeSize > profileInspectionNativeContract.maximumNativeBytes ||
      typeof row.sqliteSourceId !== 'string' ||
      !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [0-9a-f]{40,64}$/.test(row.sqliteSourceId)) return invalid();
  if (!Array.isArray(row.compileOptions) || row.compileOptions.length < 1 ||
      row.compileOptions.length > 128 ||
      row.compileOptions.some(option => typeof option !== 'string' ||
        !/^[A-Za-z0-9_=.,()+ -]{1,128}$/.test(option)) ||
      new Set(row.compileOptions).size !== row.compileOptions.length ||
      row.compileOptions.includes('DEFAULT_MEMSTATUS=0')) return invalid();
  return Object.freeze({ ...row, compileOptions: Object.freeze([...row.compileOptions]) }) as unknown as ProfileInspectionNativeMetadata;
}
