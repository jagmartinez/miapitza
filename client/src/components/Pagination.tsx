import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

interface PaginationProps {
    page: number;
    totalPages: number;
    totalItems?: number;
    pageSize?: number;
    onPageChange: (page: number) => void;
    className?: string;
    /** When true, footer stays visible even with a single page (e.g. empty lists). */
    alwaysShow?: boolean;
    emptyLabel?: string;
}

export default function Pagination({
    page,
    totalPages,
    totalItems,
    pageSize,
    onPageChange,
    className = '',
    alwaysShow = false,
    emptyLabel,
}: PaginationProps) {
    if (!alwaysShow && totalPages <= 1) return null;

    const safeTotalPages = Math.max(1, totalPages);
    const safePage = Math.min(Math.max(1, page), safeTotalPages);
    const hasRange = totalItems !== undefined && pageSize !== undefined;
    const start = hasRange && totalItems! > 0 ? (safePage - 1) * pageSize! + 1 : undefined;
    const end = hasRange && totalItems! > 0 ? Math.min(safePage * pageSize!, totalItems!) : undefined;

    const infoText = emptyLabel && (!totalItems || totalItems === 0)
        ? emptyLabel
        : start !== undefined && end !== undefined && totalItems !== undefined
            ? `${start}–${end} de ${totalItems}`
            : `Página ${safePage} de ${safeTotalPages}`;

    return (
        <nav className={`table-pagination ${className}`.trim()} aria-label="Paginación">
            <span className="pagination-info">{infoText}</span>
            <div className="pagination-controls">
                <button
                    type="button"
                    className="pagination-btn"
                    disabled={safePage <= 1}
                    onClick={() => onPageChange(1)}
                    title="Primera página"
                    aria-label="Primera página"
                >
                    <ChevronsLeft size={16} />
                </button>
                <button
                    type="button"
                    className="pagination-btn"
                    disabled={safePage <= 1}
                    onClick={() => onPageChange(safePage - 1)}
                    title="Anterior"
                    aria-label="Página anterior"
                >
                    <ChevronLeft size={16} />
                </button>
                <span className="pagination-page">{safePage} / {safeTotalPages}</span>
                <button
                    type="button"
                    className="pagination-btn"
                    disabled={safePage >= safeTotalPages}
                    onClick={() => onPageChange(safePage + 1)}
                    title="Siguiente"
                    aria-label="Página siguiente"
                >
                    <ChevronRight size={16} />
                </button>
                <button
                    type="button"
                    className="pagination-btn"
                    disabled={safePage >= safeTotalPages}
                    onClick={() => onPageChange(safeTotalPages)}
                    title="Última página"
                    aria-label="Última página"
                >
                    <ChevronsRight size={16} />
                </button>
            </div>
        </nav>
    );
}
