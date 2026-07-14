import { useEffect, useMemo, useState } from 'react';
import Modal from './Modal';
import Button from './Button';
import { ordersAPI } from '../services/api';
import { ACTIVE_ORDER_STATUSES } from '../utils/orderStatus';
import type { Order, Table } from '../types';
import './TableOperationModal.css';

type Operation = 'TRANSFER' | 'CONSOLIDATE';

interface Props {
    isOpen: boolean;
    operation: Operation;
    tables: Table[];
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
    isOpen, operation, tables, submitting, onClose, onTransfer, onConsolidate
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

    useEffect(() => {
        if (!isOpen) return;
        setSourceTableId('');
        setDestinationTableId('');
        setSourceTableIds([]);
        setOrderId('');
        setTransferMode('FULL');
        setTransferQuantities({});
        setOrders([]);
        setOrdersError('');
        setReason('');
    }, [isOpen, operation]);

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
    const eligibleDestinations = useMemo(
        () => tables.filter((table) => table.status === 'AVAILABLE' || table.status === 'OCCUPIED'),
        [tables]
    );
    const selectedOrder = useMemo(
        () => orders.find((order) => order.id === Number(orderId)),
        [orderId, orders]
    );
    const transferSlices = useMemo(() => Object.entries(transferQuantities)
        .filter(([, quantity]) => quantity > 0)
        .map(([itemId, quantity]) => ({ orderItemId: Number(itemId), quantity })), [transferQuantities]);

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
            title={operation === 'TRANSFER' ? 'Cambiar consumo de mesa' : 'Consolidar cuentas de mesas'}
            description={operation === 'TRANSFER'
                ? 'El traslado completo conserva productos, notas, modificadores y estado de cocina.'
                : 'Las órdenes origen se absorben en una cuenta principal y las mesas secundarias se liberan atómicamente.'}
            footer={(
                <>
                    <Button type="button" variant="ghost" disabled={submitting} onClick={onClose}>Cancelar</Button>
                    <Button type="button" disabled={!valid || submitting} onClick={submit}>
                        {submitting ? 'Procesando…' : operation === 'TRANSFER' ? 'Cambiar mesa' : 'Consolidar cuentas'}
                    </Button>
                </>
            )}
        >
            <div className="table-operation-form">
                {operation === 'TRANSFER' && (
                    <label>
                        Mesa origen
                        <select value={sourceTableId} onChange={(event) => setSourceTableId(event.target.value)}>
                            <option value="">Selecciona una mesa ocupada</option>
                            {eligibleSources.map((table) => <option key={table.id} value={table.id}>Mesa {table.number}</option>)}
                        </select>
                    </label>
                )}

                <label>
                    Mesa destino
                    <select value={destinationTableId} onChange={(event) => {
                        const nextId = event.target.value;
                        setDestinationTableId(nextId);
                        setSourceTableIds((current) => current.filter((id) => id !== Number(nextId)));
                    }}>
                        <option value="">Selecciona la mesa principal</option>
                        {eligibleDestinations
                            .filter((table) => String(table.id) !== sourceTableId)
                            .map((table) => <option key={table.id} value={table.id}>Mesa {table.number} · {table.status === 'AVAILABLE' ? 'Disponible' : 'Ocupada'}</option>)}
                    </select>
                </label>

                {operation === 'TRANSFER' && (
                    <label>
                        Orden a trasladar
                        <select value={orderId} disabled={!sourceTableId || loadingOrders} onChange={(event) => {
                            setOrderId(event.target.value);
                            setTransferQuantities({});
                        }}>
                            <option value="">{loadingOrders ? 'Cargando órdenes…' : 'Selecciona una orden'}</option>
                            {orders.map((order) => <option key={order.id} value={order.id}>Orden #{order.id}</option>)}
                        </select>
                        {ordersError && <span className="table-operation-error" role="alert">{ordersError}</span>}
                    </label>
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
                    <fieldset>
                        <legend>Mesas origen</legend>
                        <div className="table-operation-checks">
                            {eligibleSources
                                .filter((table) => table.id !== Number(destinationTableId))
                                .map((table) => (
                                    <label key={table.id}>
                                        <input
                                            type="checkbox"
                                            checked={sourceTableIds.includes(table.id)}
                                            onChange={(event) => setSourceTableIds((current) => event.target.checked
                                                ? [...current, table.id]
                                                : current.filter((id) => id !== table.id))}
                                        />
                                        Mesa {table.number}
                                    </label>
                                ))}
                        </div>
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
