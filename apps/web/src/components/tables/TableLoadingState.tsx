interface TableLoadingStateProps {
  message: string;
  rowCount?: number;
}

export function TableLoadingState({ message, rowCount = 8 }: TableLoadingStateProps) {
  const rowKeys = Array.from({ length: rowCount }, (_, index) => `row-${index + 1}`);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={message}
      className="operator-table-shell overflow-hidden rounded-[16px] border border-line/80"
    >
      <span className="sr-only">{message}</span>

      <div className="divide-y divide-line/60">
        {rowKeys.map(key => (
          <div key={key} className="flex items-center gap-3 px-4 py-3.5">
            <span aria-hidden="true" className="pv-sk h-9 w-9 shrink-0 rounded-[10px]" />
            <div className="flex flex-1 flex-col gap-1.5">
              <span aria-hidden="true" className="pv-sk h-3 w-3/5" />
              <span aria-hidden="true" className="pv-sk h-2.5 w-1/3" />
            </div>
            <span aria-hidden="true" className="pv-sk h-5 w-14 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
