import { useEffect, useMemo, useState } from 'react';
import { Armchair, Link2, Search } from 'lucide-react';
import type { Table } from '../types';
import Modal from './Modal';
import Button from './Button';
import './TableGroupModal.css';

interface Props {
    isOpen: boolean;
    tables: Table[];
    initialTableId?: number | null;
    submitting: boolean;
    onClose: () => void;
    onSubmit: (data: { primaryTableId: number; memberTableIds: number[]; reason?: string }) => Promise<void>;
}

export default function TableGroupModal({
    isOpen, tables, initialTableId, submitting, onClose, onSubmit
}: Props) {
    const [memberTableIds, setMemberTableIds] = useState<number[]>([]);
    const [search, setSearch] = useState('');
    const [reason, setReason] = useState('');
    const primary = tables.find((table) => table.id === initialTableId) ?? null;

    useEffect(() => {
        if (!isOpen) return;
        setMemberTableIds([]);
        setSearch('');
        setReason('');
    }, [initialTableId, isOpen]);

    const eligible = useMemo(() => {
        if (!primary) return [];
        const query = search.trim().toLocaleLowerCase('es');
        return tables.filter((table) => {
            if (table.id === primary.id || table.branchId !== primary.branchId) return false;
            if (table.activeTableGroupId || !['AVAILABLE', 'OCCUPIED'].includes(table.status)) return false;
            return !query || `mesa ${table.number} ${table.location || 'salón principal'}`.toLocaleLowerCase('es').includes(query);
        });
    }, [primary, search, tables]);

    const selectedTables = tables.filter((table) => memberTableIds.includes(table.id));
    const totalCapacity = (primary?.capacity ?? 0) + selectedTables.reduce((sum, table) => sum + table.capacity, 0);
    const groupTableCount = memberTableIds.length + 1;
    const groupTableLabel = `${groupTableCount} ${groupTableCount === 1 ? 'mesa' : 'mesas'}`;

    return (
        <Modal
            isOpen={isOpen}
            onClose={submitting ? () => undefined : onClose}
            title="Unir mesas físicamente"
            size="lg"
            description="Cada mesa conserva sus sillas y su cuenta. El mapa las mostrará como un solo grupo ocupado."
            footer={<>
                <Button type="button" variant="ghost" disabled={submitting} onClick={onClose}>Cancelar</Button>
                <Button
                    type="button"
                    disabled={!primary || memberTableIds.length === 0 || submitting}
                    onClick={() => primary && void onSubmit({
                        primaryTableId: primary.id,
                        memberTableIds,
                        reason: reason.trim() || undefined
                    })}
                >
                    {submitting ? 'Uniendo…' : memberTableIds.length === 0 ? 'Selecciona otra mesa' : `Unir ${groupTableLabel}`}
                </Button>
            </>}
        >
            <div className="table-group-form">
                {primary && (
                    <div className="table-group-route" aria-label="Vista previa de la unión">
                        <div className="table-group-primary-card">
                            <small>Mesa principal</small>
                            <strong>Mesa {primary.number}</strong>
                            <span><Armchair size={15} /> {primary.capacity} {primary.capacity === 1 ? 'silla' : 'sillas'}</span>
                        </div>
                        <span className="table-group-link-icon"><Link2 size={22} /></span>
                        <div className="table-group-total-card">
                            <small>Grupo resultante</small>
                            <strong>{groupTableLabel}</strong>
                            <span>{totalCapacity} sillas = {totalCapacity} comensales</span>
                        </div>
                    </div>
                )}

                <div className="table-group-callout">
                    <strong>Unión física, no financiera</strong>
                    <span>Las cuentas no se mezclan hasta usar “Consolidar” o “Consolidar y cobrar”.</span>
                </div>

                <div className="table-group-selection-summary" aria-live="polite">
                    <strong>{memberTableIds.length === 0 ? 'Aún no has agregado otra mesa' : `Selección exacta: ${groupTableLabel}`}</strong>
                    <span>
                        {primary ? `Principal: Mesa ${primary.number}` : 'Sin mesa principal'}
                        {selectedTables.map((table) => ` + Mesa ${table.number}`).join('')}
                    </span>
                    <small>{totalCapacity} sillas = {totalCapacity} comensales</small>
                </div>

                <fieldset className="table-group-members">
                    <legend>Mesas que se acercarán a la principal</legend>
                    <label className="table-group-search">
                        <Search size={17} aria-hidden="true" />
                        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por mesa o salón" />
                    </label>
                    <div className="table-group-grid">
                        {eligible.map((table) => {
                            const selected = memberTableIds.includes(table.id);
                            return (
                                <label key={table.id} className={selected ? 'selected' : ''}>
                                    <input
                                        type="checkbox"
                                        aria-label={`${selected ? 'Quitar' : 'Agregar'} mesa ${table.number} del grupo`}
                                        checked={selected}
                                        disabled={!selected && memberTableIds.length >= 19}
                                        onChange={(event) => setMemberTableIds((current) => event.target.checked
                                            ? current.length < 19 ? [...current, table.id] : current
                                            : current.filter((id) => id !== table.id))}
                                    />
                                    <span>
                                        <strong>Mesa {table.number}</strong>
                                        <small>{table.location || 'Salón principal'} · {table.capacity} sillas</small>
                                        <em>{table.activeOrderCount ? 'Con cuenta activa' : 'Sin cuenta'}</em>
                                    </span>
                                </label>
                            );
                        })}
                        {eligible.length === 0 && <div className="table-group-empty">No hay mesas compatibles disponibles.</div>}
                    </div>
                </fieldset>

                <label className="table-group-reason">
                    Motivo (opcional)
                    <textarea rows={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ej.: grupo de 10 comensales" />
                </label>
            </div>
        </Modal>
    );
}
