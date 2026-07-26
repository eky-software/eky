import type { Hono } from 'hono';

import type { BackendEnvironment } from '../http/runtimeTrust.js';
import { listActivity } from '../modules/activity/application/listActivity.js';
import { createActivityRoutes } from '../modules/activity/http/activityRoutes.js';
import type { CompanySettingsActivityReader } from '../modules/companySettings/ports/companySettingsActivityReader.js';
import type { CustomerActivityReader } from '../modules/customers/ports/customerActivityReader.js';
import type { InvoiceActivityReader } from '../modules/invoicing/ports/invoiceActivityReader.js';

export interface ActivityCompositionDependencies {
  companySettingsActivityReader: CompanySettingsActivityReader;
  customerActivityReader: CustomerActivityReader;
  invoiceActivityReader: InvoiceActivityReader;
}

export function createActivityComposition(
  dependencies: ActivityCompositionDependencies,
): Hono<BackendEnvironment> {
  return createActivityRoutes({
    listActivity: (input) => listActivity(input, dependencies),
  });
}
