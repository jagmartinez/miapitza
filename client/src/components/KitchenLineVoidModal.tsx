import { useEffect, useMemo, useRef, useState } from 'react';
import Modal from './Modal';
import Button from './Button';
import api, { warehousesAPI } from '../services/api';
import { useAppToast } from '../context/ToastContext';
import { getApiErrorMessage } from '../utils/apiError';
import { getIdempotentAttempt, isAmbiguousMutationFailure, type IdempotentAttempt } from '../utils/idempotency';
import { orderLineVoidBlocker, validateOrderLineVoid, voidableOrderLines } from '../utils/orderLineVoid';
import type { Order, Warehouse } from '../types';
import './KitchenLineVoidModal.css';

interface KitchenLineVoidModalProps {
    isOpen: boolean;
    order: Order | null;
    /** Preselected line; without it the supervisor picks one of the sent lines. */
    initialItemId?: number | null;
    onClose: () => void;
    onVoided: (order: Order | null) => void;
}

/**
 * Supervisor void of a line already sent to kitchen. The backend wastes the
 * voided units, reprices the account and keeps the KDS batch releasable; the
 * X-Idempotency-Key is reused only to retry the exact same request after an
 * ambiguous failure, so a double tap never wastes the food twice.
 */
export default function KitchenLineVoidModal({ isOpen, order, initialItemId, onClose, onVoided }: KitchenLineVoidModalProps) {
    const { success, error: showError } = useAppToast();
    const lines = useMemo(() => (order ? voidableOrderLines(order) : []), [order]);
    const blocker = order ? orderLineVoidBlocker(order) : null;
    const [itemId, setItemId] = useState<number | ''>('');
    const [quantity, setQuantity] = useState(1);
    const [reason, setReason] = useState('');
    const [warehouseId, setWarehouseId] = useState<number | ''>('');
    const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState('');
    const attemptRef = useRef<IdempotentAttempt | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        const preselected = lines.find((line) => line.id === initialItemId) ?? (lines.length === 1 ? lines[0] : undefined);
        setItemId(preselected?.id ?? '');
        setQuantity(preselected ? Number(preselected.quantity) : 1);
        setReason('');
        setWarehouseId('');
        setFormError('');
        attemptRef.current = null;
        // Only the order identity resets the form; live refreshes keep the input.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, order?.id, initialItemId]);

    useEffect(() => {
        if (!isOpen || !order?.branchId) return;
        let cancelled = false;
        warehousesAPI.getAll({ branchId: order.branchId })
            .then((response) => {
                if (cancelled) return;
                const list = ((response.data?.data || []) as Warehouse[]).filter(
                    (warehouse) => warehouse.type === 'BRANCH' && warehouse.branchId === order.branchId
                );
                setWarehouses(list);
            })
            .catch(() => {
                // The backend falls back to the branch sale warehouse; an empty
                // list only hides the optional override.
                if (!cancelled) setWarehouses([]);
            });
        return () => { cancelled = true; };
    }, [isOpen, order?.branchId]);

    const selected = lines.find((line) => line.id === itemId);

    const submit = async () => {
        if (!order || blocker) return;
        const request = {
            quantity,
            reason: reason.trim(),
            ...(warehouseId ? { warehouseId: Number(warehouseId) } : {}),
        };
        const validation = validateOrderLineVoid(selected, request);
        if (validation) {
            setFormError(validation);
            return;
        }
        const attempt = getIdempotentAttempt(attemptRef.current, JSON.stringify({ orderId: order.id, itemId, ...request }));
        attemptRef.current = attempt;
        setSubmitting(true);
        setFormError('');
        try {
            const response = await api.post(`/orders/${order.id}/items/${itemId}/void`, request, {
                headers: { 'X-Idempotency-Key': attempt.key },
            });
            attemptRef.current = null;
            const data = response.data?.data as { order?: Order } | undefined;
            success(response.data?.message || 'Línea anulada y merma registrada');
            onVoided(data?.order ?? null);
            onClose();
        } catch (error) {
            if (!isAmbiguousMutationFailure(error)) attemptRef.current = null;
            const message = getApiErrorMessage(error, 'No se pudo anular la línea');
            setFormError(message);
            showError(message);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal
            isOpen={isOpen && Boolean(order)}
            onClose={submitting ? () => undefined : onClose}
            title={order ? `Anular línea · Orden #${order.id}` : 'Anular línea'}
            description="La anulación registra la merma de lo preparado y recalcula la cuenta."
            size="sm"
            footer={(
                <div className="line-void-actions">
                    <Button variant="secondary" onClick={onClose} disabled={submitting}>Cerrar</Button>
                    <Button
                        variant="danger"
                        onClick={() => void submit()}
                        disabled={submitting || Boolean(blocker) || !selected}
                        data-testid="confirm-line-void"
                    >
                        {submitting ? 'Anulando…' : 'Anular y registrar merma'}
                    </Button>
                </div>
            )}
        >
            <div className="line-void-form">
                {blocker ? (
                    <p className="line-void-blocker" role="alert">{blocker}</p>
                ) : lines.length === 0 ? (
                    <p className="line-void-blocker" role="alert">No hay líneas enviadas a cocina para anular. Las líneas sin enviar se eliminan desde el POS.</p>
                ) : (
                    <>
                        <label className="line-void-field">
                            <span>Línea</span>
                            <select
                                value={itemId}
                                onChange={(event) => {
                                    const next = Number(event.target.value) || '';
                                    setItemId(next);
                                    const line = lines.find((entry) => entry.id === next);
                                    setQuantity(line ? Number(line.quantity) : 1);
                                }}
                                aria-label="Línea a anular"
                            >
                                <option value="">Seleccione…</option>
                                {lines.map((line) => (
                                    <option key={line.id} value={line.id}>
                                        {line.quantity}× {line.menuItem?.name || `Producto #${line.menuItemId}`}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className="line-void-field">
                            <span>Cantidad a anular</span>
                            <input
                                type="number"
                                inputMode="numeric"
                                min={1}
                                max={selected ? Number(selected.quantity) : 1}
                                value={quantity}
                                disabled={!selected}
                                onChange={(event) => setQuantity(Math.trunc(Number(event.target.value) || 0))}
                                aria-label="Cantidad a anular"
                            />
                        </label>
                        <label className="line-void-field">
                            <span>Motivo (obligatorio)</span>
                            <textarea
                                value={reason}
                                maxLength={500}
                                rows={3}
                                onChange={(event) => setReason(event.target.value)}
                                placeholder="Ej.: plato devuelto, error de comanda…"
                                aria-label="Motivo de la anulación"
                            />
                        </label>
                        {warehouses.length > 1 && (
                            <label className="line-void-field">
                                <span>Bodega de merma</span>
                                <select
                                    value={warehouseId}
                                    onChange={(event) => setWarehouseId(Number(event.target.value) || '')}
                                    aria-label="Bodega de merma"
                                >
                                    <option value="">Bodega de venta predeterminada</option>
                                    {warehouses.map((warehouse) => (
                                        <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                                    ))}
                                </select>
                            </label>
                        )}
                    </>
                )}
                {formError && !blocker && <p className="line-void-error" role="alert">{formError}</p>}
            </div>
        </Modal>
    );
}
