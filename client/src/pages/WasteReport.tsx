import React, { useState, useEffect, useCallback, useRef } from 'react';
import api, { unitsAPI } from '../services/api';
import { formatCurrency, type CurrencySettings } from '../utils/currency';
import {
    Trash2, FileText, Search, RefreshCw,
    Calendar, Package, Tag,
    DollarSign, BarChart3, Save
} from 'lucide-react';
import { useAppToast } from '../context/ToastContext';
import { formatLocalDateInput } from '../utils/dateInput';
import { newIdempotencyKey } from '../utils/idempotency';
import { AppSelect, Button, Field, DataTable, EmptyState, PageHeader, formatNumber, type Column } from '@/ui';


function errMsg(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'response' in error) {
        const m = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
        if (typeof m === 'string' && m) return m;
    }
    if (error instanceof Error) return error.message;
    return 'Error';
}

interface WasteEntry {
    id: number;
    date: string;
    product: string;
    quantity: number;
    unit: string;
    cost: number;
    reason: string;
    warehouse: string;
    user: string;
}

interface WasteReport {
    summary: {
        totalEntries: number;
        quantities: Array<{ unit: string; quantity: number }>;
        totalCost: number;
    };
    byReason: Array<{
        reason: string;
        count: number;
        quantity: number;
        unit: string;
        cost: number;
    }>;
    details: WasteEntry[];
}

interface Warehouse {
    id: number;
    name: string;
}

interface Product {
    id: number;
    name: string;
    unit: string;
}

interface AllowedUnit {
    unitId: number;
    abbreviation: string;
    name: string;
    isBase: boolean;
    isDefault: boolean;
}

const PAGE_SIZE = 20;

const WasteReport: React.FC = () => {
    const { error: showError, success } = useAppToast();
    const [activeTab, setActiveTab] = useState<'record' | 'report'>('record');
    const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [wasteReasons, setWasteReasons] = useState<string[]>([]);
    const [report, setReport] = useState<WasteReport | null>(null);
    const [settings, setSettings] = useState<CurrencySettings>({});
    const [loading, setLoading] = useState(false);
    const wasteAttemptRef = useRef<{ fingerprint: string; key: string } | null>(null);

    const [productUnits, setProductUnits] = useState<AllowedUnit[]>([]);

    const [formData, setFormData] = useState({
        warehouseId: '',
        productId: '',
        quantity: '',
        unit: '',
        reason: '',
        notes: ''
    });

    const [filters, setFilters] = useState({
        startDate: formatLocalDateInput(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
        endDate: formatLocalDateInput(),
        warehouseId: '',
        productId: ''
    });

    const loadInitialData = useCallback(async () => {
        try {
            const [warehousesRes, productsRes, reasonsRes] = await Promise.all([
                api.get('/warehouses'),
                api.get('/products'),
                api.get('/advanced/waste/reasons')
            ]);
            setWarehouses(warehousesRes.data.data || []);
            setProducts(productsRes.data.data || []);
            setWasteReasons(reasonsRes.data.data || []);
        } catch (error) {
            console.error('Error loading data:', error);
        }
    }, []);

    const loadSettings = useCallback(async () => {
        try {
            const response = await api.get('/settings');
            setSettings(response.data.data || {});
        } catch (error) {
            console.error('Error loading settings:', error);
        }
    }, []);

    const handleRecordWaste = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        const payload = {
            warehouseId: parseInt(formData.warehouseId),
            productId: parseInt(formData.productId),
            quantity: parseFloat(formData.quantity),
            reason: formData.reason,
            notes: formData.notes,
            ...(formData.unit ? { unit: formData.unit } : {})
        };
        const fingerprint = JSON.stringify(payload);
        if (wasteAttemptRef.current?.fingerprint !== fingerprint) {
            wasteAttemptRef.current = { fingerprint, key: newIdempotencyKey() };
        }
        try {
            await api.post('/advanced/waste', payload, {
                headers: { 'X-Idempotency-Key': wasteAttemptRef.current.key }
            });
            success('Merma registrada exitosamente');
            wasteAttemptRef.current = null;
            setFormData({
                warehouseId: '',
                productId: '',
                quantity: '',
                unit: '',
                reason: '',
                notes: ''
            });
            if (activeTab === 'report') loadReport();
        } catch (error: unknown) {
            showError('Error al registrar merma: ' + errMsg(error));
        } finally {
            setLoading(false);
        }
    };

    const loadReport = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (filters.startDate) params.append('startDate', filters.startDate);
            if (filters.endDate) params.append('endDate', filters.endDate);
            if (filters.warehouseId) params.append('warehouseId', filters.warehouseId);
            if (filters.productId) params.append('productId', filters.productId);

            const response = await api.get(`/advanced/waste/report?${params.toString()}`);
            setReport(response.data.data);
        } catch (error: unknown) {
            showError('Error al cargar reporte: ' + errMsg(error));
        } finally {
            setLoading(false);
        }
    }, [filters.endDate, filters.productId, filters.startDate, filters.warehouseId, showError]);

    useEffect(() => {
        void loadInitialData();
        void loadSettings();
    }, [loadInitialData, loadSettings]);

    useEffect(() => {
        if (activeTab === 'report') void loadReport();
    }, [activeTab, loadReport]);

    // Load the product's allowed units so the user can record waste in any of them.
    // Default to the base unit (backend assumes base when no unit is sent).
    useEffect(() => {
        if (!formData.productId) {
            setProductUnits([]);
            setFormData((fd) => ({ ...fd, unit: '' }));
            return;
        }
        let cancelled = false;
        void (async () => {
            try {
                const res = await unitsAPI.getProductUnits(parseInt(formData.productId));
                if (cancelled) return;
                const units: AllowedUnit[] = res.data.data || [];
                setProductUnits(units);
                const base = units.find((u) => u.isBase) ?? units[0];
                setFormData((fd) => ({ ...fd, unit: base ? base.abbreviation : '' }));
            } catch (error: unknown) {
                if (!cancelled) {
                    setProductUnits([]);
                    setFormData((fd) => ({ ...fd, unit: '' }));
                    showError('No se pudieron cargar las unidades del producto: ' + errMsg(error));
                }
            }
        })();
        return () => { cancelled = true; };
    }, [formData.productId, showError]);

    const detailEntries = report?.details ?? [];

    return (
        <div className="page-wrapper">
            <PageHeader
                title="Reporte de Merma y Desperdicio"
                description="Registra y analiza las pérdidas de inventario para mejorar el control de costos."
            />

            {/* Tabs */}
            <div className="page-tabs">
                <button
                    type="button"
                    className={`page-tab ${activeTab === 'record' ? 'active' : ''}`}
                    onClick={() => setActiveTab('record')}
                >
                    <Save size={16} />
                    <span>Registrar Merma</span>
                </button>
                <button
                    type="button"
                    className={`page-tab ${activeTab === 'report' ? 'active' : ''}`}
                    onClick={() => setActiveTab('report')}
                >
                    <BarChart3 size={16} />
                    <span>Ver Reporte</span>
                </button>
            </div>

            {/* Record Waste Tab */}
            {activeTab === 'record' && (
                <div className="data-table-wrapper" style={{ padding: 'var(--spacing-xl)' }}>
                    <form onSubmit={handleRecordWaste} className="modal-form-new" style={{ overflow: 'visible' }}>
                        <div className="modal-section">
                            <div className="modal-section-header">
                                <Trash2 size={18} />
                                <h3>Nueva Merma</h3>
                            </div>

                            <div className="modal-form-row">
                                <div className="modal-input-group">
                                    <Field label="Almacén" htmlFor="sel-275" required>
<AppSelect inputId="sel-275" options={warehouses.map((w) => ({ value: w.id.toString(), label: w.name }))} value={(formData.warehouseId
                                                ? { value: formData.warehouseId, label: warehouses.find((w) => w.id.toString() === formData.warehouseId)?.name || '' }
                                                : null)?.value ?? null} onChange={(__v) => { const option = (warehouses.map((w) => ({ value: w.id.toString(), label: w.name }))).find((o) => o.value === __v) ?? null; return option && setFormData({ ...formData, warehouseId: option.value }); }} placeholder="Seleccionar almacén" />
</Field>
                                </div>

                                <div className="modal-input-group">
                                    <Field label="Producto" htmlFor="sel-292" required>
<AppSelect inputId="sel-292" options={products.map((p) => ({ value: p.id.toString(), label: `${p.name} (${p.unit})` }))} value={(formData.productId
                                                ? {
                                                    value: formData.productId,
                                                    label: (() => {
                                                        const prod = products.find((p) => p.id.toString() === formData.productId);
                                                        return prod ? `${prod.name} (${prod.unit})` : '';
                                                    })(),
                                                }
                                                : null)?.value ?? null} onChange={(__v) => { const option = (products.map((p) => ({ value: p.id.toString(), label: `${p.name} (${p.unit})` }))).find((o) => o.value === __v) ?? null; return option && setFormData({ ...formData, productId: option.value }); }} placeholder="Seleccionar producto" />
</Field>
                                </div>
                            </div>

                            <div className="modal-form-row">
                                <div className="modal-input-group">
                                    <label className="modal-input-label" htmlFor="waste-quantity">Cantidad *</label>
                                    <input
                                        id="waste-quantity"
                                        type="number"
                                        step="0.001"
                                        className="modal-standard-input"
                                        value={formData.quantity}
                                        onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                                        required
                                        min="0.001"
                                        placeholder="0.000"
                                    />
                                </div>

                                <div className="modal-input-group">
                                    <Field label="Unidad" htmlFor="sel-332">
<AppSelect inputId="sel-332" options={productUnits.map((u) => ({
                                            value: u.abbreviation,
                                            label: u.isBase ? `${u.abbreviation} (base)` : u.abbreviation
                                        }))} value={(formData.unit
                                                ? {
                                                    value: formData.unit,
                                                    label: (() => {
                                                        const u = productUnits.find((x) => x.abbreviation === formData.unit);
                                                        return u ? (u.isBase ? `${u.abbreviation} (base)` : u.abbreviation) : formData.unit;
                                                    })()
                                                }
                                                : null)?.value ?? null} onChange={(__v) => { const option = (productUnits.map((u) => ({
                                            value: u.abbreviation,
                                            label: u.isBase ? `${u.abbreviation} (base)` : u.abbreviation
                                        }))).find((o) => o.value === __v) ?? null; return option && setFormData({ ...formData, unit: option.value }); }} placeholder={formData.productId ? 'Unidad base' : 'Seleccione producto'} isDisabled={!formData.productId || productUnits.length === 0} />
</Field>
                                </div>
                            </div>

                            <div className="modal-form-row">
                                <div className="modal-input-group">
                                    <Field label="Razón" htmlFor="sel-361" required>
<AppSelect inputId="sel-361" options={wasteReasons.map((reason) => ({ value: reason, label: reason }))} value={(formData.reason ? { value: formData.reason, label: formData.reason } : null)?.value ?? null} onChange={(__v) => { const option = (wasteReasons.map((reason) => ({ value: reason, label: reason }))).find((o) => o.value === __v) ?? null; return option && setFormData({ ...formData, reason: option.value }); }} placeholder="Seleccionar razón" />
</Field>
                                </div>
                            </div>

                            <div className="modal-input-group">
                                <label className="modal-input-label" htmlFor="waste-notes">Notas</label>
                                <textarea
                                    id="waste-notes"
                                    className="modal-textarea"
                                    value={formData.notes}
                                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                    rows={3}
                                    placeholder="Detalles adicionales..."
                                />
                            </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--spacing-lg)' }}>
                            <Button variant="primary" type="submit" disabled={loading}>
                                {loading ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
                                {loading ? 'Guardando...' : 'Registrar Merma'}
                            </Button>
                        </div>
                    </form>
                </div>
            )}

            {/* Report Tab */}
            {activeTab === 'report' && (
                <>
                    {/* Filters */}
                    <div className="filters-toolbar">
                        <div className="filter-field filter-field-wide">
                            <label className="filter-field-label">
                                <Calendar size={12} /> Rango de Fechas
                            </label>
                            <div className="filter-field-date-range">
                                <input
                                    type="date"
                                    className="filter-input"
                                    value={filters.startDate}
                                    onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                                />
                                <span className="filter-range-sep">→</span>
                                <input
                                    type="date"
                                    className="filter-input"
                                    value={filters.endDate}
                                    onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                                />
                            </div>
                        </div>

                        <div className="filter-field">
                            <Field label="Almacén" htmlFor="sel-425">
<AppSelect inputId="sel-425" options={[
                                    { value: '', label: 'Todos los Almacenes' },
                                    ...warehouses.map((w) => ({ value: w.id.toString(), label: w.name }))
                                ]} value={(filters.warehouseId
                                        ? { value: filters.warehouseId, label: warehouses.find(w => w.id.toString() === filters.warehouseId)?.name || 'Todos' }
                                        : { value: '', label: 'Todos los Almacenes' })?.value ?? null} onChange={(__v) => { const option = ([
                                    { value: '', label: 'Todos los Almacenes' },
                                    ...warehouses.map((w) => ({ value: w.id.toString(), label: w.name }))
                                ]).find((o) => o.value === __v) ?? null; return option && setFilters({ ...filters, warehouseId: option.value }); }} />
</Field>
                        </div>

                        <div className="filter-field">
                            <Field label="Producto" htmlFor="sel-441">
<AppSelect inputId="sel-441" options={[
                                    { value: '', label: 'Todos los Productos' },
                                    ...products.map((p) => ({ value: p.id.toString(), label: p.name }))
                                ]} value={(filters.productId
                                        ? { value: filters.productId, label: products.find(p => p.id.toString() === filters.productId)?.name || 'Todos' }
                                        : { value: '', label: 'Todos los Productos' })?.value ?? null} onChange={(__v) => { const option = ([
                                    { value: '', label: 'Todos los Productos' },
                                    ...products.map((p) => ({ value: p.id.toString(), label: p.name }))
                                ]).find((o) => o.value === __v) ?? null; return option && setFilters({ ...filters, productId: option.value }); }} />
</Field>
                        </div>

                        <div className="filter-spacer" />

                        <div className="filter-actions">
                            <Button variant="primary" onClick={loadReport} disabled={loading}>
                                {loading ? <RefreshCw size={16} className="animate-spin" /> : <Search size={16} />}
                                {loading ? 'Cargando...' : 'Generar Reporte'}
                            </Button>
                        </div>
                    </div>

                    {report && (
                        <>
                            <div className="kpi-grid">
                                <div className="kpi-card kpi-neutral">
                                    <div className="kpi-label">
                                        <FileText size={14} /> Total Entradas
                                    </div>
                                    <div className="kpi-value">{report.summary.totalEntries}</div>
                                </div>
                                <div className="kpi-card kpi-warning">
                                    <div className="kpi-label">
                                        <Package size={14} /> Cantidad física
                                    </div>
                                    <div className="kpi-value">
                                        {report.summary.quantities.length > 0
                                            ? report.summary.quantities.map((item) => `${formatNumber(item.quantity)} ${item.unit}`).join(' · ')
                                            : '0'}
                                    </div>
                                </div>
                                <div className="kpi-card kpi-danger">
                                    <div className="kpi-label">
                                        <DollarSign size={14} /> Costo Total
                                    </div>
                                    <div className="kpi-value">{formatCurrency(report.summary.totalCost, settings)}</div>
                                </div>
                            </div>

                            {/* By Reason */}
                            <div className="data-table-wrapper">
                                <div className="data-table-header">
                                    <span><Tag size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />Merma por Razón</span>
                                    <span className="data-table-count">{report.byReason.length} razones</span>
                                </div>
                                <DataTable
                                    ariaLabel="Merma por razón"
                                    rows={report.byReason}
                                    rowKey={(item) => item.reason}
                                    pagination={{ mode: 'client' }}
                                    empty={<EmptyState title="Sin datos para los filtros seleccionados" />}
                                    columns={[
                                        { key: 'reason', header: 'Razón' },
                                        { key: 'count', header: 'Entradas', type: 'number', decimals: 0 },
                                        { key: 'quantity', header: 'Unidades', type: 'qty' },
                                        { key: 'unit', header: 'Unidad' },
                                        { key: 'cost', header: 'Costo', type: 'money', render: (item) => formatCurrency(item.cost, settings) },
                                    ] as Column<(typeof report.byReason)[number]>[]}
                                />
                            </div>

                            {/* Details */}
                            <div className="data-table-wrapper">
                                <div className="data-table-header">
                                    <span><FileText size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />Detalle de Mermas</span>
                                    <span className="data-table-count">{report.details.length} registros</span>
                                </div>
                                <DataTable
                                    ariaLabel="Detalle de mermas"
                                    rows={detailEntries}
                                    rowKey={(entry) => entry.id}
                                    defaultPageSize={PAGE_SIZE}
                                    pageSizeOptions={[10, 20, 50, 100]}
                                    empty={<EmptyState title="Sin registros de merma en el período seleccionado" />}
                                    columns={[
                                        { key: 'date', header: 'Fecha', type: 'date' },
                                        { key: 'product', header: 'Producto' },
                                        { key: 'quantity', header: 'Cantidad', type: 'qty', render: (entry) => `${formatNumber(entry.quantity)} ${entry.unit}` },
                                        { key: 'cost', header: 'Costo', type: 'money', render: (entry) => formatCurrency(entry.cost, settings) },
                                        { key: 'reason', header: 'Razón' },
                                        { key: 'warehouse', header: 'Almacén' },
                                        { key: 'user', header: 'Usuario' },
                                    ] as Column<(typeof detailEntries)[number]>[]}
                                />
                            </div>
                        </>
                    )}

                    {!report && !loading && (
                        <div className="state-placeholder">
                            <BarChart3 size={48} />
                            <p>Aplica los filtros para generar el reporte.</p>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default WasteReport;
