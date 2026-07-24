import { useEffect, useMemo, useState } from 'react';
import { Armchair, Link2, Search } from 'lucide-react';
import type { Table } from '../types';
import Modal from './Modal';
import Button from './Button';
import './TableGroupModal.css';

export type TableGroupFormData =
    | { mode: 'CREATE'; primaryTableId: number; memberTableIds: number[]; reason?: string }
    | { mode: 'EDIT'; groupId: number; primaryTableId: number; expectedPrimaryTableId: number; memberTableIds: number[]; expectedMemberTableIds: number[]; reason: string };

interface Props {
    isOpen: boolean;
    tables: Table[];
    initialTableId?: number | null;
    submitting: boolean;
    onClose: () => void;
    onSubmit: (data: TableGroupFormData) => Promise<void>;
}

const sortedIds = (ids: number[]) => [...ids].sort((left, right) => left - right);

export default function TableGroupModal({
    isOpen, tables, initialTableId, submitting, onClose, onSubmit
}: Props) {
    const [memberTableIds, setMemberTableIds] = useState<number[]>([]);
    const [primaryTableId, setPrimaryTableId] = useState<number | null>(null);
    const [search, setSearch] = useState('');
    const [reason, setReason] = useState('');
    const initialTable = tables.find((table) => table.id === initialTableId) ?? null;
    const activeGroup = initialTable?.activeTableGroup ?? null;
    const editing = Boolean(activeGroup);
    const activeGroupId = activeGroup?.id ?? null;
    const activeGroupPrimaryTableId = activeGroup?.primaryTableId ?? null;
    const activeGroupMemberTableIds = activeGroup?.memberTableIds ?? null;
    const primary = tables.find((table) => table.id === primaryTableId) ?? null;

    useEffect(() => {
        if (!isOpen) return;
        setPrimaryTableId(activeGroupPrimaryTableId ?? initialTable?.id ?? null);
        setMemberTableIds(activeGroupMemberTableIds ?? []);
        setSearch('');
        setReason(activeGroupId !== null ? 'Ajuste manual del grupo desde el mapa operativo' : '');
    }, [activeGroupId, activeGroupMemberTableIds, activeGroupPrimaryTableId, initialTable?.id, initialTableId, isOpen]);

    const eligible = useMemo(() => {
        const branchTable = primary ?? initialTable;
        if (!branchTable) return [];
        const query = search.trim().toLocaleLowerCase('es');
        return tables.filter((table) => {
            if ((!editing && table.id === branchTable.id) || table.branchId !== branchTable.branchId) return false;
            const belongsToCurrentGroup = Boolean(activeGroup && table.activeTableGroupId === activeGroup.id);
            if (table.activeTableGroupId && !belongsToCurrentGroup) return false;
            if (!belongsToCurrentGroup && !['AVAILABLE', 'OCCUPIED'].includes(table.status)) return false;
            return !query || `mesa ${table.number} ${table.location || 'salón principal'}`.toLocaleLowerCase('es').includes(query);
        });
    }, [activeGroup, editing, initialTable, primary, search, tables]);

    const desiredIds = primary
        ? sortedIds(editing ? memberTableIds : [primary.id, ...memberTableIds])
        : [];
    const selectedTables = tables.filter((table) => desiredIds.includes(table.id));
    const additionalTables = selectedTables.filter((table) => table.id !== primary?.id);
    const totalCapacity = selectedTables.reduce((sum, table) => sum + table.capacity, 0);
    const groupTableCount = desiredIds.length;
    const groupTableLabel = `${groupTableCount} ${groupTableCount === 1 ? 'mesa' : 'mesas'}`;
    const expectedIds = activeGroup ? sortedIds(activeGroup.memberTableIds) : [];
    const hasChanges = !editing
        || desiredIds.join(',') !== expectedIds.join(',')
        || primary?.id !== activeGroup?.primaryTableId;
    const canSubmit = Boolean(primary)
        && (editing ? desiredIds.length >= 2 : memberTableIds.length > 0)
        && !submitting
        && (!editing || (hasChanges && reason.trim().length >= 3));

    const toggleMember = (tableId: number, checked: boolean) => {
        const limit = editing ? 20 : 19;
        const next = checked
            ? memberTableIds.length < limit ? [...memberTableIds, tableId] : memberTableIds
            : memberTableIds.filter((id) => id !== tableId);
        setMemberTableIds(next);
        if (editing && !checked && primaryTableId === tableId) setPrimaryTableId(next[0] ?? null);
        if (editing && checked && primaryTableId === null) setPrimaryTableId(tableId);
    };

    const submit = () => {
        if (!primary || !canSubmit) return;
        if (activeGroup) {
            void onSubmit({
                mode: 'EDIT',
                groupId: activeGroup.id,
                primaryTableId: primary.id,
                expectedPrimaryTableId: activeGroup.primaryTableId,
                memberTableIds: desiredIds,
                expectedMemberTableIds: expectedIds,
                reason: reason.trim()
            });
            return;
        }
        void onSubmit({
            mode: 'CREATE',
            primaryTableId: primary.id,
            memberTableIds,
            reason: reason.trim() || undefined
        });
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={submitting ? () => undefined : onClose}
            title={editing ? 'Editar mesas unidas' : 'Unir mesas físicamente'}
            size="lg"
            description={editing
                ? 'Marca exactamente las mesas que permanecerán unidas. Las cuentas y productos no se moverán.'
                : 'Cada mesa conserva sus sillas y su cuenta. El mapa las mostrará como un solo grupo ocupado.'}
            footer={<>
                <Button type="button" variant="ghost" disabled={submitting} onClick={onClose}>Cancelar</Button>
                <Button type="button" disabled={!canSubmit} onClick={submit}>
                    {submitting
                        ? editing ? 'Guardando…' : 'Uniendo…'
                        : groupTableCount < 2
                            ? 'Debe quedar otra mesa'
                            : editing && !hasChanges
                                ? 'Sin cambios'
                                : editing ? `Guardar ${groupTableLabel}` : `Unir ${groupTableLabel}`}
                </Button>
            </>}
        >
            <div className="table-group-form">
                {primary && (
                    <div className="table-group-route" aria-label="Vista previa de la unión">
                        <div className="table-group-primary-card">
                            <small>Mesa principal — referencia visual</small>
                            <strong>Mesa {primary.number}</strong>
                            <span><Armchair size={15} /> {primary.capacity} {primary.capacity === 1 ? 'silla' : 'sillas'}</span>
                            {editing && <label className="table-group-primary-select">
                                Principal del grupo
                                <select value={primary.id} onChange={(event) => setPrimaryTableId(Number(event.target.value))}>
                                    {selectedTables.map((table) => <option key={table.id} value={table.id}>Mesa {table.number}</option>)}
                                </select>
                            </label>}
                        </div>
                        <span className="table-group-link-icon"><Link2 size={22} /></span>
                        <div className="table-group-total-card">
                            <small>Grupo resultante</small>
                            <strong>{groupTableLabel}</strong>
                            <span>{totalCapacity} sillas = {totalCapacity} comensales</span>
                        </div>
                    </div>
                )}

                <div className="table-group-selection-summary" aria-live="polite">
                    <strong>{groupTableCount < 2 ? 'El grupo necesita otra mesa' : `Selección exacta: ${groupTableLabel}`}</strong>
                    <span>
                        {primary ? `Principal: Mesa ${primary.number}` : 'Sin mesa principal'}
                        {additionalTables.map((table) => ` + Mesa ${table.number}`).join('')}
                    </span>
                    <small>{totalCapacity} sillas = {totalCapacity} comensales</small>
                </div>

                <fieldset className="table-group-members">
                    <legend>{editing ? 'Mesas que permanecerán unidas' : 'Mesas que se acercarán a la principal'}</legend>
                    <label className="table-group-search">
                        <Search size={17} aria-hidden="true" />
                        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por mesa o salón" />
                    </label>
                    <div className="table-group-grid">
                        {eligible.map((table) => {
                            const selected = editing ? desiredIds.includes(table.id) : memberTableIds.includes(table.id);
                            const currentMember = Boolean(activeGroup && activeGroup.memberTableIds.includes(table.id));
                            return (
                                <label key={table.id} className={`${selected ? 'selected' : ''} ${currentMember ? 'current-member' : ''}`}>
                                    <input
                                        type="checkbox"
                                        aria-label={`${selected ? 'Quitar' : 'Agregar'} mesa ${table.number} del grupo`}
                                        checked={selected}
                                        disabled={!selected && memberTableIds.length >= (editing ? 20 : 19)}
                                        onChange={(event) => toggleMember(table.id, event.target.checked)}
                                    />
                                    <span>
                                        <strong>Mesa {table.number}</strong>
                                        <small>{table.location || 'Salón principal'} · {table.capacity} sillas</small>
                                        <em>{table.id === primary?.id ? 'Principal del grupo' : currentMember ? 'Integrante actual' : table.activeOrderCount ? 'Con cuenta activa' : 'Sin cuenta'}</em>
                                    </span>
                                </label>
                            );
                        })}
                        {eligible.length === 0 && <div className="table-group-empty">No hay mesas compatibles disponibles.</div>}
                    </div>
                </fieldset>

                <div className="table-group-callout">
                    <strong>{editing ? 'Editar la unión no mezcla las cuentas' : 'Unión física, no financiera'}</strong>
                    <span>{editing
                        ? 'Una mesa retirada conserva su pedido y quedará ocupada si aún tiene una cuenta activa.'
                        : 'Las cuentas no se mezclan hasta usar “Consolidar”. Después podrás emitir la factura y cobrar.'}</span>
                </div>

                <label className="table-group-reason">
                    {editing ? 'Motivo del cambio' : 'Motivo (opcional)'}
                    <textarea rows={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={editing ? 'Ej.: retirar una mesa agregada por error' : 'Ej.: grupo de 10 comensales'} />
                </label>
            </div>
        </Modal>
    );
}
