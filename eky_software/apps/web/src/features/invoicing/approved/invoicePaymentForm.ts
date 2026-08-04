import { getBusinessCalendarDate } from '../../../shared/date/getBusinessCalendarDate.js';

export function getHelsinkiPaymentDate(date = new Date()): string {
  return getBusinessCalendarDate(date);
}
