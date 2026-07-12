interface Props {
  rows?: number;
  cols?: number;
}

export function TableSkeleton({ rows = 6, cols = 5 }: Props) {
  return (
    <div className="table-skeleton" aria-hidden>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="table-skeleton-row" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {Array.from({ length: cols }, (_, col) => (
            <span key={col} className="table-skeleton-cell" />
          ))}
        </div>
      ))}
    </div>
  );
}
