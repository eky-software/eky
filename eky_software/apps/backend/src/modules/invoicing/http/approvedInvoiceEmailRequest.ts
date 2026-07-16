import type { ActorContext } from '@eky/auth';

import type {
  SendApprovedInvoiceEmailDryRunInput,
} from '../application/sendApprovedInvoiceEmailDryRun.js';
import type {
  PrepareApprovedInvoiceEmailSmtpTestInput,
} from '../application/prepareApprovedInvoiceEmailSmtpTest.js';
import type {
  SendApprovedInvoiceEmailSmtpTestInput,
} from '../application/sendApprovedInvoiceEmailSmtpTest.js';

const maximumEmailLength = 320;
const maximumSubjectLength = 200;
const maximumBodyLength = 10_000;
const allowedDryRunSendFields = new Set(['to', 'cc', 'subject', 'body']);
const allowedSmtpTestSendFields = new Set([
  ...allowedDryRunSendFields,
  'attemptId',
  'authorizationToken',
]);

export class ApprovedInvoiceEmailRequestValidationError extends Error {
  constructor() {
    super('Invalid invoice email body.');
    this.name = 'ApprovedInvoiceEmailRequestValidationError';
  }
}

export function parseApprovedInvoiceEmailDryRunSendBody(
  body: unknown,
  context: {
    actorContext: ActorContext;
    invoiceId: string;
    sentAt: string;
  },
): SendApprovedInvoiceEmailDryRunInput {
  if (!isRecord(body)) {
    throw new ApprovedInvoiceEmailRequestValidationError();
  }

  assertAllowedFields(body, allowedDryRunSendFields);

  return parseApprovedInvoiceEmailFields(body, context);
}

export function parseApprovedInvoiceEmailSmtpTestSendBody(
  body: unknown,
  context: {
    actorContext: ActorContext;
    invoiceId: string;
    sentAt: string;
  },
): SendApprovedInvoiceEmailSmtpTestInput {
  if (!isRecord(body)) {
    throw new ApprovedInvoiceEmailRequestValidationError();
  }

  assertAllowedFields(body, allowedSmtpTestSendFields);

  return {
    ...parseApprovedInvoiceEmailFields(body, context),
    attemptId: readString(body, 'attemptId', 100),
    authorizationToken: readString(body, 'authorizationToken', 100),
  };
}

export function parseApprovedInvoiceEmailSmtpTestPrepareBody(
  body: unknown,
  context: {
    actorContext: ActorContext;
    invoiceId: string;
    preparedAt: string;
  },
): PrepareApprovedInvoiceEmailSmtpTestInput {
  if (!isRecord(body)) {
    throw new ApprovedInvoiceEmailRequestValidationError();
  }

  assertAllowedFields(body, allowedDryRunSendFields);

  const fields = parseApprovedInvoiceEmailFields(body, {
    actorContext: context.actorContext,
    invoiceId: context.invoiceId,
    sentAt: context.preparedAt,
  });

  return {
    actorContext: fields.actorContext,
    body: fields.body,
    ...(fields.cc === undefined ? {} : { cc: fields.cc }),
    invoiceId: fields.invoiceId,
    preparedAt: fields.sentAt,
    subject: fields.subject,
    to: fields.to,
  };
}

function parseApprovedInvoiceEmailFields(
  body: Record<string, unknown>,
  context: {
    actorContext: ActorContext;
    invoiceId: string;
    sentAt: string;
  },
): SendApprovedInvoiceEmailDryRunInput {
  const cc = readOptionalString(body, 'cc', maximumEmailLength);
  const input: SendApprovedInvoiceEmailDryRunInput = {
    actorContext: context.actorContext,
    body: readString(body, 'body', maximumBodyLength),
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
