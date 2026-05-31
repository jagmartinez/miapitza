import { useRef } from 'react';
import { X } from 'lucide-react';
import type { Table } from '../types';
import { useDialogA11y } from '../hooks/useDialogA11y';
import './Modal.css';
import './TableSelectionModal.css';

interface TableSelectionModalProps {
    tables: Table[];
    onSelectTable: (table: Table) => void;
    onClose: () => void;
}

export default function TableSelectionModal({ tables, onSelectTable, onClose }: TableSelectionModalProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const { titleId } = useDialogA11y(true, onClose, containerRef);
    const availableTables = tables.filter(t => t.status === 'AVAILABLE');
    const occupiedTables = tables.filter(t => t.status === 'OCCUPIED');

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div
                ref={containerRef}
                className="table-selection-modal-content"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="table-selection-modal-header">
                    <h2 id={titleId}>Seleccionar Mesa</h2>
                    <button type="button" className="close-btn" onClick={onClose} aria-label="Cerrar">
                        <X size={24} aria-hidden="true" />
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
