import type { Context } from 'hono';

import type { JsonRequestBodyErrorCode } from './readJsonRequestBody.js';
import type { BackendEnvironment } from './runtimeTrust.js';

const httpOperationIds = [
  'invoiceDraft.approve',
  'invoiceDraft.create',
  'invoiceDraft.delete',
  'invoiceDraft.get',
  'invoiceDraft.list',
  'invoiceDraft.readiness',
  'invoiceDraft.update',
] as const;

const httpRequestFailureStages = [
  'approval',
  'bodyParsing',
  'calculation',
  'domainValidation',
  'numbering',
  'queryValidation',
  'requestValidation',
  'resourceValidation',
] as const;

const httpRequestFailureErrorCodes = [
  'HTTP_BODY_FORBIDDEN',
  'HTTP_BODY_REQUIRED',
  'HTTP_BODY_TOO_LARGE',
  'HTTP_JSON_INVALID',
  'HTTP_MEDIA_TYPE_UNSUPPORTED',
  'INVOICE_DRAFT_APPROVAL_INVALID',
  'INVOICE_DRAFT_CALCULATION_INVALID',
  'INVOICE_DRAFT_DOMAIN_INVALID',
  'INVOICE_DRAFT_NUMBERING_INVALID',
  'INVOICE_DRAFT_QUERY_INVALID',
  'INVOICE_DRAFT_REQUEST_INVALID',
  'INVOICE_DRAFT_RESOURCE_INVALID',
] as const;

export type HttpOperationId = (typeof httpOperationIds)[number];
export type HttpRequestFailureStage =
  (typeof httpRequestFailureStages)[number];
export type HttpRequestFailureErrorCode =
  (typeof httpRequestFailureErrorCodes)[number];

export interface HttpRequestOperationalContext {
  errorCode?: HttpRequestFailureErrorCode;
  operationId: HttpOperationId;
  stage: HttpRequestFailureStage;
}

export function setHttpRequestOperation(
  context: Context<BackendEnvironment>,
  operationId: HttpOperationId,
  stage: HttpRequestFailureStage,
): void {
  context.set('httpRequestOperationalContext', {
    operationId,
    stage,
  });
}

export function setHttpRequestFailure(
  context: Context<BackendEnvironment>,
  errorCode: HttpRequestFailureErrorCode,
  stage: HttpRequestFailureStage,
): void {
  const currentContext = context.get('httpRequestOperationalContext');

  if (currentContext === undefined) {
    throw new Error('HTTP operation context must be set before a failure.');
  }

  context.set('httpRequestOperationalContext', {
    errorCode,
    operationId: currentContext.operationId,
    stage,
  });
}

export function setJsonRequestBodyFailure(
  context: Context<BackendEnvironment>,
  code: JsonRequestBodyErrorCode,
): void {
  setHttpRequestFailure(
    context,
    jsonRequestBodyErrorCodes[code],
    'bodyParsing',
  );
}

export function setJsonRequestBodyTooLargeFailure(
  context: Context<BackendEnvironment>,
  operationId: HttpOperationId,
): void {
  setHttpRequestOperation(context, operationId, 'bodyParsing');
  setHttpRequestFailure(context, 'HTTP_BODY_TOO_LARGE', 'bodyParsing');
}

const jsonRequestBodyErrorCodes = Object.freeze({
  bodyForbidden: 'HTTP_BODY_FORBIDDEN',
  invalidJson: 'HTTP_JSON_INVALID',
  requiredBodyMissing: 'HTTP_BODY_REQUIRED',
  unsupportedMediaType: 'HTTP_MEDIA_TYPE_UNSUPPORTED',
} satisfies Record<JsonRequestBodyErrorCode, HttpRequestFailureErrorCode>);
