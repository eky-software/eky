import { promises as fileSystem } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createProfileInspectionDeployment } from './createProfileInspectionDeployment.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fileSystem.rm(root, { force: true, recursive: true })));
});

describe('fixed delivered inspection deployment', () => {
  it('uses the delivered directory contract without loading a database driver', async () => {
    const f = await fixture('export const profileInspectionNativeContract = { directoryName: "inspection-native" };');
    const result = await createProfileInspectionDeployment(f);
    expect(result).toEqual({ backendRoot: f.backendRoot,
      migrationsDirectory: join(f.backendRoot, 'dist', 'database', 'migrations'),
      nativeResourceRoot: join(f.resourcesRoot, 'inspection-native') });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each(['../private', '/private', '..', '', 'name/child', 'name\\child'])
    ('rejects a resource directory outside the delivered root: %s', async directoryName => {
      const f = await fixture(`export const profileInspectionNativeContract = ${JSON.stringify({ directoryName })};`);
      await expect(createProfileInspectionDeployment(f)).rejects.toThrow('PROFILE_INSPECTION_PROTOCOL_INVALID');
    });

  it('does not silently use a default directory when the delivered contract is absent', async () => {
    const f = await fixture('export const unrelated = true;');
    await expect(createProfileInspectionDeployment(f)).rejects.toThrow('PROFILE_INSPECTION_PROTOCOL_INVALID');
  });
});

async function fixture(source: string) {
  const root = await fileSystem.mkdtemp(join(tmpdir(), 'eky-inspection-deployment-'));
  roots.push(root);
  const backendRoot = join(root, 'backend');
  const resourceContract = join(backendRoot, 'dist', 'database', 'connection', 'profileInspectionNativeContract.js');
  await fileSystem.mkdir(join(backendRoot, 'dist', 'database', 'connection'), { recursive: true });
  await fileSystem.writeFile(join(backendRoot, 'package.json'), '{"type":"module"}');
  await fileSystem.writeFile(resourceContract, source);
  return { backendRoot, resourcesRoot: join(root, 'resources') };
}
