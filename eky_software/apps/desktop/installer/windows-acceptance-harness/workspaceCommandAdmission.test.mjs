import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { parseWorkspaceFaultArguments } from './workspaceCommandAdmission.mjs';
import { WORKSPACE_FAULT_PLANS } from './workspaceFaultContracts.mjs';

test('fault caller accepts only the five closed scenarios and exact immutable artifact arguments', () => {
  const base = ['--artifact-descriptor', resolve('workspace-success-artifact.json'),
    '--expected-descriptor-sha256', 'b'.repeat(64), '--expected-build-revision', 'a'.repeat(40)];
  for (const faultScenario of Object.keys(WORKSPACE_FAULT_PLANS)) {
    assert.equal(parseWorkspaceFaultArguments([...base, '--fault-scenario', faultScenario]).faultScenario, faultScenario);
  }
  for (const args of [base, [...base, '--fault-scenario', '__proto__'], [...base, '--fault-scenario', 'unknown'],
    [...base, '--fault-scenario', 'acceptanceInterruption', 'extra'], [...base, '--other', 'acceptanceInterruption']]) {
    assert.throws(() => parseWorkspaceFaultArguments(args), { message: 'requestInvalid' });
  }
});
