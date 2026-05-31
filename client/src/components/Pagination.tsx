import Button from './Button';

interface PaginationProps {
    page: number;
    totalPages: number;
    totalItems?: number;
    pageSize?: number;
    onPageChange: (page: number) => void;
    className?: string;
}

export default function Pagination({
    page,
    totalPages,
    totalItems,
    pageSize,
    onPageChange,
    className = '',
}: PaginationProps) {
    if (totalPages <= 1) return null;

    const start = totalItems !== undefined && pageSize !== undefined
        ? (page - 1) * pageSize + 1
        : undefined;
    const end = totalItems !== undefined && pageSize !== undefined
        ? Math.min(page * pageSize, totalItems)
        : undefined;

    return (
        <nav className={`pagination-bar ${className}`.trim()} aria-label="Paginación">
            <Button variant="ghost" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
                Anterior
            </Button>
            <span className="pagination-info">
                Página {page} de {totalPages}
                {start !== undefined && end !== undefined && totalItems !== undefined && (
                    <> · {start}–{end} de {totalItems}</>
                )}
            </span>
            <Button variant="ghost" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
                Siguiente
            </Button>
        </nav>
    );
}
