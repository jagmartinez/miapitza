import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { createPortal } from 'react-dom';
import type { SingleValue } from 'react-select';
import {
    Banknote,
    CreditCard,
    Layers3,
    Plus,
    Smartphone,
    Trash2,
    Users,
    X,
} from 'lucide-react';
import { paymentsAPI, splitBillAPI, warehousesAPI } from '../services/api';
import type { Order, PaymentMethodType, Warehouse } from '../types';
import { useDialogA11y } from '../hooks/useDialogA11y';
import { isCashPaymentMethodType } from '../utils/paymentAccess';
import { newIdempotencyKey } from '../utils/idempotency';
import {
    centsToMoney,
    canUsePaymentMethodInMixed,
    formatMoneyAmount,
    formatMoneyInput,
    hasUniqueNormalizedPayerNames,
    moneyToCents,
    normalizePayerName,
    parseMoneyInput,
    splitTotalEvenly,
    summarizePaymentAllocation,
} from '../utils/payment';
import CustomSelect from './Select';
import './PaymentModal.css';

type PaymentMode = 'single' | 'mixed' | 'split';
type SplitStrategy = 'evenly' | 'by-items' | 'by-amount';
type MethodOption = { value: number; label: string };
type WarehouseOption = { value: number; label: string };

interface PaymentMethodRow {
    id: number;
    name: string;
    type: PaymentMethodType;
}

interface PaymentLeg {
    id: string;
    paymentMethodId: number | null;
    amount: string;
    reference: string;
    received: string;
}

interface SplitLeg extends PaymentLeg {
    payerName: string;
}

interface ApiEnvelope {
    _offline?: boolean;
}

interface PaymentModalProps {
    isOpen: boolean;
    onClose: () => void;
    orderTotal: number;
    orderId: number | null;
    order?: Order | null;
    onPaymentSuccess: (data?: { offlineQueued?: boolean }) => void;
    currencySymbol?: string;
    hasUsableCashShift?: boolean;
    initialMode?: 'single' | 'split';
}

function apiErrorMessage(error: unknown, fallback: string): string {
    if (typeof error === 'object' && error !== null && 'response' in error) {
        const message = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
        if (message) return message;
    }
    return error instanceof Error && error.message ? error.message : fallback;
}

function createLeg(methodId: number | null, amount = 0): PaymentLeg {
    const formatted = formatMoneyInput(amount.toFixed(2));
    return {
        id: newIdempotencyKey(),
        paymentMethodId: methodId,
        amount: formatted,
        reference: '',
        received: formatted,
    };
}

function methodIcon(type?: PaymentMethodType) {
    if (type === 'CASH') return Banknote;
    if (type === 'CARD') return CreditCard;
    return Smartphone;
}

export default function PaymentModal({
    isOpen,
    onClose,
    orderTotal,
    orderId,
    order,
    onPaymentSuccess,
    currencySymbol = '$',
    hasUsableCashShift = true,
    initialMode = 'single',
}: PaymentModalProps) {
    const dialogRef = useRef<HTMLDivElement>(null);
    const scrollAreaRef = useRef<HTMLDivElement>(null);
    const [mode, setMode] = useState<PaymentMode>(initialMode);
    const [methods, setMethods] = useState<PaymentMethodRow[]>([]);
    const [methodsLoading, setMethodsLoading] = useState(false);
    const [methodsError, setMethodsError] = useState('');
    const [balance, setBalance] = useState(orderTotal);
    const [balanceLoading, setBalanceLoading] = useState(false);
    const [balanceError, setBalanceError] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [queuedPayment, setQueuedPayment] = useState(false);
    const [settlementWarehouses, setSettlementWarehouses] = useState<Warehouse[]>([]);
    const [settlementWarehouseId, setSettlementWarehouseId] = useState<number | null>(null);
    const [settlementWarehouseLoading, setSettlementWarehouseLoading] = useState(false);
    const [settlementWarehouseError, setSettlementWarehouseError] = useState('');

    const [singleMethodId, setSingleMethodId] = useState<number | null>(null);
    const [singleReference, setSingleReference] = useState('');
    const [singleReceived, setSingleReceived] = useState(formatMoneyInput(orderTotal.toFixed(2)));
    const singleKeyRef = useRef(newIdempotencyKey());

    const [mixedLegs, setMixedLegs] = useState<PaymentLeg[]>([]);
    const [mixedSucceeded, setMixedSucceeded] = useState<string[]>([]);
    const [mixedAttempted, setMixedAttempted] = useState(false);
    const mixedKeysRef = useRef<Record<string, string>>({});

    const [splitStrategy, setSplitStrategy] = useState<SplitStrategy>('by-items');
    const [splitLegs, setSplitLegs] = useState<SplitLeg[]>([]);
    const [itemUnitOwners, setItemUnitOwners] = useState<Record<number, Array<number | null>>>({});
    const [splitSucceeded, setSplitSucceeded] = useState<string[]>([]);
    const [splitAttempted, setSplitAttempted] = useState(false);
    const [previewLoading, setPreviewLoading] = useState(false);
    const splitKeysRef = useRef<Record<string, string>>({});
    const previewSequenceRef = useRef(0);
    const lastItemPreviewSignatureRef = useRef('');

    const close = useCallback(() => {
        if (!loading) onClose();
    }, [loading, onClose]);
    const { titleId } = useDialogA11y(isOpen, close, dialogRef, {
        closeOnEscape: !loading,
    });

    const methodById = useMemo(
        () => new Map(methods.map((method) => [method.id, method])),
        [methods],
    );
    const methodOptions = useMemo<MethodOption[]>(
        () => methods.map((method) => ({ value: method.id, label: method.name })),
        [methods],
    );
    const usableMethodOptions = useMemo(
        () => methodOptions.filter((option) => {
            const method = methodById.get(option.value);
            return hasUsableCashShift || !isCashPaymentMethodType(method?.type);
        }),
        [hasUsableCashShift, methodById, methodOptions],
    );
    const mixedMethodOptions = useMemo(
        () => usableMethodOptions.filter((option) => {
            const type = methodById.get(option.value)?.type;
            return canUsePaymentMethodInMixed(type, hasUsableCashShift);
        }),
        [hasUsableCashShift, methodById, usableMethodOptions],
    );

    const orderItems = useMemo(() => order?.items || [], [order]);
    const completesReadyTable = Boolean(order?.tableId && order.status === 'READY');
    const settlementWarehouseOptions = useMemo<WarehouseOption[]>(
        () => settlementWarehouses.map((warehouse) => ({
            value: warehouse.id,
            label: `${warehouse.name} (${warehouse.code})`,
        })),
        [settlementWarehouses],
    );
    const totalCents = moneyToCents(balance);

    const isCash = useCallback(
        (methodId: number | null) => Boolean(methodId && isCashPaymentMethodType(methodById.get(methodId)?.type)),
        [methodById],
    );

    const formatField = (value: string) => formatMoneyInput(value || '0');
    const parseField = (value: string) => parseMoneyInput(value);
    const displayMoney = (value: number) => formatMoneyAmount(value, currencySymbol);

    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        setMethods([]);
        setSingleMethodId(null);
        setMethodsLoading(true);
        setMethodsError('');
        paymentsAPI.getPaymentMethods()
            .then((response) => {
                if (cancelled) return;
                const rows = (response.data?.data || []) as Array<PaymentMethodRow & { active?: boolean }>;
                const active = rows.filter((row) => row.active !== false);
                setMethods(active);
                if (active.length === 0) setMethodsError('No hay métodos de pago activos configurados.');
            })
            .catch((requestError: unknown) => {
                if (!cancelled) {
                    setMethods([]);
                    setSingleMethodId(null);
                    setMethodsError(apiErrorMessage(requestError, 'No se pudieron cargar los métodos de pago.'));
                }
            })
            .finally(() => {
                if (!cancelled) setMethodsLoading(false);
            });
        return () => { cancelled = true; };
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen || !completesReadyTable || !order?.branchId) {
            setSettlementWarehouses([]);
            setSettlementWarehouseId(null);
            setSettlementWarehouseLoading(false);
            setSettlementWarehouseError('');
            return;
        }

        let cancelled = false;
        setSettlementWarehouseLoading(true);
        setSettlementWarehouseError('');
        void warehousesAPI.getAll({ branchId: order.branchId, type: 'BRANCH' })
            .then((response) => {
                if (cancelled) return;
                const warehouses = ((response.data?.data || []) as Warehouse[]).filter(
                    (warehouse) => warehouse.type === 'BRANCH' && warehouse.branchId === order.branchId,
                );
                setSettlementWarehouses(warehouses);
                setSettlementWarehouseId(warehouses.length === 1 ? warehouses[0].id : null);
                if (warehouses.length === 0) {
                    setSettlementWarehouseError(
                        'La sucursal no tiene una bodega operativa. El pago no puede cerrar la mesa sin registrar el consumo.',
                    );
                }
            })
            .catch((loadError: unknown) => {
                if (cancelled) return;
                setSettlementWarehouses([]);
                setSettlementWarehouseId(null);
                setSettlementWarehouseError(apiErrorMessage(
                    loadError,
                    'No se pudieron consultar las bodegas para cerrar la mesa.',
                ));
            })
            .finally(() => {
                if (!cancelled) setSettlementWarehouseLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [completesReadyTable, isOpen, order?.branchId]);

    useEffect(() => {
        if (!isOpen) return;
        setMode(initialMode);
        setBalance(orderTotal);
        setBalanceError('');
        setError('');
        setNotice('');
        setQueuedPayment(false);
        setSingleReference('');
        setSingleReceived(formatMoneyInput(orderTotal.toFixed(2)));
        setMixedLegs([]);
        setMixedSucceeded([]);
        setMixedAttempted(false);
        setSplitStrategy('by-items');
        setSplitLegs([]);
        setItemUnitOwners({});
        setSplitSucceeded([]);
        setSplitAttempted(false);
        setPreviewLoading(false);
        singleKeyRef.current = newIdempotencyKey();
        mixedKeysRef.current = {};
        splitKeysRef.current = {};
        lastItemPreviewSignatureRef.current = '';
    }, [initialMode, isOpen, orderTotal]);

    useEffect(() => {
        if (!isOpen || !orderId) return;
        let cancelled = false;
        setBalanceLoading(true);
        paymentsAPI.getSummary(orderId)
            .then((response) => {
                if (cancelled) return;
                const remaining = Number(response.data?.data?.remaining);
                if (!Number.isFinite(remaining) || remaining < 0) throw new Error('Saldo pendiente inválido.');
                const normalized = centsToMoney(moneyToCents(remaining));
                setBalance(normalized);
                setSingleReceived(formatMoneyInput(normalized.toFixed(2)));
                if (normalized <= 0) setBalanceError('La orden ya no tiene saldo pendiente.');
            })
            .catch((requestError: unknown) => {
                if (!cancelled) setBalanceError(apiErrorMessage(requestError, 'No se pudo validar el saldo pendiente.'));
            })
            .finally(() => {
                if (!cancelled) setBalanceLoading(false);
            });
        return () => { cancelled = true; };
    }, [isOpen, orderId]);

    useEffect(() => {
        if (!isOpen || methods.length === 0) return;
        const firstUsable = usableMethodOptions[0]?.value ?? null;
        setSingleMethodId((current) => current && usableMethodOptions.some((option) => option.value === current)
            ? current
            : firstUsable);
    }, [isOpen, methods.length, usableMethodOptions]);

    const buildMixedLegs = useCallback((count = 2) => {
        const selected = mixedMethodOptions.slice(0, count);
        const amounts = splitTotalEvenly(balance, count);
        return selected.map((option, index) => createLeg(option.value, amounts[index]));
    }, [balance, mixedMethodOptions]);

    const buildSplitLegs = useCallback((count: number, previous: SplitLeg[] = []) => {
        const amounts = splitTotalEvenly(balance, count);
        const defaultMethodId = usableMethodOptions[0]?.value ?? null;
        return Array.from({ length: count }, (_, index) => {
            const existing = previous[index];
            const amount = amounts[index] ?? 0;
            return {
                ...createLeg(existing?.paymentMethodId ?? defaultMethodId, amount),
                id: existing?.id ?? newIdempotencyKey(),
                payerName: existing?.payerName ?? `Comensal ${index + 1}`,
                reference: existing?.reference ?? '',
                received: existing?.received && parseMoneyInput(existing.received) !== parseMoneyInput(existing.amount)
                    ? existing.received
                    : formatMoneyInput(amount.toFixed(2)),
            };
        });
    }, [balance, usableMethodOptions]);

    useEffect(() => {
        if (mode === 'mixed' && mixedLegs.length === 0 && mixedMethodOptions.length >= 2) {
            setMixedLegs(buildMixedLegs(2));
        }
        if (mode === 'split' && splitLegs.length === 0 && usableMethodOptions.length > 0) {
            setSplitLegs(buildSplitLegs(2));
            if (splitStrategy === 'by-items') {
                lastItemPreviewSignatureRef.current = '';
                setItemUnitOwners(Object.fromEntries(
                    orderItems.map((item) => [item.id, Array<number | null>(item.quantity).fill(null)]),
                ));
            }
        }
    }, [buildMixedLegs, buildSplitLegs, mixedLegs.length, mixedMethodOptions.length, mode, orderItems, splitLegs.length, splitStrategy, usableMethodOptions.length]);

    const singleMethod = singleMethodId ? methodById.get(singleMethodId) : undefined;
    const singleIsCash = isCash(singleMethodId);
    const singleTendered = parseField(singleReceived);
    const singleChange = singleIsCash && singleTendered !== null
        ? Math.max(0, singleTendered - balance)
        : 0;

    const mixedAmounts = mixedLegs.map((leg) => parseField(leg.amount));
    const mixedAllocation = summarizePaymentAllocation(balance, mixedAmounts);
    const mixedMethodIds = mixedLegs.map((leg) => leg.paymentMethodId).filter((id): id is number => id !== null);
    const mixedMethodsUnique = new Set(mixedMethodIds).size === mixedMethodIds.length;
    const mixedCashValid = mixedLegs.every((leg) => {
        if (!isCash(leg.paymentMethodId)) return true;
        const amount = parseField(leg.amount);
        const received = parseField(leg.received);
        return hasUsableCashShift && amount !== null && received !== null && moneyToCents(received) >= moneyToCents(amount);
    });
    const mixedValid = mixedLegs.length >= 2
        && mixedLegs.length <= 3
        && mixedLegs.every((leg) => leg.paymentMethodId !== null && (parseField(leg.amount) ?? 0) > 0)
        && mixedMethodsUnique
        && mixedCashValid
        && mixedAllocation.exact;

    const splitPayerNamesUnique = useMemo(
        () => hasUniqueNormalizedPayerNames(splitLegs.map((leg) => leg.payerName)),
        [splitLegs],
    );

    const initializeEmptyAssignments = useCallback(() => {
        lastItemPreviewSignatureRef.current = '';
        setItemUnitOwners(Object.fromEntries(
            orderItems.map((item) => [item.id, Array<number | null>(item.quantity).fill(null)]),
        ));
    }, [orderItems]);

    const unitAssignmentsComplete = useMemo(() => (
        orderItems.length > 0
        && orderItems.every((item) => {
            const owners = itemUnitOwners[item.id] || [];
            return owners.length === item.quantity
                && owners.every((owner) => owner !== null && owner >= 0 && owner < splitLegs.length);
        })
        && splitLegs.every((_, payerIndex) => orderItems.some((item) => itemUnitOwners[item.id]?.includes(payerIndex)))
    ), [itemUnitOwners, orderItems, splitLegs]);
    const itemAssignmentsComplete = splitStrategy !== 'by-items'
        || (unitAssignmentsComplete && splitPayerNamesUnique);

    const assignItemUnit = useCallback((itemId: number, unitIndex: number, payerIndex: number) => {
        lastItemPreviewSignatureRef.current = '';
        setItemUnitOwners((current) => {
            const item = orderItems.find((candidate) => candidate.id === itemId);
            if (!item) return current;
            const nextOwners = [...(current[itemId] ?? Array<number | null>(item.quantity).fill(null))];
            nextOwners[unitIndex] = payerIndex;
            return { ...current, [itemId]: nextOwners };
        });
    }, [orderItems]);

    const rebuildSplitPreview = useCallback(async (): Promise<SplitLeg[] | null> => {
        if (!orderId || splitLegs.length === 0) return splitLegs;
        if (splitStrategy === 'by-items' && !itemAssignmentsComplete) return null;
        const sequence = ++previewSequenceRef.current;
        const stale = () => sequence !== previewSequenceRef.current;
        setPreviewLoading(true);
        setError('');
        try {
            let amounts: number[];
            if (splitStrategy === 'evenly') {
                const response = await splitBillAPI.splitEvenly(orderId, splitLegs.length);
                amounts = response.data.data.splits.map((split: { amount: number }) => Number(split.amount));
            } else if (splitStrategy === 'by-items') {
                const assignments = splitLegs.map((leg, payerIndex) => ({
                    personName: normalizePayerName(leg.payerName),
                    items: orderItems
                        .map((item) => ({
                            orderItemId: item.id,
                            quantity: (itemUnitOwners[item.id] || []).filter((owner) => owner === payerIndex).length,
                        }))
                        .filter((item) => item.quantity > 0),
                }));
                const response = await splitBillAPI.splitByItems(orderId, assignments);
                const amountByName = new Map<string, number>(
                    response.data.data.splits.map((split: { personName: string; total: number }) => [split.personName, Number(split.total)]),
                );
                amounts = splitLegs.map((leg) => amountByName.get(normalizePayerName(leg.payerName)) ?? 0);
            } else {
                const response = await splitBillAPI.splitByAmount(orderId, splitLegs.map((leg) => ({
                    personName: leg.payerName,
                    amount: parseField(leg.amount) ?? 0,
                })));
                if (response.data.data.valid === false) throw new Error(response.data.data.error);
                amounts = response.data.data.splits.map((split: { amount: number }) => Number(split.amount));
            }
            const previewAllocation = summarizePaymentAllocation(balance, amounts);
            if (amounts.length !== splitLegs.length || !previewAllocation.exact) {
                throw new Error('La vista previa no reconcilia exactamente con el saldo pendiente.');
            }
            if (stale()) return null;
            const next = splitLegs.map((leg, index) => {
                const amount = amounts[index] ?? 0;
                const preserveTendered = isCash(leg.paymentMethodId)
                    && parseField(leg.received) !== parseField(leg.amount);
                return {
                    ...leg,
                    amount: formatMoneyInput(amount.toFixed(2)),
                    received: preserveTendered ? leg.received : formatMoneyInput(amount.toFixed(2)),
                };
            });
            setSplitLegs(next);
            return next;
        } catch (requestError: unknown) {
            if (!stale()) {
                if (splitStrategy === 'by-items') lastItemPreviewSignatureRef.current = '';
                setError(apiErrorMessage(requestError, 'No se pudo recalcular la división.'));
            }
            return null;
        } finally {
            if (!stale()) setPreviewLoading(false);
        }
    }, [balance, isCash, itemAssignmentsComplete, itemUnitOwners, orderId, orderItems, splitLegs, splitStrategy]);

    const splitItemAssignmentSignature = useMemo(() => JSON.stringify({
        payers: splitLegs.map((leg) => ({ id: leg.id, name: leg.payerName.trim() })),
        items: orderItems.map((item) => ({ id: item.id, owners: itemUnitOwners[item.id] || [] })),
    }), [itemUnitOwners, orderItems, splitLegs]);

    const itemPreviewReady = splitStrategy !== 'by-items'
        || (itemAssignmentsComplete
            && !previewLoading
            && lastItemPreviewSignatureRef.current === splitItemAssignmentSignature);

    useEffect(() => {
        if (!isOpen
            || mode !== 'split'
            || splitStrategy !== 'by-items'
            || splitAttempted
            || !itemAssignmentsComplete
            || !orderId
            || lastItemPreviewSignatureRef.current === splitItemAssignmentSignature) return;

        lastItemPreviewSignatureRef.current = splitItemAssignmentSignature;
        setPreviewLoading(true);
        const timeout = window.setTimeout(() => { void rebuildSplitPreview(); }, 180);
        return () => {
            window.clearTimeout(timeout);
            setPreviewLoading(false);
        };
    }, [isOpen, itemAssignmentsComplete, mode, orderId, rebuildSplitPreview, splitAttempted, splitItemAssignmentSignature, splitStrategy]);

    const splitAllocation = summarizePaymentAllocation(balance, splitLegs.map((leg) => parseField(leg.amount)));
    const splitLegsArePayable = useCallback((legs: SplitLeg[]) => {
        const allocation = summarizePaymentAllocation(balance, legs.map((leg) => parseField(leg.amount)));
        return legs.length >= 2
            && legs.every((leg) => {
                const amount = parseField(leg.amount);
                const received = parseField(leg.received);
                const cashValid = !isCash(leg.paymentMethodId)
                    || (hasUsableCashShift && amount !== null && received !== null && moneyToCents(received) >= moneyToCents(amount));
                return Boolean(leg.payerName.trim())
                    && leg.paymentMethodId !== null
                    && amount !== null
                    && amount > 0
                    && cashValid;
            })
            && allocation.exact;
    }, [balance, hasUsableCashShift, isCash]);
    const splitValid = splitPayerNamesUnique && itemAssignmentsComplete && itemPreviewReady && splitLegsArePayable(splitLegs);

    const validateSettlementPrecondition = () => {
        if (!completesReadyTable) return true;
        if (settlementWarehouseLoading) {
            setError('Espera a que termine la consulta de bodegas antes de confirmar el pago.');
            return false;
        }
        if (!settlementWarehouseId) {
            setError(
                settlementWarehouseError
                || 'Selecciona la bodega que registrará el consumo antes de confirmar el pago.',
            );
            return false;
        }
        return true;
    };

    const submitPayment = async (
        leg: PaymentLeg,
        idempotencyKey: string,
        payerName?: string,
        settleReadyTable = false,
    ): Promise<'confirmed' | 'queued'> => {
        if (!orderId || !leg.paymentMethodId) throw new Error('La orden o el método de pago no están disponibles.');
        const amount = parseField(leg.amount);
        if (amount === null || amount <= 0) throw new Error('El monto del pago es inválido.');
        if (settleReadyTable && completesReadyTable && !settlementWarehouseId) {
            throw new Error(
                settlementWarehouseError
                || 'Selecciona la bodega que registrará el consumo antes de confirmar el último pago.',
            );
        }
        const response = await paymentsAPI.create({
            orderId,
            paymentMethodId: leg.paymentMethodId,
            amount,
            reference: leg.reference.trim() || undefined,
            payerName,
            ...(settleReadyTable && completesReadyTable && settlementWarehouseId
                ? { warehouseId: settlementWarehouseId }
                : {}),
        }, {
            operationType: 'CREATE_PAYMENT',
            entityTempId: `payment-${orderId}-${leg.id}`,
        }, idempotencyKey);
        return (response.data as ApiEnvelope)._offline ? 'queued' : 'confirmed';
    };

    const handleSinglePayment = async () => {
        if (!singleMethodId || !orderId) return setError('Selecciona un método de pago válido.');
        if (singleIsCash && !hasUsableCashShift) return setError('Abre un turno de caja vigente para cobrar en efectivo.');
        if (singleIsCash && (singleTendered === null || moneyToCents(singleTendered) < totalCents)) {
            return setError('El efectivo recibido es menor que el saldo.');
        }
        if (!validateSettlementPrecondition()) return;
        setLoading(true);
        setError('');
        setNotice('');
        try {
            const result = await submitPayment({
                ...createLeg(singleMethodId, balance),
                reference: singleReference,
            }, singleKeyRef.current, undefined, true);
            if (result === 'queued') {
                setQueuedPayment(true);
                setNotice('Sin conexión: el pago quedó en cola. La orden permanecerá abierta hasta su confirmación.');
                return;
            }
            onPaymentSuccess({ offlineQueued: false });
            onClose();
        } catch (requestError: unknown) {
            setError(apiErrorMessage(requestError, 'No se pudo procesar el pago.'));
        } finally {
            setLoading(false);
        }
    };

    const handleMixedPayment = async () => {
        if (!mixedValid) return setError('Distribuye el saldo exacto entre 2 o 3 métodos distintos.');
        if (!validateSettlementPrecondition()) return;
        setLoading(true);
        setError('');
        setNotice('');
        setMixedAttempted(true);
        const succeeded = [...mixedSucceeded];
        try {
            const pendingLegs = mixedLegs.filter((leg) => !succeeded.includes(leg.id));
            for (const [index, leg] of pendingLegs.entries()) {
                const result = await submitPayment(
                    leg,
                    mixedKeysRef.current[leg.id] ||= newIdempotencyKey(),
                    undefined,
                    index === pendingLegs.length - 1,
                );
                if (result === 'queued') {
                    setQueuedPayment(true);
                    setMixedSucceeded(succeeded);
                    setNotice('Un tramo del pago mixto quedó en cola sin conexión. No se procesarán más tramos hasta confirmar la sincronización.');
                    return;
                }
                succeeded.push(leg.id);
                setMixedSucceeded([...succeeded]);
            }
            onPaymentSuccess({ offlineQueued: false });
            onClose();
        } catch (requestError: unknown) {
            setMixedSucceeded(succeeded);
            setError(`${apiErrorMessage(requestError, 'Falló un tramo del pago mixto.')} Los tramos confirmados no se repetirán; vuelve a confirmar para reintentar solo los pendientes.`);
        } finally {
            setLoading(false);
        }
    };

    const handleSplitPayment = async () => {
        if (!itemAssignmentsComplete) return setError('Asigna todas las unidades y al menos una a cada comensal.');
        if (!validateSettlementPrecondition()) return;
        const effective = splitAttempted ? splitLegs : await rebuildSplitPreview();
        if (!effective) return;
        if (!splitLegsArePayable(effective)) return setError('Revisa métodos, importes y efectivo recibido; la suma debe coincidir exactamente con el saldo.');
        setLoading(true);
        setError('');
        setNotice('');
        setSplitAttempted(true);
        const succeeded = [...splitSucceeded];
        try {
            const pendingLegs = effective.filter((leg) => !succeeded.includes(leg.id));
            for (const [index, leg] of pendingLegs.entries()) {
                const result = await submitPayment(
                    leg,
                    splitKeysRef.current[leg.id] ||= newIdempotencyKey(),
                    normalizePayerName(leg.payerName),
                    index === pendingLegs.length - 1,
                );
                if (result === 'queued') {
                    setQueuedPayment(true);
                    setSplitSucceeded(succeeded);
                    setNotice(`El pago de ${leg.payerName} quedó en cola sin conexión. La cuenta sigue abierta.`);
                    return;
                }
                succeeded.push(leg.id);
                setSplitSucceeded([...succeeded]);
            }
            onPaymentSuccess({ offlineQueued: false });
            onClose();
        } catch (requestError: unknown) {
            setSplitSucceeded(succeeded);
            setError(`${apiErrorMessage(requestError, 'Falló un pago de la cuenta dividida.')} Los pagos confirmados no se repetirán.`);
        } finally {
            setLoading(false);
        }
    };

    const updateMixedLeg = (id: string, patch: Partial<PaymentLeg>) => {
        setMixedLegs((current) => current.map((leg) => leg.id === id ? { ...leg, ...patch } : leg));
    };
    const updateSplitLeg = (id: string, patch: Partial<SplitLeg>) => {
        if (patch.payerName !== undefined) lastItemPreviewSignatureRef.current = '';
        setSplitLegs((current) => current.map((leg) => leg.id === id ? { ...leg, ...patch } : leg));
    };

    const changeMode = (nextMode: PaymentMode) => {
        if (mixedAttempted || splitAttempted || queuedPayment) return;
        setMode(nextMode);
        setError('');
        setNotice('');
        requestAnimationFrame(() => scrollAreaRef.current?.scrollTo({ top: 0 }));
    };

    if (!isOpen) return null;

    const busy = loading || previewLoading || balanceLoading || settlementWarehouseLoading;
    const settlementUnavailable = completesReadyTable
        && (!settlementWarehouseId || Boolean(settlementWarehouseError));
    const modeHelp = mode === 'single'
        ? { step: 'Cobro directo', title: 'Un solo método', detail: 'Registra el saldo completo y confirma el cambio antes de cobrar.' }
        : mode === 'mixed'
            ? { step: 'Cobro combinado', title: 'Dos o tres métodos', detail: 'Distribuye una misma deuda entre efectivo, tarjeta o transferencia.' }
            : { step: 'Cobro por persona', title: 'Cuenta entre comensales', detail: 'Asigna el consumo en partes iguales, por unidades o por monto.' };
    const renderMethodSelect = (
        inputId: string,
        value: number | null,
        options: MethodOption[],
        onChange: (value: number | null) => void,
        disabled = false,
    ) => (
        <CustomSelect<MethodOption>
            inputId={inputId}
            variant="modal"
            value={options.find((option) => option.value === value) ?? null}
            options={options}
            onChange={(option: SingleValue<MethodOption>) => onChange(option?.value ?? null)}
            isDisabled={disabled}
            isSearchable={options.length > 6}
            placeholder="Selecciona método"
            noOptionsMessage={() => 'Sin métodos disponibles'}
        />
    );

    const renderMoneyInput = (
        id: string,
        value: string,
        onChange: (value: string) => void,
        disabled = false,
        label = 'Monto',
    ) => (
        <label className="payment-field" htmlFor={id}>
            <span>{label}</span>
            <div className="money-input-wrap">
                <b>{currencySymbol}</b>
                <input
                    id={id}
                    type="text"
                    inputMode="decimal"
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    onBlur={() => onChange(formatField(value))}
                    disabled={disabled}
                    autoComplete="off"
                />
            </div>
        </label>
    );

    return createPortal(
        <div
            ref={dialogRef}
            className="payment-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            onClick={busy ? undefined : (event) => {
                if (event.target === event.currentTarget) close();
            }}
        >
            <section
                className={`payment-dialog payment-dialog-${mode}`}
                onClick={(event) => event.stopPropagation()}
            >
                <header className="payment-dialog-header">
                    <div className="payment-dialog-heading">
                        <div>
                            <span className="payment-eyebrow">Cobro de orden</span>
                            <h2 id={titleId}>Procesar pago</h2>
                        </div>
                    </div>
                    <button type="button" className="payment-close" onClick={close} disabled={busy} aria-label="Cerrar pago">
                        <X size={22} />
                    </button>
                </header>

                <div className="payment-workspace">
                    <aside className="payment-context" aria-label="Resumen y tipo de cobro">
                        <section className="payment-total-card" aria-label="Saldo pendiente">
                            <span>Saldo pendiente</span>
                            <strong>{displayMoney(balance)}</strong>
                            {order?.invoiceNumber && <small>Factura {order.invoiceNumber}</small>}
                        </section>

                        <nav className="payment-mode-tabs" role="tablist" aria-label="Tipo de pago">
                            <button type="button" role="tab" aria-selected={mode === 'single'} className={mode === 'single' ? 'active' : ''} onClick={() => changeMode('single')} disabled={mixedAttempted || splitAttempted || queuedPayment}>
                                <CreditCard size={18} /><span><strong>Pago único</strong><small>Una forma de pago</small></span>
                            </button>
                            <button type="button" role="tab" aria-selected={mode === 'mixed'} className={mode === 'mixed' ? 'active' : ''} onClick={() => changeMode('mixed')} disabled={mixedAttempted || splitAttempted || queuedPayment}>
                                <Layers3 size={18} /><span><strong>Pago mixto</strong><small>Varios métodos</small></span>
                            </button>
                            <button type="button" role="tab" aria-selected={mode === 'split'} className={mode === 'split' ? 'active' : ''} onClick={() => changeMode('split')} disabled={mixedAttempted || splitAttempted || queuedPayment}>
                                <Users size={18} /><span><strong>Dividir cuenta</strong><small>Varios comensales</small></span>
                            </button>
                        </nav>

                        <div className="payment-context-help">
                            <span>{modeHelp.step}</span>
                            <strong>{modeHelp.title}</strong>
                            <p>{modeHelp.detail}</p>
                        </div>
                    </aside>

                    <div ref={scrollAreaRef} className="payment-scroll-area">

                    {methodsLoading && <div className="payment-state">Cargando métodos de pago…</div>}
                    {methodsError && <div className="payment-alert error" role="alert">{methodsError}</div>}
                    {completesReadyTable && (
                        <section className="payment-panel">
                            <div className="payment-section-heading">
                                <div>
                                    <h3>Cierre operativo de la mesa</h3>
                                    <p>El último pago entregará la orden, registrará el consumo y liberará la mesa en una sola operación.</p>
                                </div>
                            </div>
                            <label className="payment-field">
                                <span>Bodega de consumo</span>
                                <CustomSelect<WarehouseOption>
                                    inputId="settlement-warehouse"
                                    variant="modal"
                                    value={settlementWarehouseOptions.find(
                                        (option) => option.value === settlementWarehouseId,
                                    ) ?? null}
                                    options={settlementWarehouseOptions}
                                    onChange={(option: SingleValue<WarehouseOption>) =>
                                        setSettlementWarehouseId(option?.value ?? null)}
                                    isDisabled={busy || settlementWarehouseOptions.length <= 1}
                                    isSearchable={settlementWarehouseOptions.length > 6}
                                    placeholder={settlementWarehouseLoading ? 'Consultando bodegas…' : 'Selecciona bodega'}
                                    noOptionsMessage={() => 'Sin bodegas operativas'}
                                />
                            </label>
                            {settlementWarehouseError && (
                                <div className="payment-alert error" role="alert">{settlementWarehouseError}</div>
                            )}
                        </section>
                    )}

                    {!methodsLoading && !methodsError && mode === 'single' && (
                        <div className="payment-panel single-panel">
                            <div className="payment-section-heading">
                                <div><h3>Un método</h3><p>Registra el saldo completo en una sola forma de pago.</p></div>
                                {singleMethod && (() => { const Icon = methodIcon(singleMethod.type); return <Icon size={26} />; })()}
                            </div>
                            <label className="payment-field">
                                <span>Método de pago</span>
                                {renderMethodSelect('single-payment-method', singleMethodId, usableMethodOptions, setSingleMethodId, busy)}
                            </label>
                            {!singleIsCash && (
                                <label className="payment-field" htmlFor="single-reference">
                                    <span>Referencia del método <em>opcional</em></span>
                                    <input id="single-reference" value={singleReference} onChange={(event) => setSingleReference(event.target.value)} maxLength={191} placeholder="Autorización, voucher o transferencia" />
                                </label>
                            )}
                            {singleIsCash && (
                                <>
                                    {renderMoneyInput('single-received', singleReceived, setSingleReceived, busy, 'Efectivo recibido')}
                                    <div className={`payment-change ${singleTendered !== null && singleTendered >= balance ? 'positive' : ''}`}>
                                        <span>Cambio</span><strong>{displayMoney(singleChange)}</strong>
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {!methodsLoading && !methodsError && mode === 'mixed' && (
                        <div className="payment-panel">
                            <div className="payment-section-heading payment-section-heading-with-actions">
                                <div><h3>Pago mixto</h3><p>Una deuda, distribuida entre 2 o 3 métodos distintos.</p></div>
                                <div className="payment-heading-tools">
                                    {!mixedAttempted && mixedLegs.length < 3 && mixedMethodOptions.length > mixedLegs.length && <button type="button" className="payment-add-leg" onClick={() => {
                                        const nextMethod = mixedMethodOptions.find((option) => !mixedMethodIds.includes(option.value));
                                        if (nextMethod) setMixedLegs((current) => [...current, createLeg(nextMethod.value, 0)]);
                                    }}><Plus size={17} /> Agregar método</button>}
                                    <AllocationStatus summary={mixedAllocation} currencySymbol={currencySymbol} valid={mixedValid} compact />
                                </div>
                            </div>
                            {mixedMethodOptions.length < 2 ? (
                                <div className="payment-alert error">Configura al menos dos métodos entre efectivo, tarjeta y transferencia.</div>
                            ) : (
                                <>
                                    <div className="payment-leg-list">
                                        {mixedLegs.map((leg, index) => {
                                            const cash = isCash(leg.paymentMethodId);
                                            const amount = parseField(leg.amount) ?? 0;
                                            const received = parseField(leg.received) ?? 0;
                                            const options = mixedMethodOptions.filter((option) => option.value === leg.paymentMethodId || !mixedMethodIds.includes(option.value));
                                            return (
                                                <article className={`payment-leg ${mixedSucceeded.includes(leg.id) ? 'completed' : ''}`} key={leg.id}>
                                                    <div className="payment-leg-title"><span>Tramo {index + 1}</span>{mixedSucceeded.includes(leg.id) && <b>Confirmado</b>}</div>
                                                    <div className="payment-leg-grid">
                                                        <label className="payment-field"><span>Método</span>{renderMethodSelect(`mixed-method-${leg.id}`, leg.paymentMethodId, options, (value) => updateMixedLeg(leg.id, { paymentMethodId: value, reference: '', received: leg.amount }), mixedAttempted)}</label>
                                                        {renderMoneyInput(`mixed-amount-${leg.id}`, leg.amount, (value) => updateMixedLeg(leg.id, { amount: value, received: cash && parseField(leg.received) === parseField(leg.amount) ? value : leg.received }), mixedAttempted)}
                                                        {cash ? renderMoneyInput(`mixed-received-${leg.id}`, leg.received, (value) => updateMixedLeg(leg.id, { received: value }), mixedAttempted, 'Efectivo recibido') : (
                                                            <label className="payment-field" htmlFor={`mixed-reference-${leg.id}`}><span>Referencia <em>opcional</em></span><input id={`mixed-reference-${leg.id}`} value={leg.reference} onChange={(event) => updateMixedLeg(leg.id, { reference: event.target.value })} disabled={mixedAttempted} maxLength={191} placeholder="Voucher o transferencia" /></label>
                                                        )}
                                                    </div>
                                                    {cash && <div className="leg-change">Cambio de este tramo: <b>{displayMoney(Math.max(0, received - amount))}</b></div>}
                                                    {mixedLegs.length > 2 && !mixedAttempted && <button type="button" className="leg-remove" onClick={() => setMixedLegs((current) => current.filter((item) => item.id !== leg.id))}><Trash2 size={16} /> Eliminar tramo</button>}
                                                </article>
                                            );
                                        })}
                                    </div>
                                    {!mixedMethodsUnique && <div className="payment-alert error">Cada tramo debe usar un método distinto.</div>}
                                </>
                            )}
                        </div>
                    )}

                    {!methodsLoading && !methodsError && mode === 'split' && (
                        <div className="payment-panel split-panel">
                            <div className="payment-section-heading payment-section-heading-with-actions">
                                <div>
                                    <h3>{splitStrategy === 'by-items' ? '¿Quién paga cada plato?' : 'Dividir cuenta'}</h3>
                                    <p>{splitStrategy === 'by-items' ? 'Asigna cada plato o unidad y revisa el total exacto por comensal.' : 'Cobra a cada comensal por partes iguales o por monto.'}</p>
                                </div>
                                <div className="payment-heading-tools">
                                    {splitStrategy !== 'by-items' && <button type="button" className="payment-recalculate" disabled={splitAttempted || previewLoading || !itemAssignmentsComplete} onClick={() => void rebuildSplitPreview()}>{previewLoading ? 'Calculando…' : 'Recalcular importes'}</button>}
                                    {(splitStrategy !== 'by-items' || itemPreviewReady) && <AllocationStatus summary={splitAllocation} currencySymbol={currencySymbol} valid={splitValid} compact />}
                                </div>
                            </div>
                            <div className="split-strategies" role="group" aria-label="Forma de dividir">
                                {([
                                    ['evenly', 'Equitativa'],
                                    ['by-items', 'Por unidades'],
                                    ['by-amount', 'Por monto'],
                                ] as Array<[SplitStrategy, string]>).map(([value, label]) => (
                                    <button type="button" key={value} className={splitStrategy === value ? 'active' : ''} disabled={splitAttempted} onClick={() => {
                                        setSplitStrategy(value);
                                        if (value === 'by-items') initializeEmptyAssignments();
                                    }}>{label}</button>
                                ))}
                            </div>
                            <div className="split-count-row">
                                <span>Comensales</span>
                                {[2, 3, 4].map((count) => <button type="button" key={count} className={splitLegs.length === count ? 'active' : ''} disabled={splitAttempted} onClick={() => {
                                    setSplitLegs(buildSplitLegs(count, splitLegs));
                                    if (splitStrategy === 'by-items') initializeEmptyAssignments();
                                }}>{count}</button>)}
                                <button type="button" className="icon" disabled={splitAttempted} onClick={() => {
                                    const count = splitLegs.length + 1;
                                    setSplitLegs(buildSplitLegs(count, splitLegs));
                                    if (splitStrategy === 'by-items') initializeEmptyAssignments();
                                }} aria-label="Agregar comensal"><Plus size={17} /></button>
                            </div>
                            {splitStrategy !== 'by-items' && <div className="payment-leg-list">
                                {splitLegs.map((leg, index) => {
                                    const cash = isCash(leg.paymentMethodId);
                                    const amount = parseField(leg.amount) ?? 0;
                                    const received = parseField(leg.received) ?? 0;
                                    return (
                                        <article className={`payment-leg ${splitSucceeded.includes(leg.id) ? 'completed' : ''}`} key={leg.id}>
                                            <div className="payment-leg-title"><span>{leg.payerName || `Comensal ${index + 1}`}</span>{splitSucceeded.includes(leg.id) && <b>Confirmado</b>}</div>
                                            <div className="payment-leg-grid split-leg-grid">
                                                <label className="payment-field" htmlFor={`payer-${leg.id}`}><span>Comensal</span><input id={`payer-${leg.id}`} value={leg.payerName} onChange={(event) => updateSplitLeg(leg.id, { payerName: event.target.value })} disabled={splitAttempted} maxLength={191} /></label>
                                                <label className="payment-field"><span>Método</span>{renderMethodSelect(`split-method-${leg.id}`, leg.paymentMethodId, usableMethodOptions, (value) => updateSplitLeg(leg.id, { paymentMethodId: value, reference: '', received: leg.amount }), splitAttempted)}</label>
                                                {renderMoneyInput(`split-amount-${leg.id}`, leg.amount, (value) => updateSplitLeg(leg.id, { amount: value, received: cash && parseField(leg.received) === parseField(leg.amount) ? value : leg.received }), splitAttempted || splitStrategy !== 'by-amount')}
                                                {cash ? renderMoneyInput(`split-received-${leg.id}`, leg.received, (value) => updateSplitLeg(leg.id, { received: value }), splitAttempted, 'Efectivo recibido') : <label className="payment-field" htmlFor={`split-reference-${leg.id}`}><span>Referencia <em>opcional</em></span><input id={`split-reference-${leg.id}`} value={leg.reference} onChange={(event) => updateSplitLeg(leg.id, { reference: event.target.value })} disabled={splitAttempted} maxLength={191} /></label>}
                                            </div>
                                            {cash && <div className="leg-change">Cambio: <b>{displayMoney(Math.max(0, received - amount))}</b></div>}
                                            {splitLegs.length > 2 && !splitAttempted && <button type="button" className="leg-remove" onClick={() => {
                                                const next = splitLegs.filter((item) => item.id !== leg.id);
                                                setSplitLegs(buildSplitLegs(next.length, next));
                                            }}><Trash2 size={16} /> Eliminar</button>}
                                        </article>
                                    );
                                })}
                            </div>}

                            {splitStrategy === 'by-items' && (
                                <section className="unit-allocation">
                                    {orderItems.length === 0 ? <div className="payment-alert error">La orden no tiene unidades disponibles para dividir.</div> : orderItems.map((item) => {
                                        const owners = itemUnitOwners[item.id] ?? Array<number | null>(item.quantity).fill(null);
                                        const assigned = owners.filter((owner) => owner !== null).length;
                                        const pending = item.quantity - assigned;
                                        return (
                                            <article className="unit-row" key={item.id}>
                                                <header><div><strong>{item.menuItem?.name || 'Producto'}</strong><span>{item.quantity} unidades · {displayMoney(Number(item.subtotal))}</span></div><b className={pending === 0 ? 'complete' : 'pending'}>{assigned} de {item.quantity} asignadas</b></header>
                                                <div className="unit-assignment-list">
                                                    {Array.from({ length: item.quantity }, (_, unitIndex) => (
                                                        <div className="unit-assignment-row" key={`${item.id}-${unitIndex}`}>
                                                            <span>{item.quantity === 1 ? 'Plato' : `Unidad ${unitIndex + 1}`}</span>
                                                            <div className="unit-payer-options" role="radiogroup" aria-label={`Quién paga ${item.menuItem?.name || 'producto'}, unidad ${unitIndex + 1}`}>
                                                                {splitLegs.map((leg, payerIndex) => (
                                                                    <button
                                                                        type="button"
                                                                        key={leg.id}
                                                                        className={owners[unitIndex] === payerIndex ? 'selected' : ''}
                                                                        aria-pressed={owners[unitIndex] === payerIndex}
                                                                        disabled={splitAttempted}
                                                                        onClick={() => assignItemUnit(item.id, unitIndex, payerIndex)}
                                                                    >{leg.payerName || `Comensal ${payerIndex + 1}`}</button>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </article>
                                        );
                                    })}
                                    <div className="split-payer-totals" aria-label="Totales exactos por comensal">
                                        {splitLegs.map((leg, index) => {
                                            const cash = isCash(leg.paymentMethodId);
                                            const amount = parseField(leg.amount) ?? 0;
                                            const received = parseField(leg.received) ?? 0;
                                            return (
                                                <article className={`split-payer-total ${splitSucceeded.includes(leg.id) ? 'completed' : ''}`} key={leg.id}>
                                                    <header>
                                                        <label className="payment-field" htmlFor={`payer-${leg.id}`}>
                                                            <span>Comensal {index + 1}</span>
                                                            <input id={`payer-${leg.id}`} value={leg.payerName} onChange={(event) => updateSplitLeg(leg.id, { payerName: event.target.value })} disabled={splitAttempted} maxLength={191} />
                                                        </label>
                                                        <div className="split-payer-amount">
                                                            <span>Total exacto</span>
                                                            <strong>{itemPreviewReady ? displayMoney(amount) : 'Pendiente'}</strong>
                                                        </div>
                                                    </header>
                                                    <div className="split-payer-payment">
                                                        <label className="payment-field"><span>Método</span>{renderMethodSelect(`split-method-${leg.id}`, leg.paymentMethodId, usableMethodOptions, (value) => updateSplitLeg(leg.id, { paymentMethodId: value, reference: '', received: leg.amount }), splitAttempted)}</label>
                                                        {cash
                                                            ? renderMoneyInput(`split-received-${leg.id}`, leg.received, (value) => updateSplitLeg(leg.id, { received: value }), splitAttempted, 'Efectivo recibido')
                                                            : <label className="payment-field" htmlFor={`split-reference-${leg.id}`}><span>Referencia <em>opcional</em></span><input id={`split-reference-${leg.id}`} value={leg.reference} onChange={(event) => updateSplitLeg(leg.id, { reference: event.target.value })} disabled={splitAttempted} maxLength={191} /></label>}
                                                    </div>
                                                    {cash && <div className="leg-change">Cambio: <b>{displayMoney(Math.max(0, received - amount))}</b></div>}
                                                    {splitSucceeded.includes(leg.id) && <div className="split-payer-confirmed">Pago confirmado</div>}
                                                </article>
                                            );
                                        })}
                                    </div>
                                    {!splitPayerNamesUnique && <div className="payment-alert error">Cada comensal necesita un nombre único.</div>}
                                    {!unitAssignmentsComplete && <div className="payment-alert warning">Asigna todos los platos y verifica que cada comensal tenga al menos uno.</div>}
                                </section>
                            )}
                        </div>
                    )}
                    </div>
                </div>

                <footer className="payment-dialog-footer">
                    {(error || balanceError) && <div className="payment-alert error" role="alert">{error || balanceError}</div>}
                    {notice && <div className="payment-alert warning" role="status">{notice}</div>}
                    {!hasUsableCashShift && methods.some((method) => isCashPaymentMethodType(method.type)) && <div className="payment-cash-note"><Banknote size={16} /> Efectivo oculto: no hay turno vigente en la sucursal.</div>}
                    <div className="payment-footer-actions">
                        <button type="button" className="secondary" onClick={close} disabled={busy}>Cancelar</button>
                        <button type="button" className="primary" onClick={() => void (mode === 'single' ? handleSinglePayment() : mode === 'mixed' ? handleMixedPayment() : handleSplitPayment())} disabled={busy || settlementUnavailable || queuedPayment || Boolean(methodsError) || Boolean(balanceError) || balance <= 0 || (mode === 'single' && (!singleMethodId || (singleIsCash && (singleTendered === null || moneyToCents(singleTendered) < totalCents)))) || (mode === 'mixed' && !mixedValid) || (mode === 'split' && !splitValid)}>
                            {loading ? 'Procesando…' : previewLoading ? 'Calculando…' : mode === 'single' ? 'Confirmar pago' : mode === 'mixed' ? `Confirmar ${mixedLegs.length} tramos` : `Confirmar ${splitLegs.length} pagos`}
                        </button>
                    </div>
                </footer>
            </section>
        </div>,
        document.body,
    );
}

function AllocationStatus({
    summary,
    currencySymbol,
    valid,
    compact = false,
}: {
    summary: ReturnType<typeof summarizePaymentAllocation>;
    currencySymbol: string;
    valid: boolean;
    compact?: boolean;
}) {
    const difference = centsToMoney(Math.abs(summary.differenceCents));
    return (
        <div className={`allocation-status ${compact ? 'compact' : ''} ${valid ? 'valid' : 'invalid'}`} role="status">
            <div><span>Total asignado</span><strong>{formatMoneyAmount(centsToMoney(summary.allocatedCents), currencySymbol)}</strong></div>
            <b>{summary.exact ? 'Suma exacta' : summary.differenceCents > 0 ? `Falta ${formatMoneyAmount(difference, currencySymbol)}` : `Excede ${formatMoneyAmount(difference, currencySymbol)}`}</b>
        </div>
    );
}
