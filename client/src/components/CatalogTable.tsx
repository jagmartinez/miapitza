import { useMemo, useState, useEffect, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
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
}

interface CatalogTableProps<T> {
    columns: CatalogColumn<T>[];
    rows: T[];
    rowKey: (row: T) => string | number;
    pageSize?: number;
    rowClassName?: (row: T) => string | undefined;
    /** Optional dependency: when it changes, pagination resets to page 1. */
    resetKey?: unknown;
}

const alignClass = (align?: 'left' | 'right' | 'center') =>
    align === 'right' ? 'col-right' : align === 'center' ? 'col-center' : '';

/** Generic, paginated catalog table driven by a column config. */
export default function CatalogTable<T>({
    columns,
    rows,
    rowKey,
    pageSize = 10,
    rowClassName,
    resetKey
}: CatalogTableProps<T>) {
    const [page, setPage] = useState(1);

    useEffect(() => {
        setPage(1);
    }, [resetKey, rows.length]);

    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    const safePage = Math.min(page, totalPages);
    const paged = useMemo(
        () => rows.slice((safePage - 1) * pageSize, safePage * pageSize),
        [rows, safePage, pageSize]
    );

    return (
        <div className="catalog-table-wrapper">
            <table className="catalog-table">
                <thead>
                    <tr>
                        {columns.map(col => (
                            <th key={col.key} className={alignClass(col.align)}>{col.header}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {paged.map(row => (
                        <tr key={rowKey(row)} className={rowClassName?.(row)}>
                            {columns.map(col => (
                                <td key={col.key} className={alignClass(col.align)}>{col.render(row)}</td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
            {totalPages > 1 && (
                <div className="catalog-pagination">
                    <span className="pagination-info">
                        {((safePage - 1) * pageSize) + 1}–{Math.min(safePage * pageSize, rows.length)} de {rows.length}
                    </span>
                    <div className="pagination-controls">
                        <button
                            type="button"
                            className="pagination-btn"
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            disabled={safePage <= 1}
                            title="Anterior"
                            aria-label="Página anterior"
                        >
                            <ChevronLeft size={16} />
                        </button>
                        <span className="pagination-page">{safePage} / {totalPages}</span>
                        <button
                            type="button"
                            className="pagination-btn"
                            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                            disabled={safePage >= totalPages}
                            title="Siguiente"
                            aria-label="Página siguiente"
                        >
                            <ChevronRight size={16} />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
