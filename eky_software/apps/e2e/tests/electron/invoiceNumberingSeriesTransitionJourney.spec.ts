import { readElectronE2eActiveWorkspace } from '../../src/environment/readElectronE2eActiveWorkspace.js';
import {
  activateInvoiceNumberingSeriesThroughUi,
  seedNumberingSeriesTransitionJourney,
} from '../../src/journeys/invoiceNumberingSeriesTransitionJourney.js';
import { test } from '../../src/fixtures/isolatedElectronTest.js';

test('INV-NUMBERING-SERIES-DESKTOP-001 @critical activates a new series through the Electron confirmation flow', async ({
  e2eElectron,
}) => {
  const harness = {
    api: e2eElectron.api,
    databaseFilePath: readElectronE2eActiveWorkspace(
      e2eElectron.runtime.userDataPath,
    ).databaseFilePath,
    page: e2eElectron.page,
  };
  const seeded = await seedNumberingSeriesTransitionJourney(harness);

  await activateInvoiceNumberingSeriesThroughUi(harness, seeded);
});
