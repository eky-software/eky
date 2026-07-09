import type {
  SendApprovedInvoiceEmailDryRunInput,
} from '../application/sendApprovedInvoiceEmailDryRun.js';

const maximumEmailLength = 320;
const maximumSubjectLength = 200;
const maximumBodyLength = 10_000;
const allowedDryRunSendFields = new Set(['to', 'cc', 'subject', 'body']);

export class ApprovedInvoiceEmailRequestValidationError extends Error {
  constructor() {
    super('Invalid invoice email body.');
    this.name = 'ApprovedInvoiceEmailRequestValidationError';
  }
}

export function parseApprovedInvoiceEmailDryRunSendBody(
  body: unknown,
  context: {
    actorUserId: string;
    companyId: string;
    invoiceId: string;
    sentAt: string;
  },
): SendApprovedInvoiceEmailDryRunInput {
  if (!isRecord(body)) {
    throw new ApprovedInvoiceEmailRequestValidationError();
  }

  assertAllowedFields(body, allowedDryRunSendFields);

  const cc = readOptionalString(body, 'cc', maximumEmailLength);
  const input: SendApprovedInvoiceEmailDryRunInput = {
    actorUserId: context.actorUserId,
    body: readString(body, 'body', maximumBodyLength),
    companyId: context.companyId,
    invoiceId: context.invoiceId,
    sentAt: context.sentAt,
    subject: readString(body, 'subject', maximumSubjectLength),
    to: readString(body, 'to', maximumEmailLength),
  };

  if (cc !== undefined) {
    input.cc = cc;
  }

  return input;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertAllowedFields(
  value: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
): void {
  if (Object.keys(value).some((fieldName) => !allowedFields.has(fieldName))) {
    throw new ApprovedInvoiceEmailRequestValidationError();
  }
}

function readString(
  value: Record<string, unknown>,
  fieldName: string,
  maximumLength: number,
): string {
  const fieldValue = value[fieldName];

  if (typeof fieldValue !== 'string' || fieldValue.length > maximumLength) {
    throw new ApprovedInvoiceEmailRequestValidationError();
  }

  return fieldValue;
}

function readOptionalString(
  value: Record<string, unknown>,
  fieldName: string,
  maximumLength: number,
): string | undefined {
  if (!(fieldName in value)) {
    return undefined;
  }

  return readString(value, fieldName, maximumLength);
}
