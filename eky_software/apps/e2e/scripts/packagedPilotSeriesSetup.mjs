import { inspectPackagedPilotSeries, packagedSeriesManifestVariable, requirePackagedSeriesPin }
  from '../../desktop/scripts/packagedPilotSeries.mjs';

async function runSmoke(options) {
  const { runPackagedSmoke } = await import('../../desktop/scripts/run-packaged-smoke.mjs');
  return runPackagedSmoke(options);
}

export async function setupPackagedPilotSeries({ environment = process.env,
  inspect = inspectPackagedPilotSeries, smoke = runSmoke } = {}) {
  const previous = environment[packagedSeriesManifestVariable];
  if (environment.CI !== 'true' && previous !== undefined) throw new Error('PACKAGED_PILOT_SERIES_INVALID');
  const expected = environment.CI === 'true' ? requirePackagedSeriesPin(environment) : undefined;
  const selected = await inspect(expected);
  if (environment.CI !== 'true') await smoke({ seriesManifestSha256: selected.pin });
  environment[packagedSeriesManifestVariable] = selected.pin;
  // Playwright awaits this closure as its global teardown, even after a test failure.
  return async () => {
    try { await inspect(selected.pin); }
    finally {
      if (previous === undefined) delete environment[packagedSeriesManifestVariable];
      else environment[packagedSeriesManifestVariable] = previous;
    }
  };
}

export default async function globalSetup() { return setupPackagedPilotSeries(); }
