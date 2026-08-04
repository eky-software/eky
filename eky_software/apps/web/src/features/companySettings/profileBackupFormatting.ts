import { formatFinnishDateTime } from '../../shared/date/formatFinnishDateTime.js';

export function formatProfileBackupTimestamp(value: string): string {
  return formatFinnishDateTime(value) ?? value;
}

export function formatProfileBackupByteSize(value: number): string {
  return `${(value / (1024 * 1024)).toLocaleString('fi-FI', {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  })} Mt`;
}
