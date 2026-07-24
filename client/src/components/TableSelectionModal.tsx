import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { Table } from '../types';
import Modal from './Modal';
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

    return (
        <Modal isOpen onClose={onClose} title="Seleccionar Mesa" size="lg">
            <div className="table-selection-modal-content">
                <div className="table-selection-modal-toolbar">
                    <div className="table-selection-search">
                        <Search size={18} className="table-selection-search-icon" aria-hidden="true" />
                        <input
                            type="text"
                            className="table-selection-search-input"
                            placeholder="Filtrar por nombre o ubicación de mesa..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            autoFocus
                        />
                    </div>
                </div>

                <div className="table-selection-modal-body">
                    {filteredTables.length === 0 && (
                        <div className="table-selection-empty">
                            {searchQuery.trim()
                                ? <>No hay mesas que coincidan con &quot;{searchQuery}&quot;</>
                                : 'No hay otra mesa disponible para seleccionar.'}
                        </div>
                    )}

                    {availableTables.length > 0 && (
                        <div className="table-section">
                            <h3 className="section-title">Mesas Disponibles</h3>
                            <div className="tables-grid-modal">
                                {availableTables.map(table => (
                                    <button
                                        key={table.id}
                                        type="button"
                                        className="table-card available"
                                        onClick={() => {
                                            onSelectTable(table);
                                            onClose();
                                        }}
                                    >
                                        <div className="table-number-large">Mesa {table.number}</div>
                                        <div className="table-capacity">{table.capacity} personas</div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {occupiedTables.length > 0 && (
                        <div className="table-section">
                            <h3 className="section-title">Mesas Ocupadas</h3>
                            <div className="tables-grid-modal">
                                {occupiedTables.map(table => (
                                    <button
                                        key={table.id}
                                        type="button"
                                        className="table-card occupied"
                                        onClick={() => {
                                            onSelectTable(table);
                                            onClose();
                                        }}
                                    >
                                        <div className="table-number-large">Mesa {table.number}</div>
                                        <div className="table-capacity">{table.capacity} personas</div>
                                        <div className="occupied-badge">Ocupada</div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </Modal>
    );
}
