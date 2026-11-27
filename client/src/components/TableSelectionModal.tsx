import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { Table } from '../types';
import { Badge, Button, EmptyState, FullScreenModal, Input, TableToolbar, formatNumber } from '@/ui';
import './TableSelectionModal.css';

interface TableSelectionModalProps {
    tables: Table[];
    excludeTableId?: number | null;
    onSelectTable: (table: Table) => void;
    onClose: () => void;
}

function matchesTableSearch(table: Table, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const number = String(table.number).toLowerCase();
    const location = (table.location || '').toLowerCase();
    return number.includes(q) || location.includes(q);
}

export default function TableSelectionModal({
    tables,
    excludeTableId,
    onSelectTable,
    onClose
}: TableSelectionModalProps) {
    const [searchQuery, setSearchQuery] = useState('');

    const filteredTables = useMemo(
        () => tables.filter((table) => (
            table.id !== excludeTableId && matchesTableSearch(table, searchQuery)
        )),
        [excludeTableId, tables, searchQuery]
    );

    const availableTables = filteredTables.filter(t => t.status === 'AVAILABLE');
    const occupiedTables = filteredTables.filter(t => t.status === 'OCCUPIED');

    const renderTable = (table: Table, occupied: boolean) => (
        <li key={table.id}>
            <button
                type="button"
                className={`table-pick ${occupied ? 'is-occupied' : ''}`.trim()}
                onClick={() => {
                    onSelectTable(table);
                    onClose();
                }}
            >
                <span className="table-pick__number">Mesa {table.number}</span>
                <span className="table-pick__capacity">{formatNumber(table.capacity, 0)} personas</span>
                {occupied && <Badge tone="warning" dot>Ocupada</Badge>}
            </button>
        </li>
    );

    return (
        <FullScreenModal
            isOpen
            onClose={onClose}
            title="Seleccionar Mesa"
            footer={({ requestClose }) => <Button variant="secondary" onClick={requestClose}>Cancelar</Button>}
        >
            <div className="table-pick-content">
                <TableToolbar>
                    <Input
                        type="search"
                        prefix={<Search size={16} aria-hidden="true" />}
                        aria-label="Filtrar mesas"
                        placeholder="Filtrar por nombre o ubicación de mesa..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        autoFocus
                    />
                </TableToolbar>

                {filteredTables.length === 0 && (
                    <EmptyState
                        title={searchQuery.trim() ? `No hay mesas que coincidan con "${searchQuery}"` : 'No hay otra mesa disponible para seleccionar.'}
                    />
                )}

                {availableTables.length > 0 && (
                    <section className="table-pick-section" aria-label="Mesas Disponibles">
                        <h3 className="table-pick-section__title">Mesas Disponibles</h3>
                        <ul className="table-pick-grid">
                            {availableTables.map((table) => renderTable(table, false))}
                        </ul>
                    </section>
                )}

                {occupiedTables.length > 0 && (
                    <section className="table-pick-section" aria-label="Mesas Ocupadas">
                        <h3 className="table-pick-section__title">Mesas Ocupadas</h3>
                        <ul className="table-pick-grid">
                            {occupiedTables.map((table) => renderTable(table, true))}
                        </ul>
                    </section>
                )}
            </div>
        </FullScreenModal>
    );
}
