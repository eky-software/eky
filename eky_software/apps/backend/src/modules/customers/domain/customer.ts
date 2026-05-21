export interface Customer {
  id: string;
  companyId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCustomerDomainInput {
  id: string;
  companyId: string;
  name: string;
  now: string;
}

export function createCustomerRecord(input: CreateCustomerDomainInput): Customer {
  return {
    id: input.id,
    companyId: input.companyId,
    name: input.name,
    createdAt: input.now,
    updatedAt: input.now,
  };
}
