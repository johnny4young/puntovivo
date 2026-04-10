interface TableLoadingStateProps {
  message: string;
  rowCount?: number;
}

function SkeletonLine({ className }: { className: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-shimmer rounded-2xl bg-gradient-to-r from-surface-3 via-white to-surface-3 ${className}`}
    />
  );
}

export function TableLoadingState({
  message,
  rowCount = 8,
}: TableLoadingStateProps) {
  return (
    <div className="space-y-4" role="status" aria-live="polite" aria-label={message}>
      <span className="sr-only">{message}</span>

      <div className="data-table-toolbar">
        <SkeletonLine className="h-10 w-full max-w-sm" />
        <div className="flex items-center gap-2">
          <SkeletonLine className="h-9 w-24" />
          <SkeletonLine className="h-9 w-24" />
        </div>
      </div>

      <div className="overflow-hidden rounded-[24px] border border-line/80 bg-card/82 shadow-[var(--shadow-card)]">
        <div className="border-b border-line/70 bg-surface-2/80 px-4 py-3">
          <div className="grid grid-cols-4 gap-4">
            <SkeletonLine className="h-4 w-20" />
            <SkeletonLine className="h-4 w-24" />
            <SkeletonLine className="h-4 w-16" />
            <SkeletonLine className="h-4 w-20" />
          </div>
        </div>

        <div className="divide-y divide-line/70 bg-card/85">
          {Array.from({ length: rowCount }, (_, index) => (
            <div key={index} className="grid grid-cols-4 gap-4 px-4 py-4">
              <SkeletonLine className="h-4 w-4/5" />
              <SkeletonLine className="h-4 w-3/5" />
              <SkeletonLine className="h-4 w-2/5" />
              <SkeletonLine className="h-4 w-1/2" />
            </div>
          ))}
        </div>
      </div>

      <div className="data-table-pagination">
        <SkeletonLine className="h-4 w-44" />
        <div className="flex items-center gap-2">
          <SkeletonLine className="h-9 w-9" />
          <SkeletonLine className="h-9 w-9" />
          <SkeletonLine className="h-4 w-24" />
          <SkeletonLine className="h-9 w-9" />
          <SkeletonLine className="h-9 w-9" />
        </div>
      </div>
    </div>
  );
}
