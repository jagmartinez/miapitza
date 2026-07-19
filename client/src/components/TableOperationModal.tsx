import { useEffect, useMemo, useState } from 'react';
import Modal from './Modal';
import Button from './Button';
import Select from './Select';
import { ordersAPI } from '../services/api';
import { ACTIVE_ORDER_STATUSES } from '../utils/orderStatus';
import type { Order, Table } from '../types';
import type { SingleValue } from 'react-select';
import { ArrowRight, Merge, Search } from 'lucide-react';
import './TableOperationModal.css';

type Operation = 'TRANSFER' | 'CONSOLIDATE';
type OperationOption = { value: string; label: string };

interface Props {
    isOpen: boolean;
    operation: Operation;
    tables: Table[];
    initialTableId?: number | null;
    intent?: 'MANAGE' | 'PAY';
    submitting: boolean;
    onClose: () => void;
    onTransfer: (data: {
        sourceTableId: number;
        destinationTableId: number;
        orderId: number;
        items?: Array<{ orderItemId: number; quantity: number }>;
        reason?: string;
    }) => Promise<void>;
    onConsolidate: (data: { destinationTableId: number; sourceTableIds: number[]; reason?: string }) => Promise<void>;
}

export default function TableOperationModal({
    isOpen, operation, tables, initialTableId, intent = 'MANAGE', submitting, onClose, onTransfer, onConsolidate
}: Props) {
    const [sourceTableId, setSourceTableId] = useState('');
    const [destinationTableId, setDestinationTableId] = useState('');
    const [sourceTableIds, setSourceTableIds] = useState<number[]>([]);
    const [orderId, setOrderId] = useState('');
    const [transferMode, setTransferMode] = useState<'FULL' | 'PARTIAL'>('FULL');
    const [transferQuantities, setTransferQuantities] = useState<Record<number, number>>({});
    const [orders, setOrders] = useState<Order[]>([]);
    const [loadingOrders, setLoadingOrders] = useState(false);
    const [ordersError, setOrdersError] = useState('');
    const [reason, setReason] = useState('');
    const [sourceSearch, setSourceSearch] = useState('');

    useEffect(() => {
        if (!isOpen) return;
        const initialTable = initialTableId ? tables.find((table) => table.id === initialTableId) : undefined;
        setSourceTableId(operation === 'TRANSFER' && initialTable?.status === 'OCCUPIED' ? String(initialTable.id) : '');
        setDestinationTableId(operation === 'CONSOLIDATE' && initialTable && ['AVAILABLE', 'OCCUPIED'].includes(initialTable.status) ? String(initialTable.id) : '');
        setSourceTableIds(operation === 'CONSOLIDATE' && initialTable?.activeTableGroupId
            ? tables.filter((table) => table.id !== initialTable.id
                && table.activeTableGroupId === initialTable.activeTableGroupId
                && table.status === 'OCCUPIED'
                && (table.activeOrderCount ?? 1) > 0).map((table) => table.id)
            : []);
        setOrderId('');
        setTransferMode('FULL');
        setTransferQuantities({});
        setOrders([]);
        setOrdersError('');
        setReason('');
        setSourceSearch('');
    }, [initialTableId, isOpen, operation, tables]);

    useEffect(() => {
        if (operation !== 'TRANSFER' || !sourceTableId) {
            setOrders([]);
            setOrderId('');
            return;
        }
        let cancelled = false;
        setLoadingOrders(true);
        setOrdersError('');
        ordersAPI.getAll({ tableId: Number(sourceTableId) })
            .then((response) => {
                if (cancelled) return;
                const active = (response.data.data as Order[]).filter((order) => ACTIVE_ORDER_STATUSES.includes(order.status));
                setOrders(active);
                setOrderId(active.length === 1 ? String(active[0].id) : '');
                setTransferQuantities({});
            })
            .catch(() => {
                if (cancelled) return;
                setOrders([]);
                setOrderId('');
                setOrdersError('No se pudieron cargar las órdenes activas de esta mesa.');
            })
            .finally(() => { if (!cancelled) setLoadingOrders(false); });
        return () => { cancelled = true; };
    }, [operation, sourceTableId]);

    const eligibleSources = useMemo(() => tables.filter((table) => table.status === 'OCCUPIED'), [tables]);
    const selectedTransferSource = tables.find((table) => table.id === Number(sourceTableId));
    const selectedConsolidationDestination = tables.find((table) => table.id === Number(destinationTableId));
    const eligibleDestinations = useMemo(
        () => tables.filter((table) => {
            if (table.status !== 'AVAILABLE' && table.status !== 'OCCUPIED') return false;
            if (operation !== 'TRANSFER' || !selectedTransferSource) return true;
            return (table.activeTableGroupId ?? null) === (selectedTransferSource.activeTableGroupId ?? null);
        }),
        [operation, selectedTransferSource, tables]
    );
    const selectedOrder = useMemo(
        () => orders.find((order) => order.id === Number(orderId)),
        [orderId, orders]
    );
    const transferSlices = useMemo(() => Object.entries(transferQuantities)
        .filter(([, quantity]) => quantity > 0)
        .map(([itemId, quantity]) => ({ orderItemId: Number(itemId), quantity })), [transferQuantities]);
    const sourceOptions = useMemo<OperationOption[]>(() => eligibleSources.map((table) => ({
        value: String(table.id),
        label: `Mesa ${table.number}${table.location ? ` · ${table.location}` : ''}`
    })), [eligibleSources]);
    const destinationOptions = useMemo<OperationOption[]>(() => eligibleDestinations
        .filter((table) => String(table.id) !== sourceTableId)
        .map((table) => ({
            value: String(table.id),
            label: `Mesa ${table.number} · ${table.status === 'AVAILABLE' ? 'Disponible' : 'Ocupada'}${table.location ? ` · ${table.location}` : ''}`
        })), [eligibleDestinations, sourceTableId]);
    const orderOptions = useMemo<OperationOption[]>(() => orders.map((order) => ({
        value: String(order.id),
        label: `Orden #${order.id} · ${order.items?.length || 0} productos`
    })), [orders]);
    const consolidationSources = useMemo(
        () => eligibleSources.filter((table) => table.id !== Number(destinationTableId)
            && (table.activeOrderCount ?? 1) > 0
            && (!selectedConsolidationDestination
                || (table.activeTableGroupId ?? null) === (selectedConsolidationDestination.activeTableGroupId ?? null))),
        [destinationTableId, eligibleSources, selectedConsolidationDestination]
    );
    const visibleConsolidationSources = useMemo(() => {
        const query = sourceSearch.trim().toLocaleLowerCase('es');
        if (!query) return consolidationSources;
        return consolidationSources.filter((table) => (
            `mesa ${table.number} ${table.location || 'salón principal'}`.toLocaleLowerCase('es').includes(query)
        ));
    }, [consolidationSources, sourceSearch]);

    const submit = async () => {
        if (operation === 'TRANSFER') {
            await onTransfer({
                sourceTableId: Number(sourceTableId),
                destinationTableId: Number(destinationTableId),
                orderId: Number(orderId),
                ...(transferMode === 'PARTIAL' ? { items: transferSlices } : {}),
                reason: reason.trim() || undefined
            });
        } else {
            await onConsolidate({
                destinationTableId: Number(destinationTableId),
                sourceTableIds,
                reason: reason.trim() || undefined
            });
        }
    };

    const valid = operation === 'TRANSFER'
        ? Boolean(sourceTableId && destinationTableId && orderId && sourceTableId !== destinationTableId
            && (transferMode === 'FULL' || transferSlices.length > 0))
        : Boolean(destinationTableId && sourceTableIds.length > 0 && !sourceTableIds.includes(Number(destinationTableId)));

    return (
        <Modal
            isOpen={isOpen}
            onClose={submitting ? () => undefined : onClose}
            title={operation === 'TRANSFER' ? 'Cambiar consumo de mesa' : intent === 'PAY' ? 'Consolidar antes de cobrar' : 'Consolidar cuentas de mesas'}
            size={operation === 'CONSOLIDATE' ? 'lg' : 'md'}
            description={operation === 'TRANSFER'
                ? 'El traslado completo conserva productos, notas, modificadores y estado de cocina.'
                : 'Las órdenes origen se absorben en una cuenta principal. Si las mesas están unidas físicamente, seguirán ocupadas hasta separarlas o cerrar la operación.'}
            footer={(
                <>
                    <Button type="button" variant="ghost" disabled={submitting} onClick={onClose}>Cancelar</Button>
                    <Button type="button" disabled={!valid || submitting} onClick={submit}>
                        {submitting ? 'Procesando…' : operation === 'TRANSFER' ? 'Cambiar mesa' : intent === 'PAY' ? 'Consolidar y continuar al cobro' : 'Consolidar cuentas'}
                    </Button>
                </>
            )}
        >
            <div className="table-operation-form">
                <div className="table-operation-guide">
                    <span className="active">1</span>
                    <div><strong>{operation === 'TRANSFER' ? 'Define el traslado' : 'Elige la cuenta principal'}</strong><small>{operation === 'TRANSFER' ? 'Selecciona origen, destino y alcance.' : 'Después marca las mesas que se unirán.'}</small></div>
                </div>
                {operation === 'TRANSFER' && sourceTableId && destinationTableId && (
                    <div className={`table-transfer-route mode-${transferMode.toLowerCase()}`} aria-label="Vista previa del cambio de mesa">
                        <div><small>Origen</small><strong>Mesa {tables.find((table) => table.id === Number(sourceTableId))?.number}</strong><span>{transferMode === 'FULL' ? 'Se libera al completar' : 'Conserva el consumo restante'}</span></div>
                        <span><ArrowRight size={22} /></span>
                        <div><small>Destino</small><strong>Mesa {tables.find((table) => table.id === Number(destinationTableId))?.number}</strong><span>{transferMode === 'FULL' ? 'Recibe toda la orden' : 'Recibe solo lo seleccionado'}</span></div>
                    </div>
                )}
                {operation === 'TRANSFER' && (
                    <Select<OperationOption>
                        variant="modal"
                        label="Mesa origen"
                        placeholder="Selecciona una mesa ocupada"
                        options={sourceOptions}
                        value={sourceOptions.find((option) => option.value === sourceTableId) || null}
                        onChange={(option: SingleValue<OperationOption>) => {
                            const nextId = option?.value || '';
                            setSourceTableId(nextId);
                            if (nextId === destinationTableId) setDestinationTableId('');
                        }}
                        isSearchable={sourceOptions.length > 6}
                    />
                )}

                <Select<OperationOption>
                    variant="modal"
                    label={operation === 'TRANSFER' ? 'Mesa destino' : 'Cuenta principal / mesa destino'}
                    placeholder={operation === 'TRANSFER' ? 'Selecciona la mesa destino' : 'Selecciona dónde quedará la cuenta'}
                    options={destinationOptions}
                    value={destinationOptions.find((option) => option.value === destinationTableId) || null}
                    onChange={(option: SingleValue<OperationOption>) => {
                        const nextId = option?.value || '';
                        setDestinationTableId(nextId);
                        setSourceTableIds((current) => current.filter((id) => id !== Number(nextId)));
                    }}
                    isSearchable={destinationOptions.length > 6}
                />

                {operation === 'TRANSFER' && (
                    <div>
                        <Select<OperationOption>
                            variant="modal"
                            label="Orden a trasladar"
                            placeholder={loadingOrders ? 'Cargando órdenes…' : 'Selecciona una orden'}
                            options={orderOptions}
                            value={orderOptions.find((option) => option.value === orderId) || null}
                            isDisabled={!sourceTableId || loadingOrders}
                            onChange={(option: SingleValue<OperationOption>) => {
                            setOrderId(option?.value || '');
                            setTransferQuantities({});
                        }} isSearchable={orderOptions.length > 6} />
                        {ordersError && <span className="table-operation-error" role="alert">{ordersError}</span>}
                    </div>
                )}

                {operation === 'TRANSFER' && selectedOrder && (
                    <fieldset>
                        <legend>Alcance del traslado</legend>
                        <div className="table-operation-mode" role="radiogroup" aria-label="Alcance del traslado">
                            <label>
                                <input type="radio" name="transfer-mode" checked={transferMode === 'FULL'} onChange={() => setTransferMode('FULL')} />
                                Orden completa
                            </label>
                            <label>
                                <input type="radio" name="transfer-mode" checked={transferMode === 'PARTIAL'} onChange={() => setTransferMode('PARTIAL')} />
                                Productos y cantidades
                            </label>
                        </div>
                        {transferMode === 'PARTIAL' && (
                            <div className="table-operation-items">
                                {selectedOrder.items.map((item) => {
                                    const quantity = transferQuantities[item.id] ?? 0;
                                    return (
                                        <label key={item.id}>
                                            <span>{item.menuItem?.name || `Producto #${item.menuItemId}`} <small>({item.quantity} disp.)</small></span>
                                            <input
                                                type="number"
                                                inputMode="numeric"
                                                min={0}
                                                max={item.quantity}
                                                value={quantity}
                                                aria-label={`Cantidad a trasladar de ${item.menuItem?.name || `producto ${item.menuItemId}`}`}
                                                onChange={(event) => {
                                                    const next = Math.max(0, Math.min(item.quantity, Number(event.target.value) || 0));
                                                    setTransferQuantities((current) => ({ ...current, [item.id]: next }));
                                                }}
                                            />
                                        </label>
                                    );
                                })}
                                {selectedOrder.items.length === 0 && <p role="alert">La orden no tiene productos trasladables.</p>}
                            </div>
                        )}
                    </fieldset>
                )}

                {operation === 'CONSOLIDATE' && (
                    <fieldset className="table-operation-sources">
                        <legend>Mesas origen</legend>
                        <div className="table-operation-source-toolbar">
                            <label className="table-operation-search">
                                <Search size={17} aria-hidden="true" />
                                <input
                                    type="search"
                                    value={sourceSearch}
                                    onChange={(event) => setSourceSearch(event.target.value)}
                                    placeholder="Buscar por mesa o salón"
                                    aria-label="Buscar mesas origen"
                                />
                            </label>
                            <span><strong>{sourceTableIds.length}</strong> seleccionadas · {consolidationSources.length} disponibles</span>
                        </div>
                        <div className="table-operation-checks">
                            {visibleConsolidationSources.map((table) => (
                                     <label key={table.id} className={sourceTableIds.includes(table.id) ? 'selected' : ''}>
                                        <input
                                            type="checkbox"
                                            checked={sourceTableIds.includes(table.id)}
                                            onChange={(event) => setSourceTableIds((current) => event.target.checked
                                                ? [...current, table.id]
                                                : current.filter((id) => id !== table.id))}
                                        />
                                        <span><strong>Mesa {table.number}</strong><small>{table.location || 'Salón principal'}</small></span>
                                     </label>
                                ))}
                            {visibleConsolidationSources.length === 0 && (
                                <div className="table-operation-empty">No hay mesas ocupadas que coincidan con la búsqueda.</div>
                            )}
                        </div>
                        {sourceTableIds.length > 0 && (
                            <div className="table-consolidation-preview">
                                <Merge size={18} />
                                <span><strong>{sourceTableIds.length + 1} cuentas → mesa principal</strong><small>{intent === 'PAY' ? 'Luego se emitirá la factura y se abrirá el cobro.' : 'Los productos y totales quedarán en una sola orden.'}</small></span>
                            </div>
                        )}
                    </fieldset>
                )}

                <label>
                    Motivo (opcional)
                    <textarea value={reason} maxLength={500} rows={3} onChange={(event) => setReason(event.target.value)} placeholder="Ej.: clientes se movieron a la terraza" />
                </label>
            </div>
        </Modal>
    );
}
