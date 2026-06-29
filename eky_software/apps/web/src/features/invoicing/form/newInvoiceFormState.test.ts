import { describe, expect, it } from 'vitest';

import {
  calculateDueDateInput,
  createInitialNewInvoiceForm,
  updateNewInvoiceFormField,
} from './newInvoiceFormState.js';

describe('createInitialNewInvoiceForm', () => {
  it('uses the selected day and a 14 day payment term as UI defaults', () => {
    const form = createInitialNewInvoiceForm(new Date(2026, 5, 14));

    expect(form).toMatchObject({
      dueDate: '2026-06-28',
      invoiceDate: '2026-06-14',
      latePaymentInterestPercent: '',
      paymentTermDays: '14',
      priceInputMode: 'net',
    });
  });

  it('moves the due date across month and year boundaries', () => {
    const form = createInitialNewInvoiceForm(new Date(2026, 11, 24));

    expect(form.dueDate).toBe('2027-01-07');
  });

  it('starts without customer or optional text values', () => {
    const form = createInitialNewInvoiceForm(new Date(2026, 5, 14));

    expect(form).toMatchObject({
      customerId: '',
      note: '',
      orderNumber: '',
      subject: '',
    });
    expect(form.lines).toHaveLength(1);
  });

  it('updates one field without changing the other form values', () => {
    const form = createInitialNewInvoiceForm(new Date(2026, 5, 14));
    const updatedForm = updateNewInvoiceFormField(
      form,
      'priceInputMode',
      'gross',
    );

    expect(updatedForm.priceInputMode).toBe('gross');
    expect(updatedForm.invoiceDate).toBe(form.invoiceDate);
    expect(updatedForm.dueDate).toBe(form.dueDate);
  });

  it('updates due date when payment term changes', () => {
    const form = createInitialNewInvoiceForm(new Date(2026, 5, 14));
    const updatedForm = updateNewInvoiceFormField(
      form,
      'paymentTermDays',
      '30',
    );

    expect(updatedForm.paymentTermDays).toBe('30');
    expect(updatedForm.invoiceDate).toBe('2026-06-14');
    expect(updatedForm.dueDate).toBe('2026-07-14');
  });

  it('updates due date when invoice date changes', () => {
    const form = createInitialNewInvoiceForm(new Date(2026, 5, 14));
    const updatedForm = updateNewInvoiceFormField(
      form,
      'invoiceDate',
      '2026-07-01',
    );

    expect(updatedForm.invoiceDate).toBe('2026-07-01');
    expect(updatedForm.paymentTermDays).toBe('14');
    expect(updatedForm.dueDate).toBe('2026-07-15');
  });

  it('keeps existing due date when payment term is not valid yet', () => {
    const form = createInitialNewInvoiceForm(new Date(2026, 5, 14));
    const updatedForm = updateNewInvoiceFormField(
      form,
      'paymentTermDays',
      '',
    );

    expect(updatedForm.paymentTermDays).toBe('');
    expect(updatedForm.dueDate).toBe(form.dueDate);
  });

  it('stores the selected customer id in the form state', () => {
    const form = createInitialNewInvoiceForm(new Date(2026, 5, 15));
    const updatedForm = updateNewInvoiceFormField(
      form,
      'customerId',
      'customer-1',
    );

    expect(updatedForm.customerId).toBe('customer-1');
    expect(updatedForm.invoiceDate).toBe(form.invoiceDate);
  });
});

describe('calculateDueDateInput', () => {
  it('calculates due date from invoice date and payment term', () => {
    expect(calculateDueDateInput('2026-12-24', '14')).toBe('2027-01-07');
  });

  it('returns null for invalid input', () => {
    expect(calculateDueDateInput('2026-02-30', '14')).toBeNull();
    expect(calculateDueDateInput('2026-06-14', 'abc')).toBeNull();
  });
});
