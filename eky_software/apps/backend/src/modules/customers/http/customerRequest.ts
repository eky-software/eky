import {
  hasOnlyAllowedFields,
  isRecord,
  readOptionalStringFields,
} from '../../../http/requestBody.js';
import type { CreateCustomerInput } from '../application/createCustomer.js';
import type { UpdateCustomerInput } from '../application/updateCustomer.js';

type ParsedCreateCustomerRequest = Omit<CreateCustomerInput, 'actorContext'>;
type ParsedUpdateCustomerRequest = Omit<
  UpdateCustomerInput,
  'actorContext' | 'id'
>;

export type UpdateCustomerRequestResult =
  | { ok: true; input: ParsedUpdateCustomerRequest }
  | { ok: false; reason: 'customerNumberRequired' | 'invalidBody' };

const allowedCustomerBodyFields = new Set([
  'businessId',
  'city',
  'comment',
  'customerNumber',
  'customerNumberMode',
  'customerType',
  'email',
  'hourlyRateOverrideCents',
  'managedByCustomerId',
  'name',
  'phone',
  'postalCode',
  'status',
  'streetAddress',
]);

const optionalCustomerStringFields = [
  'businessId',
  'city',
  'comment',
  'customerNumberMode',
  'customerType',
  'email',
  'managedByCustomerId',
  'phone',
  'postalCode',
  'status',
  'streetAddress',
] as const;

export function parseCreateCustomerRequest(
  body: unknown,
): ParsedCreateCustomerRequest | null {
  if (!isRecord(body)) {
    return null;
  }

  const common = parseCommonCustomerRequest(body);

  if (common === null) {
    return null;
  }

  const customerNumber = readOptionalCustomerNumber(body);

  if (customerNumber === null) {
    return null;
  }

  return {
    ...common,
    customerNumberMode:
      common.customerNumberMode ||
      (customerNumber === undefined ? 'auto' : 'manual'),
    ...(customerNumber === undefined ? {} : { customerNumber }),
  };
}

export function parseUpdateCustomerRequest(
  body: unknown,
): UpdateCustomerRequestResult {
  if (!isRecord(body)) {
    return { ok: false, reason: 'invalidBody' };
  }

  const common = parseCommonCustomerRequest(body);

  if (common === null) {
    return { ok: false, reason: 'invalidBody' };
  }

  if (typeof body.customerNumber !== 'string') {
    return { ok: false, reason: 'customerNumberRequired' };
  }

  return {
    ok: true,
    input: {
      businessId: common.businessId,
      city: common.city,
      comment: common.comment,
      customerNumber: body.customerNumber,
      customerType: common.customerType,
      email: common.email,
      hourlyRateOverrideCents: common.hourlyRateOverrideCents,
      managedByCustomerId: common.managedByCustomerId,
      name: common.name,
      phone: common.phone,
      postalCode: common.postalCode,
      status: common.status,
      streetAddress: common.streetAddress,
    },
  };
}

function parseCommonCustomerRequest(
  body: Record<string, unknown>,
): Omit<
  ParsedUpdateCustomerRequest,
  'customerNumber'
> & { customerNumberMode: string } | null {
  if (
    typeof body.name !== 'string' ||
    !hasOnlyAllowedFields(body, allowedCustomerBodyFields)
  ) {
    return null;
  }

  const fields = readOptionalStringFields(
    body,
    optionalCustomerStringFields,
  );

  if (fields === null) {
    return null;
  }

  return {
    businessId: fields.businessId,
    city: fields.city,
    comment: fields.comment,
    customerNumberMode: fields.customerNumberMode,
    customerType: fields.customerType || 'company',
    email: fields.email,
    hourlyRateOverrideCents: body.hourlyRateOverrideCents,
    managedByCustomerId: fields.managedByCustomerId,
    name: body.name,
    phone: fields.phone,
    postalCode: fields.postalCode,
    status: fields.status || 'active',
    streetAddress: fields.streetAddress,
  };
}

function readOptionalCustomerNumber(
  body: Record<string, unknown>,
): string | null | undefined {
  const value = body.customerNumber;

  if (value === undefined || value === null) {
    return undefined;
  }

  return typeof value === 'string' ? value : null;
}
