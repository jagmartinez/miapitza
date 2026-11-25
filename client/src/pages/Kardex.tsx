import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { warehousesAPI, reportsAPI, settingsAPI, productsAPI } from '../services/api';
import { ToastContainer } from '../components/Toast';
import { useToast } from '../hooks/useToast';
import { formatCurrency, type CurrencySettings } from '../utils/currency';
import { formatLocalDateInput } from '../utils/dateInput';
import { FileText, Download, Calendar, Filter, ArrowLeft } from 'lucide-react';
import './Kardex.css';
import { AppSelect, Button, Field, DataTable, PageHeader, formatNumber, type Column } from '@/ui';

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
            console.error('Error loading settings:', error);
        }
    }, []);

    const loadProducts = useCallback(async () => {
        try {
            const res = await productsAPI.getAll({ active: true, limit: 500 });
            const rows = (res.data?.data ?? res.data ?? []) as ProductRow[];
            setProducts(Array.isArray(rows) ? rows : []);
        } catch (error) {
            console.error('Error loading products:', error);
        }
    }, []);

    const loadWarehouses = useCallback(async () => {
        try {
            const res = await warehousesAPI.getAll();
            setWarehouses(res.data.data || []);
        } catch (error) {
            console.error('Error loading warehouses:', error);
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
            const msg = error instanceof Error ? error.message : 'Error al cargar kardex';
            showErrorRef.current(msg);
        } finally {
            setLoading(false);
        }
    }, [dateFrom, dateTo, movementType, selectedProduct, selectedWarehouse]);

    useEffect(() => {
        void loadWarehouses();
        void loadProducts();
        void loadSettings();

        const params = new URLSearchParams(window.location.search);
        const productId = params.get('productId');
        if (productId) {
            urlHadProductIdRef.current = true;
            setSelectedProduct(parseInt(productId, 10));
        }
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
            <span className="kardex-original-unit" style={{ display: 'block', fontSize: '11px', color: 'var(--ui-text-muted)' }}>
                ({movement.originalQuantity} {movement.originalUnit})
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
            showError(error instanceof Error ? error.message : 'Error al exportar');
        }
    };

    return (
        <div className="kardex-page">
            {/* Back Button */}
            <button className="kardex-back-button" onClick={() => navigate('/inventory')}>
                <ArrowLeft size={18} />
                Volver a Inventario
            </button>

            {/* Header */}
            <PageHeader
                title={`Kardex de Inventario${kardexData ? `: ${kardexData.product.name}` : ''}`}
                description="Reporte detallado de movimientos"
            />

            {/* Filters */}
            <div className="kardex-filters">
                <div className="filter-row">
                    <Field label="Producto" htmlFor="sel-266">
<AppSelect inputId="sel-266" options={products.map((p) => ({
                            value: p.id,
                            label: `${p.name}${p.sku ? ` (${p.sku})` : ''}`,
                        }))} value={(selectedProduct
                                ? {
                                    value: selectedProduct,
                                    label: products.find((p) => p.id === selectedProduct)?.name || `Producto #${selectedProduct}`,
                                }
                                : null)?.value ?? null} onChange={(__v) => { const option = (products.map((p) => ({
                            value: p.id,
                            label: `${p.name}${p.sku ? ` (${p.sku})` : ''}`,
                        }))).find((o) => o.value === __v) ?? null; return setSelectedProduct(option?.value ?? null); }} placeholder="Selecciona un producto..." isClearable />
</Field>

                    <Field label="Almacén" htmlFor="sel-285">
<AppSelect inputId="sel-285" options={[
                            { value: null, label: 'Todos los almacenes' },
                            ...warehouses.map(w => ({ value: w.id, label: w.name }))
                        ]} value={(selectedWarehouse ? { value: selectedWarehouse, label: warehouses.find(w => w.id === selectedWarehouse)?.name || '' } : { value: null, label: 'Todos los almacenes' })?.value ?? null} onChange={(__v) => { const option = ([
                            { value: null, label: 'Todos los almacenes' },
                            ...warehouses.map(w => ({ value: w.id, label: w.name }))
                        ]).find((o) => o.value === __v) ?? null; return setSelectedWarehouse(option?.value ?? null); }} />
</Field>

                    <div className="date-filter">
                        <label><Calendar size={16} /> Desde</label>
                        <input
                            type="date"
                            value={dateFrom}
                            onChange={(e) => setDateFrom(e.target.value)}
                        />
                    </div>

                    <div className="date-filter">
                        <label><Calendar size={16} /> Hasta</label>
                        <input
                            type="date"
                            value={dateTo}
                            onChange={(e) => setDateTo(e.target.value)}
                        />
                    </div>

                    <Field label="Tipo" htmlFor="sel-313">
<AppSelect inputId="sel-313" options={[
                            { value: '', label: 'Todos' },
                            { value: 'IN', label: 'Entrada' },
                            { value: 'OUT', label: 'Salida' },
                            { value: 'ADJUSTMENT', label: 'Ajuste' },
                            { value: 'TRANSFER', label: 'Transferencia' }
                        ]} value={movementType ?? null} onChange={(__v) => { const option = ([
                            { value: '', label: 'Todos' },
                            { value: 'IN', label: 'Entrada' },
                            { value: 'OUT', label: 'Salida' },
                            { value: 'ADJUSTMENT', label: 'Ajuste' },
                            { value: 'TRANSFER', label: 'Transferencia' }
                        ]).find((o) => o.value === __v) ?? null; return setMovementType(option?.value || ''); }} />
</Field>

                    <Button variant="primary" onClick={loadKardex} disabled={!selectedProduct || loading}>
                        <Filter size={18} />
                        {loading ? 'Cargando...' : 'Aplicar'}
                    </Button>

                    <Button onClick={handleExport} variant="secondary" disabled={!kardexData}>
                        <Download size={18} />
                        Excel
                    </Button>
                </div>
            </div>

            {/* Balance Cards Row */}
            {kardexData && (
                <div className="kardex-product-info">
                    <div className="balance-cards-row">
                        <div className="balance-card opening">
                            <span className="balance-label">Saldo Inicial</span>
                            <span className="balance-qty">{formatNumber(num(kardexData.openingBalance.quantity), 3)} {unitLabel}</span>
                            <span className="balance-cost">{formatCurrency(kardexData.openingBalance.cost, settings)}</span>
                        </div>

                        <div className="balance-card total-in">
                            <span className="balance-label">Total Entradas</span>
                            <span className="balance-value in">{formatNumber(num(kardexData.totals.totalIn), 3)} {unitLabel}</span>
                        </div>

                        <div className="balance-card total-out">
                            <span className="balance-label">Total Salidas</span>
                            <span className="balance-value out">{formatNumber(num(kardexData.totals.totalOut), 3)} {unitLabel}</span>
                        </div>

                        <div className="balance-card closing">
                            <span className="balance-label">Saldo Final</span>
                            <span className="balance-qty">{formatNumber(num(kardexData.closingBalance.quantity), 3)} {unitLabel}</span>
                            <span className="balance-cost">{formatCurrency(kardexData.closingBalance.cost, settings)}</span>
                        </div>
                    </div>
                </div>
            )}

            {/* Movements Table */}
            {kardexData && kardexData.movements.length > 0 ? (
                <div className="data-table-wrapper kardex-table-container">
                    <div className="data-table-header">
                        <span>Movimientos</span>
                        <span className="data-table-count">{movements.length} registros</span>
                    </div>
                    <DataTable
                        ariaLabel="Movimientos de kardex"
                        rows={movements}
                        rowKey={(movement) => movement.id}
                        defaultPageSize={PAGE_SIZE}
                        pageSizeOptions={[10, 20, 50, 100]}
                        resetKey={kardexData}
                        columns={[
                            { key: 'date', header: 'Fecha', type: 'date' },
                            { key: 'type', header: 'Tipo', render: (movement) => (
                                <span className={`movement-type ${movement.type.toLowerCase()}`}>{movement.type}</span>
                            ) },
                            { key: 'reference', header: 'Referencia' },
                            { key: 'in', header: 'Entrada', type: 'qty', render: (movement) => (
                                <span className={movement.in ? 'movement-in' : ''}>
                                    {movement.in ? `${formatNumber(num(movement.in), 3)} ${unitLabel}` : '-'}
                                    {movement.in ? originalHint(movement) : null}
                                </span>
                            ) },
                            { key: 'out', header: 'Salida', type: 'qty', render: (movement) => (
                                <span className={movement.out ? 'movement-out' : ''}>
                                    {movement.out ? `${formatNumber(num(movement.out), 3)} ${unitLabel}` : '-'}
                                    {movement.out ? originalHint(movement) : null}
                                </span>
                            ) },
                            { key: 'balance', header: 'Saldo', type: 'qty', render: (movement) => <strong>{formatNumber(num(movement.balance), 3)} {unitLabel}</strong> },
                            { key: 'unitCost', header: 'Costo Unit.', type: 'money', render: (movement) => formatCurrency(movement.unitCost, settings) },
                            { key: 'totalCost', header: 'Costo Total', type: 'money', render: (movement) => formatCurrency(movement.totalCost, settings) },
                            { key: 'warehouse', header: 'Almacén' },
                            { key: 'branch', header: 'Sucursal' },
                            { key: 'user', header: 'Usuario' },
                        ] as Column<(typeof movements)[number]>[]}
                    />
                </div>
            ) : kardexData && kardexData.movements.length === 0 ? (
                <div className="no-movements">
                    <FileText size={48} />
                    <p>No hay movimientos en el período seleccionado</p>
                </div>
            ) : !selectedProduct ? (
                <div className="no-movements">
                    <FileText size={48} />
                    <p>Selecciona un producto (ej. DEMO-CYCLE Masa pizza) para ver entradas, salidas y saldo</p>
                </div>
            ) : null}

            <ToastContainer toasts={toasts} onRemove={removeToast} />
        </div>
    );
}
