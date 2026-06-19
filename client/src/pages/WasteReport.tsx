import React, { useState, useEffect, useCallback } from 'react';
import api, { unitsAPI } from '../services/api';
import { formatCurrency, type CurrencySettings } from '../utils/currency';
import type { SingleValue } from 'react-select';
import Select from '../components/Select';
import Button from '../components/Button';
import Pagination from '../components/Pagination';
import {
    Trash2, AlertTriangle, FileText, Search, RefreshCw,
    Calendar, Warehouse as WarehouseIcon, Package, Tag,
    DollarSign, BarChart3, Save
} from 'lucide-react';
import { useAppToast } from '../context/ToastContext';

type StrOption = { value: string; label: string };

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
        totalUnits: number;
        totalCost: number;
    };
    byReason: Array<{
        reason: string;
        count: number;
        quantity: number;
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
    const [page, setPage] = useState(1);
    const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [wasteReasons, setWasteReasons] = useState<string[]>([]);
    const [report, setReport] = useState<WasteReport | null>(null);
    const [settings, setSettings] = useState<CurrencySettings>({});
    const [loading, setLoading] = useState(false);

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
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0],
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
        try {
            await api.post('/advanced/waste', {
                warehouseId: parseInt(formData.warehouseId),
                productId: parseInt(formData.productId),
                quantity: parseFloat(formData.quantity),
                reason: formData.reason,
                notes: formData.notes,
                ...(formData.unit ? { unit: formData.unit } : {})
            });
            success('Merma registrada exitosamente');
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
            setPage(1);
        } catch (error: unknown) {
            showError('Error al cargar reporte: ' + errMsg(error));
        } finally {
            setLoading(false);
        }
    }, [filters.endDate, filters.productId, filters.startDate, filters.warehouseId]);

    useEffect(() => {
        void loadInitialData();
        void loadSettings();
    }, [loadInitialData, loadSettings]);

    useEffect(() => {
        if (activeTab === 'report') void loadReport();
    }, [activeTab, loadReport]);

    useEffect(() => {
        setPage(1);
    }, [filters.startDate, filters.endDate, filters.warehouseId, filters.productId]);

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
            } catch {
                if (!cancelled) {
                    setProductUnits([]);
                    setFormData((fd) => ({ ...fd, unit: '' }));
                }
            }
        })();
        return () => { cancelled = true; };
    }, [formData.productId]);

    const detailEntries = report?.details ?? [];
    const totalPages = Math.max(1, Math.ceil(detailEntries.length / PAGE_SIZE));
    const pagedDetails = detailEntries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    return (
        <div className="page-wrapper">
            <div className="page-header-bar">
                <div className="header-title-section">
                    <h1><Trash2 size={28} /> Reporte de Merma y Desperdicio</h1>
                    <p className="header-subtitle">
                        Registra y analiza las pérdidas de inventario para mejorar el control de costos.
                    </p>
                </div>
            </div>

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
                                    <Select
                                        label={<><WarehouseIcon size={12} /> Almacén *</>}
                                        options={warehouses.map((w) => ({ value: w.id.toString(), label: w.name }))}
                                        value={
                                            formData.warehouseId
                                                ? { value: formData.warehouseId, label: warehouses.find((w) => w.id.toString() === formData.warehouseId)?.name || '' }
                                                : null
                                        }
                                        onChange={(option: SingleValue<StrOption>) =>
                                            option && setFormData({ ...formData, warehouseId: option.value })
                                        }
                                        placeholder="Seleccionar almacén"
                                        required
                                    />
                                </div>

                                <div className="modal-input-group">
                                    <Select
                                        label={<><Package size={12} /> Producto *</>}
                                        options={products.map((p) => ({ value: p.id.toString(), label: `${p.name} (${p.unit})` }))}
                                        value={
                                            formData.productId
                                                ? {
                                                    value: formData.productId,
                                                    label: (() => {
                                                        const prod = products.find((p) => p.id.toString() === formData.productId);
                                                        return prod ? `${prod.name} (${prod.unit})` : '';
                                                    })(),
                                                }
                                                : null
                                        }
                                        onChange={(option: SingleValue<StrOption>) =>
                                            option && setFormData({ ...formData, productId: option.value })
                                        }
                                        placeholder="Seleccionar producto"
                                        required
                                    />
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
                                    <Select
                                        label={<><Package size={12} /> Unidad</>}
                                        options={productUnits.map((u) => ({
                                            value: u.abbreviation,
                                            label: u.isBase ? `${u.abbreviation} (base)` : u.abbreviation
                                        }))}
                                        value={
                                            formData.unit
                                                ? {
                                                    value: formData.unit,
                                                    label: (() => {
                                                        const u = productUnits.find((x) => x.abbreviation === formData.unit);
                                                        return u ? (u.isBase ? `${u.abbreviation} (base)` : u.abbreviation) : formData.unit;
                                                    })()
                                                }
                                                : null
                                        }
                                        onChange={(option: SingleValue<StrOption>) =>
                                            option && setFormData({ ...formData, unit: option.value })
                                        }
                                        placeholder={formData.productId ? 'Unidad base' : 'Seleccione producto'}
                                        isDisabled={!formData.productId || productUnits.length === 0}
                                        isSearchable={false}
                                    />
                                </div>
                            </div>

                            <div className="modal-form-row">
                                <div className="modal-input-group">
                                    <Select
                                        label={<><AlertTriangle size={12} /> Razón *</>}
                                        options={wasteReasons.map((reason) => ({ value: reason, label: reason }))}
                                        value={formData.reason ? { value: formData.reason, label: formData.reason } : null}
                                        onChange={(option: SingleValue<StrOption>) =>
                                            option && setFormData({ ...formData, reason: option.value })
                                        }
                                        placeholder="Seleccionar razón"
                                        required
                                        isSearchable={false}
                                    />
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
                            <Button type="submit" disabled={loading}>
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
                            <Select
                                label={<><WarehouseIcon size={12} /> Almacén</>}
                                options={[
                                    { value: '', label: 'Todos los Almacenes' },
                                    ...warehouses.map((w) => ({ value: w.id.toString(), label: w.name }))
                                ]}
                                value={
                                    filters.warehouseId
                                        ? { value: filters.warehouseId, label: warehouses.find(w => w.id.toString() === filters.warehouseId)?.name || 'Todos' }
                                        : { value: '', label: 'Todos los Almacenes' }
                                }
                                onChange={(option: SingleValue<StrOption>) => option && setFilters({ ...filters, warehouseId: option.value })}
                            />
                        </div>

                        <div className="filter-field">
                            <Select
                                label={<><Package size={12} /> Producto</>}
                                options={[
                                    { value: '', label: 'Todos los Productos' },
                                    ...products.map((p) => ({ value: p.id.toString(), label: p.name }))
                                ]}
                                value={
                                    filters.productId
                                        ? { value: filters.productId, label: products.find(p => p.id.toString() === filters.productId)?.name || 'Todos' }
                                        : { value: '', label: 'Todos los Productos' }
                                }
                                onChange={(option: SingleValue<StrOption>) => option && setFilters({ ...filters, productId: option.value })}
                            />
                        </div>

                        <div className="filter-spacer" />

                        <div className="filter-actions">
                            <Button onClick={loadReport} disabled={loading}>
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
                                        <Package size={14} /> Total Unidades
                                    </div>
                                    <div className="kpi-value">{report.summary.totalUnits.toFixed(2)}</div>
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
                                <div className="data-table-scroll">
                                    <table className="data-table">
                                        <thead>
                                            <tr>
                                                <th>Razón</th>
                                                <th className="text-right">Entradas</th>
                                                <th className="text-right">Unidades</th>
                                                <th className="text-right">Costo</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {report.byReason.map((item, idx) => (
                                                <tr key={idx}>
                                                    <td>{item.reason}</td>
                                                    <td className="text-right">{item.count}</td>
                                                    <td className="text-right">{item.quantity.toFixed(2)}</td>
                                                    <td className="text-right font-semibold">{formatCurrency(item.cost, settings)}</td>
                                                </tr>
                                            ))}
                                            {report.byReason.length === 0 && (
                                                <tr><td colSpan={4} className="data-table-empty">Sin datos para los filtros seleccionados</td></tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Details */}
                            <div className="data-table-wrapper">
                                <div className="data-table-header">
                                    <span><FileText size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />Detalle de Mermas</span>
                                    <span className="data-table-count">{report.details.length} registros</span>
                                </div>
                                <div className="data-table-scroll">
                                    <table className="data-table">
                                        <thead>
                                            <tr>
                                                <th>Fecha</th>
                                                <th>Producto</th>
                                                <th className="text-right">Cantidad</th>
                                                <th className="text-right">Costo</th>
                                                <th>Razón</th>
                                                <th>Almacén</th>
                                                <th>Usuario</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {pagedDetails.map((entry) => (
                                                <tr key={entry.id}>
                                                    <td>{new Date(entry.date).toLocaleDateString()}</td>
                                                    <td>{entry.product}</td>
                                                    <td className="text-right">
                                                        {entry.quantity.toFixed(2)} {entry.unit}
                                                    </td>
                                                    <td className="text-right font-semibold">{formatCurrency(entry.cost, settings)}</td>
                                                    <td>{entry.reason}</td>
                                                    <td>{entry.warehouse}</td>
                                                    <td>{entry.user}</td>
                                                </tr>
                                            ))}
                                            {detailEntries.length === 0 && (
                                                <tr><td colSpan={7} className="data-table-empty">Sin registros de merma en el período seleccionado</td></tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                                <Pagination
                                    page={page}
                                    totalPages={totalPages}
                                    totalItems={detailEntries.length}
                                    pageSize={PAGE_SIZE}
                                    onPageChange={setPage}
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
