import { workspaceRegistryInvalid } from './workspaceRegistryError.js';

export const WORKSPACE_LABEL_MAX_CODE_POINTS = 80;

const forbiddenWorkspaceLabelCodePoint =
  /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;

export function validateWorkspaceLabel(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value !== value.trim() ||
    value.length === 0 ||
    [...value].length > WORKSPACE_LABEL_MAX_CODE_POINTS ||
    forbiddenWorkspaceLabelCodePoint.test(value) ||
    containsUnpairedSurrogate(value)
  ) {
    return workspaceRegistryInvalid();
  }
  return value;
}

function containsUnpairedSurrogate(value: string): boolean {
  for (let offset = 0; offset < value.length; offset += 1) {
    const codeUnit = value.charCodeAt(offset);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(offset + 1);
      if (!(nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff)) {
        return true;
      }
      offset += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
}
