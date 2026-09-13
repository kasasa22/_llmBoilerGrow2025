interface TraceBadgeProps {
  traceId: string | null;
}

export function TraceBadge({ traceId }: TraceBadgeProps) {
  if (!traceId) return null;
  return (
    <span className="badge trace-badge" title={`trace_id: ${traceId}`}>
      trace {traceId.slice(0, 8)}
    </span>
  );
}
