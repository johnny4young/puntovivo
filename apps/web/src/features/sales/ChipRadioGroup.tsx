interface ChipRadioGroupProps<Value extends string> {
  name: string;
  legend: string;
  options: readonly Value[];
  value: Value | null;
  onChange: (value: Value) => void;
  labelFor: (value: Value) => string;
  testIdPrefix: string;
  /** Show the legend above the chips; otherwise it is read only by assistive technology. */
  showLegend?: boolean | undefined;
}

/** Native radios dressed as chips: arrows move the choice and Enter submits the form. */
export function ChipRadioGroup<Value extends string>({
  name,
  legend,
  options,
  value,
  onChange,
  labelFor,
  testIdPrefix,
  showLegend = false,
}: ChipRadioGroupProps<Value>) {
  return (
    <fieldset>
      <legend className={showLegend ? 'sales-cap mb-2' : 'sr-only'}>{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map(option => (
          <label key={option} className="sales-pill sales-quick-chip till-incident-reason">
            <input
              type="radio"
              name={name}
              className="sr-only"
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
              data-testid={`${testIdPrefix}-${option}`}
            />
            {labelFor(option)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
