import { X } from 'lucide-react';
import type { Table } from '../types';
import './TableSelectionModal.css';

interface TableSelectionModalProps {
    tables: Table[];
    onSelectTable: (table: Table) => void;
    onClose: () => void;
}

export default function TableSelectionModal({ tables, onSelectTable, onClose }: TableSelectionModalProps) {
    const availableTables = tables.filter(t => t.status === 'AVAILABLE');
    const occupiedTables = tables.filter(t => t.status === 'OCCUPIED');

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="table-selection-modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="table-selection-modal-header">
                    <h2>Seleccionar Mesa</h2>
                    <button className="close-btn" onClick={onClose}>
                        <X size={24} />
                    </button>
                </div>

                <div className="table-selection-modal-body">
                    {availableTables.length > 0 && (
                        <div className="table-section">
                            <h3 className="section-title">Mesas Disponibles</h3>
                            <div className="tables-grid-modal">
                                {availableTables.map(table => (
                                    <button
                                        key={table.id}
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
        </div>
    );
}
