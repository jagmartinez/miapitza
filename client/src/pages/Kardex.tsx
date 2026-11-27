import { useState, useEffect, useCallback, useRef } from 'react';
import { notifyError } from '../services/notify';
import { useNavigate } from 'react-router-dom';
import { warehousesAPI, reportsAPI, settingsAPI, productsAPI } from '../services/api';
import { ToastContainer } from '../components/Toast';
import { useToast } from '../hooks/useToast';
import { formatCurrency, type CurrencySettings } from '../utils/currency';
import { formatLocalDateInput } from '../utils/dateInput';
import { kardexUrlFilters } from '../utils/kardexLink';
import { FileText, Download, Filter, ArrowLeft } from 'lucide-react';
import catalog from './catalog.module.css';
import {
    AppSelect, Badge, Button, DataTable, DateInput, EmptyState, PageContent, PageHeader, TableToolbar,
    formatNumber, type Column, type Tone,
} from '@/ui';

const MOVEMENT_LABEL: Record<string, string> = {
    IN: 'Entrada',
    OUT: 'Salida',
    ADJUSTMENT: 'Ajuste',
    TRANSFER: 'Traslado',
    COUNT: 'Conteo',
    WASTE: 'Merma',
    PRODUCTION: 'Producción',
};
const MOVEMENT_TONE: Record<string, Tone> = {
    IN: 'success',
    OUT: 'warning',
    ADJUSTMENT: 'primary',
    TRANSFER: 'neutral',
    WASTE: 'danger',
};
import { getApiErrorMessage } from '../utils/apiError';

interface WarehouseRow {
    id: number;
    name: string;
}


interface KardexMovement {
    id: number;
    date: string;
    type: string;
    reference: string;
    reason: string;
    in: number | null;
    out: number | null;
    balance: number;
    unitCost: number;
    totalCost: number;
    balanceCost: number;
    originalUnit?: string | null;
    originalQuantity?: number | null;
    warehouse: string;
    branch: string;
    user: string;
}

interface KardexData {
    product: {
        id: number;
        name: string;
        sku: string;
        unit: string;
    };
    baseUnitAbbr?: string;
    warehouse: { id?: number; name?: string } | string | null;
    dateRange: {
        from: Date | null;
        to: Date | null;
    };
    openingBalance: {
        quantity: number;
        cost: number;
    };
    movements: KardexMovement[];
    closingBalance: {
        quantity: number;
        cost: number;
    };
    totals: {
        totalIn: number;
        totalOut: number;
        netChange: number;
    };
}

interface ProductRow {
    id: number;
    name: string;
    sku: string;
}

const PAGE_SIZE = 20;

const todayStr = () => formatLocalDateInput();
const monthStartStr = () => {
    const d = new Date();
    return formatLocalDateInput(new Date(d.getFullYear(), d.getMonth(), 1));
};

const num = (value: number | string | null | undefined) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
};


export default function Kardex() {
    const navigate = useNavigate();
    const { toasts, removeToast, success: showSuccess, error: showError } = useToast();
    const showErrorRef = useRef(showError);
    showErrorRef.current = showError;
    // Track whether a productId arrived via the URL (explicit selection has
    // priority) and whether we already applied the default preselection.
    const urlHadProductIdRef = useRef(false);
    const autoSelectedRef = useRef(false);

    const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
    const [products, setProducts] = useState<ProductRow[]>([]);
    const [kardexData, setKardexData] = useState<KardexData | null>(null);
    const [loading, setLoading] = useState(false);

    // Filters
    const [selectedProduct, setSelectedProduct] = useState<number | null>(null);
    const [selectedWarehouse, setSelectedWarehouse] = useState<number | null>(null);
    const [dateFrom, setDateFrom] = useState(monthStartStr);
    const [dateTo, setDateTo] = useState(todayStr);
    const [movementType, setMovementType] = useState<string>('');
    const [settings, setSettings] = useState<CurrencySettings>({});

    const loadSettings = useCallback(async () => {
        try {
            const res = await settingsAPI.getAll();
            setSettings(res.data.data || {});
        } catch (error) {
            notifyError(error, 'No se pudo cargar la configuración; los montos usan el formato predeterminado', { type: 'warning' });
        }
    }, []);

    const loadProducts = useCallback(async () => {
        try {
            const res = await productsAPI.getAll({ active: true, limit: 500 });
            const rows = (res.data?.data ?? res.data ?? []) as ProductRow[];
            setProducts(Array.isArray(rows) ? rows : []);
        } catch (error) {
            notifyError(error, 'No se pudieron cargar los productos');
        }
    }, []);

    const loadWarehouses = useCallback(async () => {
        try {
            const res = await warehousesAPI.getAll();
            setWarehouses(res.data.data || []);
        } catch (error) {
            notifyError(error, 'No se pudieron cargar las bodegas');
        }
    }, []);

    const loadKardex = useCallback(async () => {
        if (!selectedProduct) {
            showErrorRef.current('Selecciona un producto');
            return;
        }

        setLoading(true);
        try {
            const params: Record<string, string> = {
                productId: selectedProduct.toString()
            };
            if (selectedWarehouse) params.warehouseId = selectedWarehouse.toString();
            if (dateFrom) params.dateFrom = dateFrom;
            if (dateTo) params.dateTo = dateTo;
            if (movementType) params.type = movementType;

            const res = await reportsAPI.getKardex(params);
            setKardexData(res.data);
        } catch (error: unknown) {
            showErrorRef.current(getApiErrorMessage(error, 'Error al cargar kardex'));
        } finally {
            setLoading(false);
        }
    }, [dateFrom, dateTo, movementType, selectedProduct, selectedWarehouse]);

    useEffect(() => {
        void loadWarehouses();
        void loadProducts();
        void loadSettings();

        const fromUrl = kardexUrlFilters(window.location.search);
        if (fromUrl.productId) {
            urlHadProductIdRef.current = true;
            setSelectedProduct(fromUrl.productId);
        }
        if (fromUrl.warehouseId) setSelectedWarehouse(fromUrl.warehouseId);
        if (fromUrl.dateFrom) setDateFrom(fromUrl.dateFrom);
    }, [loadWarehouses, loadProducts, loadSettings]);

    // When entering without an explicit productId in the URL, preselect the
    // first available product so the page isn't empty (e.g. coming from the
    // Reports hub). Runs once; never overrides a URL-provided selection.
    useEffect(() => {
        if (urlHadProductIdRef.current || autoSelectedRef.current) return;
        if (selectedProduct) return;
        if (products.length > 0) {
            autoSelectedRef.current = true;
            setSelectedProduct(products[0].id);
        }
    }, [products, selectedProduct]);

    useEffect(() => {
        if (selectedProduct) {
            void loadKardex();
        }
    }, [loadKardex, selectedProduct]);

    const movements = kardexData?.movements ?? [];
    // Stock/balances are kept in the product's base unit; prefer its real
    // abbreviation and fall back to the legacy `unit` field.
    const unitLabel = kardexData?.baseUnitAbbr || kardexData?.product.unit || '';
    // Muestra la unidad/cantidad original cuando difiere de la unidad base del kardex.
    const originalHint = (movement: (typeof movements)[number]) => {
        const showOriginal = !!movement.originalUnit
            && movement.originalUnit !== unitLabel
            && movement.originalQuantity != null;
        return showOriginal ? (
            <span className={catalog.muted}>
                ({formatNumber(num(movement.originalQuantity), 3)} {movement.originalUnit})
            </span>
        ) : null;
    };

    const handleExport = async () => {
        if (!selectedProduct) {
            showError('Selecciona un producto');
            return;
        }

        try {
            const params: Record<string, string> = {
                productId: selectedProduct.toString()
            };
            if (selectedWarehouse) params.warehouseId = selectedWarehouse.toString();
            if (dateFrom) params.dateFrom = dateFrom;
            if (dateTo) params.dateTo = dateTo;

            const res = await reportsAPI.exportKardex(params);
            const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Kardex_${kardexData?.product.name}_${formatLocalDateInput()}.xlsx`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            showSuccess('Kardex exportado correctamente');
        } catch (error: unknown) {
            showError(getApiErrorMessage(error, 'Error al exportar el kardex'));
        }
    };

    return (
        <PageContent>
            <PageHeader
                title={`Kardex de inventario${kardexData ? `: ${kardexData.product.name}` : ''}`}
                description="Entradas, salidas y saldo valorizado por producto."
                actions={(
                    <>
                        <Button icon={ArrowLeft} variant="ghost" onClick={() => navigate('/inventory')}>Volver a Inventario</Button>
                        <Button icon={Download} onClick={handleExport} disabled={!kardexData}>Excel</Button>
                    </>
                )}
            />

            {kardexData && (
                <p className={catalog.summaryLine} role="status">
                    <span>Saldo inicial <strong>{formatNumber(num(kardexData.openingBalance.quantity))} {unitLabel}</strong> ({formatCurrency(kardexData.openingBalance.cost, settings)})</span>
                    <span>Entradas <strong>{formatNumber(num(kardexData.totals.totalIn))} {unitLabel}</strong></span>
                    <span>Salidas <strong>{formatNumber(num(kardexData.totals.totalOut))} {unitLabel}</strong></span>
                    <span>Saldo final <strong>{formatNumber(num(kardexData.closingBalance.quantity))} {unitLabel}</strong> ({formatCurrency(kardexData.closingBalance.cost, settings)})</span>
                </p>
            )}

            <DataTable
                ariaLabel="Movimientos de kardex"
                rows={movements}
                rowKey={(movement) => movement.id}
                loading={loading}
                defaultPageSize={PAGE_SIZE}
                pageSizeOptions={[10, 20, 50, 100]}
                resetKey={kardexData}
                empty={(
                    <EmptyState
                        icon={FileText}
                        title={kardexData ? 'No hay movimientos en el período seleccionado' : 'Selecciona un producto'}
                        description={kardexData ? undefined : 'Elige un producto y aplica los filtros para ver entradas, salidas y saldo.'}
                    />
                )}
                toolbar={(
                    <TableToolbar actions={(
                        <Button variant="primary" icon={Filter} onClick={loadKardex} disabled={!selectedProduct} loading={loading}>
                            Aplicar
                        </Button>
                    )}>
                        <AppSelect<number>
                            aria-label="Producto"
                            options={products.map((p) => ({ value: p.id, label: `${p.name}${p.sku ? ` (${p.sku})` : ''}` }))}
                            value={selectedProduct}
                            onChange={(v) => setSelectedProduct(v ?? null)}
                            placeholder="Selecciona un producto..."
                            isClearable
                        />
                        <AppSelect<number>
                            aria-label="Almacén"
                            options={warehouses.map(w => ({ value: w.id, label: w.name }))}
                            value={selectedWarehouse}
                            onChange={(v) => setSelectedWarehouse(v ?? null)}
                            placeholder="Todos los almacenes"
                            isClearable
                        />
                        <DateInput aria-label="Desde" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                        <DateInput aria-label="Hasta" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                        <AppSelect<string>
                            aria-label="Tipo de movimiento"
                            isClearable={false}
                            isSearchable={false}
                            options={[
                                { value: '', label: 'Todos los tipos' },
                                { value: 'IN', label: 'Entrada' },
                                { value: 'OUT', label: 'Salida' },
                                { value: 'ADJUSTMENT', label: 'Ajuste' },
                                { value: 'TRANSFER', label: 'Transferencia' }
                            ]}
                            value={movementType}
                            onChange={(v) => setMovementType(v || '')}
                        />
                    </TableToolbar>
                )}
                columns={[
                    { key: 'date', header: 'Fecha', type: 'date' },
                    { key: 'type', header: 'Tipo', render: (movement) => (
                        <Badge tone={MOVEMENT_TONE[movement.type] ?? 'neutral'}>{MOVEMENT_LABEL[movement.type] ?? movement.type}</Badge>
                    ) },
                    { key: 'reference', header: 'Referencia' },
                    { key: 'in', header: 'Entrada', type: 'qty', render: (movement) => (
                        <span className={catalog.cellStack}>
                            {movement.in ? `${formatNumber(num(movement.in), 3)} ${unitLabel}` : '—'}
                            {movement.in ? originalHint(movement) : null}
                        </span>
                    ) },
                    { key: 'out', header: 'Salida', type: 'qty', render: (movement) => (
                        <span className={catalog.cellStack}>
                            {movement.out ? `${formatNumber(num(movement.out), 3)} ${unitLabel}` : '—'}
                            {movement.out ? originalHint(movement) : null}
                        </span>
                    ) },
                    { key: 'balance', header: 'Saldo', type: 'qty', render: (movement) => <strong>{formatNumber(num(movement.balance), 3)} {unitLabel}</strong> },
                    { key: 'unitCost', header: 'Costo unit.', type: 'money', render: (movement) => formatCurrency(movement.unitCost, settings) },
                    { key: 'totalCost', header: 'Costo total', type: 'money', render: (movement) => formatCurrency(movement.totalCost, settings) },
                    { key: 'warehouse', header: 'Almacén', hideBelow: 'lg' },
                    { key: 'branch', header: 'Sucursal', hideBelow: 'lg' },
                    { key: 'user', header: 'Responsable' },
                ] as Column<(typeof movements)[number]>[]}
            />

            <ToastContainer toasts={toasts} onRemove={removeToast} />
        </PageContent>
    );
}
