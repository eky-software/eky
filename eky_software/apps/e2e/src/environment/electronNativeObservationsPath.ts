import { join } from 'node:path';

const runtimeIdentityPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function electronNativeObservationsPath(artifactsRoot: string, runtimeInstanceId: string): string {
  if (!runtimeIdentityPattern.test(runtimeInstanceId)) throw new Error('E2E_RUNTIME_IDENTITY_INVALID');
  return join(artifactsRoot, `electron-observations-${runtimeInstanceId}.jsonl`);
}
