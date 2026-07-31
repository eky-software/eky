import { Hono } from 'hono';

import type { BackendEnvironment } from '../../../http/runtimeTrust.js';
import {
  createApprovedInvoiceDeliveryRoutes,
  type ApprovedInvoiceDeliveryRouteDependencies,
} from './approvedInvoiceDeliveryRoutes.js';
import {
  createApprovedInvoiceDocumentRoutes,
  type ApprovedInvoiceDocumentRouteDependencies,
} from './approvedInvoiceDocumentRoutes.js';
import {
  createApprovedInvoiceLifecycleRoutes,
  type ApprovedInvoiceLifecycleRouteDependencies,
} from './approvedInvoiceLifecycleRoutes.js';
import {
  createApprovedInvoicePaymentRoutes,
  type ApprovedInvoicePaymentRouteDependencies,
} from './approvedInvoicePaymentRoutes.js';
import {
  createApprovedInvoiceQueryRoutes,
  type ApprovedInvoiceQueryRouteDependencies,
} from './approvedInvoiceQueryRoutes.js';

interface ApprovedInvoiceRouteDependencies
  extends ApprovedInvoiceDeliveryRouteDependencies,
    ApprovedInvoiceDocumentRouteDependencies,
    ApprovedInvoiceLifecycleRouteDependencies,
    ApprovedInvoicePaymentRouteDependencies,
    ApprovedInvoiceQueryRouteDependencies {}

export function createApprovedInvoiceRoutes(
  dependencies: ApprovedInvoiceRouteDependencies,
): Hono<BackendEnvironment> {
  const routes = new Hono<BackendEnvironment>();
  routes.route('/', createApprovedInvoiceQueryRoutes(dependencies));
  routes.route('/', createApprovedInvoiceDocumentRoutes(dependencies));
  routes.route('/', createApprovedInvoiceLifecycleRoutes(dependencies));
  routes.route('/', createApprovedInvoicePaymentRoutes(dependencies));
  routes.route('/', createApprovedInvoiceDeliveryRoutes(dependencies));

  return routes;
}
