interface InvoiceListPageSizeSelectProps {
  className?: string | undefined;
  label: string;
  onChange(value: number): void;
  options: readonly number[];
  value: number;
}

export function InvoiceListPageSizeSelect({
  className,
  label,
  onChange,
  options,
  value,
}: InvoiceListPageSizeSelectProps): React.JSX.Element {
  return (
    <label className={className}>
      <span>{label}</span>
      <select
        aria-label={label}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        value={value}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}
