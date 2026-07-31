import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import type { CustomerHistoryPage } from '../domain/customerHistory.js';
import type { CustomerDetailReader } from '../ports/customerDetailReader.js';
import type { CustomerHistoryReader } from '../ports/customerHistoryReader.js';
import {
  CustomerNotFoundError,
  CustomerReadValidationError,
  requireCustomerResourceId,
} from './customerReadErrors.js';

export const defaultCustomerHistoryPage = 1;
export const defaultCustomerHistoryPageSize = 20;
export const maximumCustomerHistoryPage = 100;
export const customerHistoryPageSizes = [20, 50] as const;

export interface ListCustomerHistoryInput {
  actorContext: ActorContext;
  customerId: string;
  page?: number;
  pageSize?: number;
}

export interface ListCustomerHistoryDependencies {
  customerDetailReader: CustomerDetailReader;
  customerHistoryReader: CustomerHistoryReader;
}

export async function listCustomerHistory(
  input: ListCustomerHistoryInput,
  dependencies: ListCustomerHistoryDependencies,
): Promise<CustomerHistoryPage> {
  requirePermission(input.actorContext, 'viewActivity');

  const customerId = requireCustomerResourceId(input.customerId);
  const page = input.page ?? defaultCustomerHistoryPage;
  const pageSize = input.pageSize ?? defaultCustomerHistoryPageSize;

  validatePagination(page, pageSize);

  const companyId = input.actorContext.companyId;
  const customer = await dependencies.customerDetailReader.findById(
    companyId,
    customerId,
  );

  if (customer === undefined) {
    throw new CustomerNotFoundError();
  }

  const entries = await dependencies.customerHistoryReader.listCustomerHistory({
    companyId,
    customerId,
    limit: pageSize + 1,
    offset: (page - 1) * pageSize,
  });

  return {
    activityEntries: entries.slice(0, pageSize),
    hasNextPage: entries.length > pageSize,
    hasPreviousPage: page > 1,
    page,
    pageSize,
  };
}

function validatePagination(page: number, pageSize: number): void {
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    page > maximumCustomerHistoryPage
  ) {
    throw new CustomerReadValidationError(
      `Customer history page must be an integer between 1 and ${maximumCustomerHistoryPage}.`,
    );
  }

  if (
    !customerHistoryPageSizes.includes(
      pageSize as (typeof customerHistoryPageSizes)[number],
    )
  ) {
    throw new CustomerReadValidationError(
      'Customer history page size is invalid.',
    );
  }
}
