import { Pagination as UiPagination } from '@/ui';

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

/** Adaptador heredado: misma API de siempre sobre `ui/data/Pagination`. */
export default function Pagination({
    page,
    totalPages,
    totalItems,
    pageSize,
    onPageChange,
    alwaysShow = false,
    emptyLabel,
}: PaginationProps) {
    if (!alwaysShow && totalPages <= 1) return null;

    const safeTotalPages = Math.max(1, totalPages);
    const safePage = Math.min(Math.max(1, page), safeTotalPages);
    const hasRange = totalItems !== undefined && pageSize !== undefined;
    const size = pageSize ?? 1;
    const total = totalItems ?? safeTotalPages * size;
    const infoText = emptyLabel && (!totalItems || totalItems === 0)
        ? emptyLabel
        : hasRange
            ? undefined
            : `Página ${safePage} de ${safeTotalPages}`;

    return (
        <UiPagination
            page={safePage}
            pageSize={size}
            total={total}
            hidePageSize
            infoText={infoText}
            onChange={(next) => onPageChange(next)}
        />
    );
}
