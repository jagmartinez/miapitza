import { useMemo, useState, useEffect, type ReactNode } from 'react';
import Pagination from './Pagination';
import './CatalogView.css';

export interface CatalogColumn<T> {
    /** Unique key for the column. */
    key: string;
    /** Header label. */
    header: ReactNode;
    /** Cell renderer. */
    render: (row: T) => ReactNode;
    /** Text alignment. */
    align?: 'left' | 'right' | 'center';
    /** Extra class for header and cells of this column. */
    className?: string;
}

/** Server-side pagination: rows are already the current page. */
export interface CatalogServerPagination {
    page: number;
    totalPages: number;
    totalItems: number;
    pageSize: number;
    onPageChange: (page: number) => void;
}

interface CatalogTableProps<T> {
    columns: CatalogColumn<T>[];
    rows: T[];
    rowKey: (row: T) => string | number;
    pageSize?: number;
    rowClassName?: (row: T) => string | undefined;
    /** Optional dependency: when it changes, pagination resets to page 1. */
    resetKey?: unknown;
    /** Opens a row (e.g. a detail drawer). Clicks on buttons/links inside the row are ignored. */
    onRowClick?: (row: T) => void;
    /** When given, the table does not slice rows and the footer drives the server page. */
    pagination?: CatalogServerPagination;
    /** Rendered in a full-width row when there are no rows. */
    emptyState?: ReactNode;
    /** Footer label when there are no rows. */
    emptyLabel?: string;
    ariaLabel?: string;
    className?: string;
}

const cellClass = (align?: 'left' | 'right' | 'center', extra?: string) =>
    [align === 'right' ? 'col-right' : align === 'center' ? 'col-center' : '', extra].filter(Boolean).join(' ') || undefined;

/** Generic, paginated catalog table driven by a column config. */
export default function CatalogTable<T>({
    columns,
    rows,
    rowKey,
    pageSize = 10,
    rowClassName,
    resetKey,
    onRowClick,
    pagination,
    emptyState,
    emptyLabel,
    ariaLabel,
    className
}: CatalogTableProps<T>) {
    const [page, setPage] = useState(1);

    useEffect(() => {
        setPage(1);
    }, [resetKey, rows.length]);

    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    const safePage = Math.min(page, totalPages);
    const paged = useMemo(
        () => (pagination ? rows : rows.slice((safePage - 1) * pageSize, safePage * pageSize)),
        [pagination, rows, safePage, pageSize]
    );

    return (
        <div className={['catalog-table-wrapper', className].filter(Boolean).join(' ')}>
            <div className="catalog-table-scroll">
                <table className="catalog-table" aria-label={ariaLabel}>
                    <thead>
                        <tr>
                            {columns.map(col => (
                                <th key={col.key} scope="col" className={cellClass(col.align, col.className)}>{col.header}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {paged.length === 0 && emptyState ? (
                            <tr className="catalog-table-empty-row">
                                <td colSpan={columns.length}>{emptyState}</td>
                            </tr>
                        ) : paged.map(row => (
                            <tr
                                key={rowKey(row)}
                                className={[rowClassName?.(row), onRowClick ? 'is-clickable' : undefined].filter(Boolean).join(' ') || undefined}
                                onClick={onRowClick ? (event) => { if (!(event.target as HTMLElement).closest('button, a, input, select, label')) onRowClick(row); } : undefined}
                            >
                                {columns.map(col => (
                                    <td key={col.key} className={cellClass(col.align, col.className)}>{col.render(row)}</td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {pagination ? (
                <Pagination
                    page={pagination.page}
                    totalPages={pagination.totalPages}
                    totalItems={pagination.totalItems}
                    pageSize={pagination.pageSize}
                    onPageChange={pagination.onPageChange}
                    alwaysShow
                    emptyLabel={emptyLabel}
                />
            ) : (
                <Pagination
                    page={safePage}
                    totalPages={totalPages}
                    totalItems={rows.length}
                    pageSize={pageSize}
                    onPageChange={setPage}
                    emptyLabel={emptyLabel}
                />
            )}
        </div>
    );
}
