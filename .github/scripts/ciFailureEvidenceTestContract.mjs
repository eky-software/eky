import assert from 'node:assert/strict';

export function withoutFaultEvidenceUpload(job) {
  const marker = '      - name: Upload exact encrypted workspace fault evidence only\n';
  assert.equal(job.split(marker).length, 2);
  const step = job.split(marker)[1].split(/\n(?=      - )/u)[0];
  assert.deepEqual(step.match(/^        uses: .+$/gmu),
    ['        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a']);
  assert.deepEqual(step.match(/^        if: .+$/gmu),
    ["        if: always() && steps.fault_evidence_seal.outcome == 'success' && steps.fault_evidence_seal.outputs.sealed == 'true'"]);
  assert.deepEqual(step.match(/^          path: .+$/gmu),
    ['          path: ${{ steps.fault_evidence_seal.outputs.ciphertext }}']);
  assert.match(step, /retention-days: 1\s/u);
  assert.match(step, /if-no-files-found: error/u);
  assert.match(step, /overwrite: false/u);
  assert.match(step, /include-hidden-files: false/u);
  assert.doesNotMatch(step, /continue-on-error|\*|\.etl|private\./u);
  return job.replace(step, '');
}

// Test-only projection: remove exactly the approved optional allowance, leaving
// job headers and every mandatory-step policy visible to the caller's assertions.
export function withoutOptionalEvidenceAllowance(source, expectedCount, contractModesOnly = false, platforms = 'Windows') {
  const runnerGuards = {
    Windows: "runner.os == 'Windows'",
    Linux: "runner.os == 'Linux'",
    'Windows/Linux': "(runner.os == 'Windows' || runner.os == 'Linux')",
  };
  if (Array.isArray(platforms)) assert.equal(platforms.length, expectedCount);
  let count = 0;
  const required = source.split(/(?=^      - name: )/mu).map((step) => {
    if (!step.startsWith('      - name: Preserve encrypted CI failure evidence\n')) return step;
    count += 1;
    const platform = Array.isArray(platforms) ? platforms[count - 1] : platforms;
    assert.ok(Object.hasOwn(runnerGuards, platform));
    assert.deepEqual(step.match(/^        uses: .+$/gmu),
      ['        uses: ./.github/actions/collect-ci-failure-evidence']);
    assert.deepEqual(step.match(/^        timeout-minutes: .+$/gmu), ['        timeout-minutes: 3']);
    assert.doesNotMatch(step, /^        (?:run|env):/mu);
    assert.equal(step.match(/^        if:/gmu)?.length, 1);
    const guard = step.match(/^        if: >-\n((?:          [^\n]+\n)+)/mu)?.[1];
    assert.equal(guard?.trim().replace(/\s+/gu, ' '), [
      '${{ always() && ' + runnerGuards[platform] + " && runner.environment == 'github-hosted'",
      "&& (job.status == 'failure' || job.status == 'cancelled')",
      "&& vars.EKY_DIAGNOSTIC_PUBLIC_KEY != '' && vars.EKY_DIAGNOSTIC_KEY_FINGERPRINT != ''",
      '&& vars.EKY_DIAGNOSTIC_KEY_FINGERPRINT == vars.EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT',
      "&& (github.event_name == 'push' || github.event_name == 'schedule'",
      "|| github.event_name == 'workflow_dispatch'",
      "|| (github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository))",
      ...(contractModesOnly ? ["&& (inputs.mode == '' || inputs.mode == 'contracts')"] : []),
      "&& hashFiles('.github/actions/collect-ci-failure-evidence/action.yml') != ''",
      "&& hashFiles('eky_software/apps/desktop/installer/windows-acceptance-harness/ciFailureEvidence.mjs') != '' }}",
    ].join(' '));
    assert.deepEqual(step.match(/^        continue-on-error: .+$/gmu), ['        continue-on-error: true']);
    return step.replace(/^        continue-on-error: true\r?\n/mu, '');
  }).join('');
  assert.equal(count, expectedCount);
  return required;
}
