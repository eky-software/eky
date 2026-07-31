export interface InvoiceListSortOption {
  label: string;
  value: string;
}

interface InvoiceListSortSelectProps {
  className?: string | undefined;
  label: string;
  onChange(value: string): void;
  options: readonly InvoiceListSortOption[];
  value: string;
}

export function InvoiceListSortSelect({
  className,
  label,
  onChange,
  options,
  value,
}: InvoiceListSortSelectProps): React.JSX.Element {
  return (
    <label className={className}>
      <span>{label}</span>
      <select
        aria-label={label}
        onChange={(event) => onChange(event.currentTarget.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
