const packageModeFields = new Set(['mode', 'schemaVersion']);

export type DesktopPackageMode = 'localDevelopment' | 'pilot';

export interface DesktopPackageModeInfo {
  mode: DesktopPackageMode;
  schemaVersion: 1;
}

export class DesktopPackageModeValidationError extends Error {
  constructor() {
    super('Desktop package mode is invalid.');
    this.name = 'DesktopPackageModeValidationError';
  }
}

export function createDesktopPackageModeInfo(
  mode: DesktopPackageMode,
): Readonly<DesktopPackageModeInfo> {
  return Object.freeze({ mode, schemaVersion: 1 });
}

export function parseDesktopPackageModeInfo(
  value: unknown,
): Readonly<DesktopPackageModeInfo> {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== packageModeFields.size ||
    Object.keys(value).some((key) => !packageModeFields.has(key)) ||
    value.schemaVersion !== 1 ||
    (value.mode !== 'localDevelopment' && value.mode !== 'pilot')
  ) {
    throw new DesktopPackageModeValidationError();
  }

  return createDesktopPackageModeInfo(value.mode);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
