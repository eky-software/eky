import { Hono } from 'hono';

import type { DatabaseConnection } from '../database/connection/createDatabaseConnection.js';
import type { BackendEnvironment } from '../http/runtimeTrust.js';
import { createCustomer } from '../modules/customers/application/createCustomer.js';
import { listCustomers } from '../modules/customers/application/listCustomers.js';
import { updateCustomer } from '../modules/customers/application/updateCustomer.js';
import { createCustomersRoutes } from '../modules/customers/http/customersRoutes.js';
import { SqliteCustomerActivityReader } from '../modules/customers/infrastructure/sqliteCustomerActivityReader.js';
import { SqliteCustomerRepository } from '../modules/customers/infrastructure/sqliteCustomerRepository.js';
import { CustomerAuditWriteError } from '../modules/customers/ports/customerAuditWriteError.js';
import type { CustomerActivityReader } from '../modules/customers/ports/customerActivityReader.js';
import type { CustomerAccessReader } from '../modules/invoicing/ports/customerAccessReader.js';
import type { InvoiceCustomerTaxProfileReader } from '../modules/invoicing/ports/invoiceCustomerTaxProfileReader.js';
import { createBackendOperationalEvent } from '../observability/createOperationalEvent.js';
import type { OperationalRuntimeIdentity } from '../observability/operationalEvent.js';
import type { OperationalLogger } from '../observability/operationalLogger.js';

interface CustomersCompositionOptions {
  database: DatabaseConnection;
  operationalIdentity: Readonly<OperationalRuntimeIdentity>;
  operationalLogger: OperationalLogger;
}

interface CustomersComposition {
  customerAccessReader: CustomerAccessReader;
  customerActivityReader: CustomerActivityReader;
  invoiceCustomerTaxProfileReader: InvoiceCustomerTaxProfileReader;
  routes: Hono<BackendEnvironment>;
}

export function createCustomersComposition(
  options: CustomersCompositionOptions,
): CustomersComposition {
  const customerRepository = new SqliteCustomerRepository(options.database);
  const customerActivityReader = new SqliteCustomerActivityReader(
    options.database,
  );
  const customerAccessReader: CustomerAccessReader = {
    async belongsToCompany(customerId, companyId) {
      const customer = await customerRepository.findById(companyId, customerId);

      return customer !== undefined;
    },
  };
  const invoiceCustomerTaxProfileReader: InvoiceCustomerTaxProfileReader = {
    async getTaxProfile(customerId, companyId) {
      const customer = await customerRepository.findById(companyId, customerId);

      return customer === undefined
        ? undefined
        : {
            customerType: customer.customerType,
            businessId: customer.businessId,
          };
    },
  };
  const routes = createCustomersRoutes({
    createCustomer: (input) =>
      logAuditWriteFailure(
        () => createCustomer(input, customerRepository),
        options,
      ),
    listCustomers: (input) => listCustomers(input, customerRepository),
    updateCustomer: (input) =>
      logAuditWriteFailure(
        () => updateCustomer(input, customerRepository),
        options,
      ),
  });

  return {
    customerAccessReader,
    customerActivityReader,
    invoiceCustomerTaxProfileReader,
    routes,
  };
}

async function logAuditWriteFailure<T>(
  operation: () => Promise<T>,
  options: Pick<
    CustomersCompositionOptions,
    'operationalIdentity' | 'operationalLogger'
  >,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof CustomerAuditWriteError) {
      try {
        options.operationalLogger.write(
          createBackendOperationalEvent(
            {
              entityType: 'customer',
              errorCode: 'CUSTOMER_AUDIT_WRITE_FAILED',
              eventName: 'businessAudit.writeFailed',
              sideEffectState: 'rolledBack',
              stage: 'customerMutation',
            },
            options.operationalIdentity,
          ),
        );
      } catch {
        // Operational logging must not replace the original safe audit error.
      }
    }

    throw error;
  }
}
