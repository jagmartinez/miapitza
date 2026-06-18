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
            <Pagination
                page={safePage}
                totalPages={totalPages}
                totalItems={rows.length}
                pageSize={pageSize}
                onPageChange={setPage}
            />
        </div>
    );
}
