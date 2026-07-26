import { Hono } from 'hono';

import type { DatabaseConnection } from '../database/connection/createDatabaseConnection.js';
import type { BackendEnvironment } from '../http/runtimeTrust.js';
import { createCustomer } from '../modules/customers/application/createCustomer.js';
import { listCustomers } from '../modules/customers/application/listCustomers.js';
import { updateCustomer } from '../modules/customers/application/updateCustomer.js';
import { createCustomersRoutes } from '../modules/customers/http/customersRoutes.js';
import { SqliteCustomerRepository } from '../modules/customers/infrastructure/sqliteCustomerRepository.js';
import type { CustomerAccessReader } from '../modules/invoicing/ports/customerAccessReader.js';
import type { InvoiceCustomerTaxProfileReader } from '../modules/invoicing/ports/invoiceCustomerTaxProfileReader.js';

interface CustomersComposition {
  customerAccessReader: CustomerAccessReader;
  invoiceCustomerTaxProfileReader: InvoiceCustomerTaxProfileReader;
  routes: Hono<BackendEnvironment>;
}

export function createCustomersComposition(
  database: DatabaseConnection,
): CustomersComposition {
  const customerRepository = new SqliteCustomerRepository(database);
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
    createCustomer: (input) => createCustomer(input, customerRepository),
    listCustomers: (input) => listCustomers(input, customerRepository),
    updateCustomer: (input) => updateCustomer(input, customerRepository),
  });

  return {
    customerAccessReader,
    invoiceCustomerTaxProfileReader,
    routes,
  };
}
