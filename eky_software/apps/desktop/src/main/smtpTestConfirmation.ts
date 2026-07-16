export interface SmtpTestPreparationConfirmation {
  attachmentFileName: string;
  attachmentSizeBytes: number;
  invoiceId: string;
  subject: string;
  testRecipient: string;
}

export function readSmtpTestPreparationConfirmation(
  value: unknown,
): SmtpTestPreparationConfirmation | undefined {
  if (!isRecord(value) || !isRecord(value.preparation)) {
    return undefined;
  }

  const preparation = value.preparation;

  if (!isRecord(preparation.attachment)) {
    return undefined;
  }

  const attachmentFileName = readSafeText(
    preparation.attachment.fileName,
    200,
  );
  const invoiceId = readSafeText(preparation.invoiceId, 100);
  const subject = readSafeText(preparation.subject, 200);
  const testRecipient = readSafeText(preparation.testRecipient, 320);
  const attachmentSizeBytes = preparation.attachment.sizeBytes;

  if (
    attachmentFileName === undefined ||
    invoiceId === undefined ||
    subject === undefined ||
    testRecipient === undefined ||
    typeof attachmentSizeBytes !== 'number' ||
    !Number.isSafeInteger(attachmentSizeBytes) ||
    attachmentSizeBytes < 0
  ) {
    return undefined;
  }

  return {
    attachmentFileName,
    attachmentSizeBytes,
    invoiceId,
    subject,
    testRecipient,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readSafeText(value: unknown, maximumLength: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalizedValue = value.trim();

  if (
    normalizedValue.length === 0 ||
    normalizedValue.length > maximumLength ||
    /[\u0000-\u001f\u007f]/.test(normalizedValue)
  ) {
    return undefined;
  }

  return normalizedValue;
}
