import {
  activateInvoiceNumberingSeriesThroughUi,
  seedNumberingSeriesTransitionJourney,
} from '../../src/journeys/invoiceNumberingSeriesTransitionJourney.js';
import { test } from '../../src/fixtures/isolatedWebTest.js';

test('INV-NUMBERING-SERIES-UI-001 @critical activates a new series through the web confirmation flow', async ({
  e2eWeb,
}) => {
  const harness = {
    api: e2eWeb.api,
    databaseFilePath: e2eWeb.paths.databaseFilePath,
    page: e2eWeb.page,
  };
  const seeded = await seedNumberingSeriesTransitionJourney(harness);

  await activateInvoiceNumberingSeriesThroughUi(harness, seeded);
});
