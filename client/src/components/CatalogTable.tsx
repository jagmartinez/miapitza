import { useMemo, type ReactNode } from 'react';
import { DataTable, type Column } from '@/ui';

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
    /** Ignorado: DataTable usa `rowTone`; ninguna pantalla lo usa hoy. */
    rowClassName?: (row: T) => string | undefined;
    /** Optional dependency: when it changes, pagination resets to page 1. */
    resetKey?: unknown;
    /** Paginación de servidor: `rows` ya es la página actual. */
    pagination?: { page: number; pageSize: number; total: number; onPageChange: (page: number) => void };
}

const PAGE_SIZES = [10, 25, 50, 100];

/** Adaptador heredado: misma API de siempre sobre `DataTable`. */
export default function CatalogTable<T>({
    columns,
    rows,
    rowKey,
    pageSize = 10,
    resetKey,
    pagination,
}: CatalogTableProps<T>) {
    // Como antes, cambiar resetKey o el número de filas vuelve a la página 1.
    const resetToken = useMemo(() => ({}), [resetKey, rows.length]); // eslint-disable-line react-hooks/exhaustive-deps

    const uiColumns = useMemo<Column<T>[]>(
        () =>
            columns.map((c) => ({
                key: c.key,
                header: c.header,
                render: c.render,
                // `type` solo aplica la alineación numérica; el contenido sale de `render`.
                type: c.align === 'right' ? 'number' : 'text',
            })),
        [columns],
    );
    const sizes = PAGE_SIZES.includes(pageSize) ? PAGE_SIZES : [...PAGE_SIZES, pageSize].sort((a, b) => a - b);

    return (
        <DataTable
            columns={uiColumns}
            rows={rows}
            rowKey={rowKey}
            ariaLabel="Tabla de catálogo"
            defaultPageSize={pageSize}
            pageSizeOptions={pagination ? [pagination.pageSize] : sizes}
            resetKey={resetToken}
            pagination={
                pagination
                    ? {
                          mode: 'server',
                          page: pagination.page,
                          pageSize: pagination.pageSize,
                          total: pagination.total,
                          onChange: (page) => pagination.onPageChange(page),
                      }
                    : { mode: 'client' }
            }
        />
    );
}
