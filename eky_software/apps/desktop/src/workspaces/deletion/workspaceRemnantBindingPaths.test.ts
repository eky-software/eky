import { basename } from 'node:path';
import { expect, it } from 'vitest';
import { deletionTestId as id } from './workspaceDeletionDataTestSupport.js';
import { workspaceRemnantBindingKey, workspaceRemnantBindingOwners } from './workspaceRemnantBindingCodec.js';
import { createWorkspaceRemnantBindingPaths, parseWorkspaceRemnantBindingSlotName as parseName } from './workspaceRemnantBindingPaths.js';
import { remnantTestBinding } from './workspaceRemnantBindingTestSupport.js';

for (const owner of workspaceRemnantBindingOwners) {
  it(`roundtrips all current-owner slot names for ${owner} through the actual path owner`, () => {
    const key = workspaceRemnantBindingKey(remnantTestBinding(owner));
    // Only the basename is tested; the root is the test process's current directory.
    const paths = createWorkspaceRemnantBindingPaths(process.cwd(), key);
    for (const slot of ['current', 'next', 'backup'] as const) {
      const name = basename(paths[`${slot}Path`]);
      expect(parseName(owner, name)).toEqual({ key, slot, stem: name.split('.json')[0] });
    }
  });
}

it.for(['', 'unknown.json', '../outside.json', `../${id(1)}.json`, `${id(1)}.json/child`, `${id(1)}.json\\child`,
  `${id(1)}.json\0`, `${id(1)}.JSON`, `${id(1)}.json.next.backup`, `${id(1)}.json.backup.next`,
  `${id(1)}.json.unknown`, `${id(1)}.json `, `${id(0xabcdef).toUpperCase()}.json`])(
  'rejects noncanonical slot name %# without deriving a path', name => {
    expect(() => parseName('workspaceImport', name)).toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  });

it('does not interchange inspection keys, ordinary operation keys and adoption workspace keys', () => {
  expect(() => parseName('profileInspection', `${id(1)}.json`)).toThrow();
  expect(() => parseName('workspaceImport', `${id(1)}-${id(3)}.json`)).toThrow();
  expect(() => parseName('profileInspection', `${id(1)}-${id(3)}-extra.json`)).toThrow();
  const key = parseName('workspaceLegacyAdoption', `${id(1)}.json`).key;
  expect(key).toEqual({ owner: 'workspaceLegacyAdoption', workspaceId: id(1) });
});
