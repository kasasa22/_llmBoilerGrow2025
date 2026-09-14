interface BodyPaginationProps {
  currentIndex: number;
  total: number;
}

export function BodyPagination({ currentIndex, total }: BodyPaginationProps) {
  if (total <= 0) return null;
  const capped = Math.min(total, 6);
  return (
    <div className="body-pagination" aria-label="Session pagination">
      {Array.from({ length: capped }, (_, i) => (
        <span
          key={i}
          className={i === currentIndex ? 'pagination-dot pagination-dot--active' : 'pagination-dot'}
          aria-current={i === currentIndex ? 'page' : undefined}
        />
      ))}
      {total > capped ? <span className="pagination-more">+{total - capped}</span> : null}
    </div>
  );
}
