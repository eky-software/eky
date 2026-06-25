import {
  formatInvoiceNumber,
  resolveInvoiceNumberSequenceScope,
  validateInvoiceNumberSeriesKey,
  validateInvoiceNumberingSettings,
  validateInvoiceSequenceNumber,
  type InvoiceNumberingMode,
  type InvoiceNumberSequenceState,
} from '../domain/invoiceNumbering.js';
import type { InvoiceNumberSequenceRepository } from '../ports/invoiceNumberSequenceRepository.js';
import type { InvoiceNumberingSettingsRepository } from '../ports/invoiceNumberingSettingsRepository.js';
import { ReserveInvoiceNumberError } from './reserveInvoiceNumberError.js';

export interface ReserveInvoiceNumberInput {
  companyId: string;
  seriesKey: string;
  invoiceDate: string;
  now: string;
}

export interface ReservedInvoiceNumber {
  invoiceNumber: string;
  seriesKey: string;
  sequenceScope: string;
  sequenceNumber: number;
  numberingMode: InvoiceNumberingMode;
}

export interface ReserveInvoiceNumberDependencies {
  invoiceNumberingSettingsRepository: InvoiceNumberingSettingsRepository;
  invoiceNumberSequenceRepository: InvoiceNumberSequenceRepository;
}

function requireNonEmptyValue(value: string, fieldName: string): string {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new ReserveInvoiceNumberError(`${fieldName} is required.`);
  }

  return normalizedValue;
}

function createNextSequenceState(
  input: ReserveInvoiceNumberInput,
  sequenceScope: string,
  sequenceNumber: number,
  currentSequence: InvoiceNumberSequenceState | undefined,
): InvoiceNumberSequenceState {
  return {
    companyId: input.companyId,
    seriesKey: input.seriesKey,
    sequenceScope,
    lastSequenceNumber: sequenceNumber,
    createdAt: currentSequence?.createdAt ?? input.now,
    updatedAt: input.now,
  };
}

export async function reserveInvoiceNumber(
  input: ReserveInvoiceNumberInput,
  dependencies: ReserveInvoiceNumberDependencies,
): Promise<ReservedInvoiceNumber> {
  const companyId = requireNonEmptyValue(input.companyId, 'Company id');
  const seriesKey = requireNonEmptyValue(input.seriesKey, 'Invoice number series key');
  const now = requireNonEmptyValue(input.now, 'Reservation timestamp');

  validateInvoiceNumberSeriesKey(seriesKey);

  const settings =
    await dependencies.invoiceNumberingSettingsRepository.getSettings(
      companyId,
      seriesKey,
    );

  if (settings === undefined) {
    throw new ReserveInvoiceNumberError('Invoice numbering settings were not found.');
  }

  validateInvoiceNumberingSettings(settings);

  const sequenceScope = resolveInvoiceNumberSequenceScope(
    settings,
    input.invoiceDate,
  );
  const currentSequence =
    await dependencies.invoiceNumberSequenceRepository.getSequence(
      companyId,
      seriesKey,
      sequenceScope,
    );
  const sequenceNumber =
    currentSequence === undefined
      ? settings.firstSequenceNumber
      : currentSequence.lastSequenceNumber + 1;

  validateInvoiceSequenceNumber(sequenceNumber);

  const invoiceNumber = formatInvoiceNumber(
    settings,
    input.invoiceDate,
    sequenceNumber,
  );
  const savedSequence =
    await dependencies.invoiceNumberSequenceRepository.saveSequence(
      createNextSequenceState(
        { ...input, companyId, seriesKey, now },
        sequenceScope,
        sequenceNumber,
        currentSequence,
      ),
    );

  if (
    savedSequence.companyId !== companyId ||
    savedSequence.seriesKey !== seriesKey ||
    savedSequence.sequenceScope !== sequenceScope ||
    savedSequence.lastSequenceNumber !== sequenceNumber
  ) {
    throw new ReserveInvoiceNumberError(
      'Invoice number sequence reservation returned an inconsistent state.',
    );
  }

  return {
    invoiceNumber,
    seriesKey,
    sequenceScope,
    sequenceNumber,
    numberingMode: settings.mode,
  };
}
