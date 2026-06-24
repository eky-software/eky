import type { InvoiceLineDiscount, InvoiceUnit } from '@eky/api-client';

import { centsToEuroInput } from '../../../shared/money/hourlyRateInput.js';

export type InvoiceRowDiscountType = InvoiceLineDiscount['type'];
export type HourlyRateAutofillState = 'available' | 'applied' | 'blocked';

export interface HourlyRateAutofillConfig {
  hourlyRateCents: number | null;
  shortcut: string;
}

export interface InvoiceRowForm {
  id: string;
  description: string;
  quantity: string;
  unit: InvoiceUnit;
  unitPrice: string;
  vatRateBasisPoints: number;
  discountType: InvoiceRowDiscountType;
  discountValue: string;
  hourlyRateAutofillState: HourlyRateAutofillState;
}

export type InvoiceRowFormField = Exclude<
  keyof InvoiceRowForm,
  'hourlyRateAutofillState' | 'id'
>;

export function createInitialInvoiceRows(): InvoiceRowForm[] {
  return [createInvoiceRowForm('invoice-row-1')];
}

export function addInvoiceRow(rows: InvoiceRowForm[]): InvoiceRowForm[] {
  return [
    ...rows,
    createInvoiceRowForm(`invoice-row-${getNextRowNumber(rows)}`),
  ];
}

export function removeInvoiceRow(
  rows: InvoiceRowForm[],
  rowId: string,
): InvoiceRowForm[] {
  if (rows.length <= 1) {
    return rows;
  }

  return rows.filter((row) => row.id !== rowId);
}

export function updateInvoiceRow<
  FieldName extends InvoiceRowFormField,
>(
  rows: InvoiceRowForm[],
  rowId: string,
  fieldName: FieldName,
  value: InvoiceRowForm[FieldName],
): InvoiceRowForm[] {
  return rows.map((row) => {
    if (row.id !== rowId) {
      return row;
    }

    const updatedRow = {
      ...row,
      [fieldName]: value,
    };

    return fieldName === 'unitPrice'
      ? {
          ...updatedRow,
          hourlyRateAutofillState: 'blocked' as const,
        }
      : updatedRow;
  });
}

export function updateInvoiceRowDescription(
  rows: InvoiceRowForm[],
  rowId: string,
  description: string,
  autofillConfig: HourlyRateAutofillConfig,
): InvoiceRowForm[] {
  return rows.map((row) => {
    if (row.id !== rowId) {
      return row;
    }

    const updatedRow = {
      ...row,
      description,
    };

    if (
      row.hourlyRateAutofillState !== 'available' ||
      autofillConfig.hourlyRateCents === null ||
      !matchesHourlyRateShortcut(description, autofillConfig.shortcut)
    ) {
      return updatedRow;
    }

    return {
      ...updatedRow,
      hourlyRateAutofillState: 'applied',
      unit: 'h',
      unitPrice: centsToEuroInput(autofillConfig.hourlyRateCents),
    };
  });
}

function createInvoiceRowForm(id: string): InvoiceRowForm {
  return {
    id,
    description: '',
    quantity: '1,00',
    unit: 'h',
    unitPrice: '',
    vatRateBasisPoints: 2550,
    discountType: 'none',
    discountValue: '',
    hourlyRateAutofillState: 'available',
  };
}

function matchesHourlyRateShortcut(
  description: string,
  shortcut: string,
): boolean {
  const normalizedShortcut = shortcut.trim().toLocaleLowerCase('fi');

  return (
    normalizedShortcut !== '' &&
    description.trim().toLocaleLowerCase('fi') === normalizedShortcut
  );
}

function getNextRowNumber(rows: InvoiceRowForm[]): number {
  const usedNumbers = rows
    .map((row) => Number(row.id.replace('invoice-row-', '')))
    .filter(Number.isSafeInteger);

  return Math.max(0, ...usedNumbers) + 1;
}
