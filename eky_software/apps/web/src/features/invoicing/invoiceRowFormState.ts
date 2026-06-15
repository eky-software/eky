import type { InvoiceLineDiscount, InvoiceUnit } from '@eky/api-client';

export type InvoiceRowDiscountType = InvoiceLineDiscount['type'];

export interface InvoiceRowForm {
  id: string;
  description: string;
  quantity: string;
  unit: InvoiceUnit;
  unitPrice: string;
  vatRateBasisPoints: number;
  discountType: InvoiceRowDiscountType;
  discountValue: string;
}

export type InvoiceRowFormField = Exclude<keyof InvoiceRowForm, 'id'>;

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
  return rows.map((row) =>
    row.id === rowId
      ? {
          ...row,
          [fieldName]: value,
        }
      : row,
  );
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
  };
}

function getNextRowNumber(rows: InvoiceRowForm[]): number {
  const usedNumbers = rows
    .map((row) => Number(row.id.replace('invoice-row-', '')))
    .filter(Number.isSafeInteger);

  return Math.max(0, ...usedNumbers) + 1;
}
