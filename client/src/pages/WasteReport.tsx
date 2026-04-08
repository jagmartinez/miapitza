import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { formatCurrency, type CurrencySettings } from '../utils/currency';
import type { SingleValue } from 'react-select';
import Select from '../components/Select';
import '../index.css';

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

const WasteReport: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'record' | 'report'>('record');
    const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [wasteReasons, setWasteReasons] = useState<string[]>([]);
    const [report, setReport] = useState<WasteReport | null>(null);
    const [settings, setSettings] = useState<CurrencySettings>({});
    const [loading, setLoading] = useState(false);

    // Form state for recording waste
    const [formData, setFormData] = useState({
        warehouseId: '',
        productId: '',
        quantity: '',
        reason: '',
        notes: ''
    });

    // Report filters
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
                notes: formData.notes
            });

            alert('Merma registrada exitosamente');
            setFormData({
                warehouseId: '',
                productId: '',
                quantity: '',
                reason: '',
                notes: ''
            });

            // Reload report if on report tab
            if (activeTab === 'report') {
                loadReport();
            }
        } catch (error: unknown) {
            alert('Error al registrar merma: ' + errMsg(error));
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
            alert('Error al cargar reporte: ' + errMsg(error));
        } finally {
            setLoading(false);
        }
    }, [filters.endDate, filters.productId, filters.startDate, filters.warehouseId]);

    useEffect(() => {
        void loadInitialData();
        void loadSettings();
    }, [loadInitialData, loadSettings]);

    useEffect(() => {
        if (activeTab === 'report') {
            void loadReport();
        }
    }, [activeTab, loadReport]);

    return (
        <div className="page-container">
            <div className="page-header">
                <h1>📊 Reporte de Merma y Desperdicio</h1>
                <p>Registra y analiza las pérdidas de inventario</p>
            </div>

            {/* Tabs */}
            <div className="tabs">
                <button
                    className={`tab ${activeTab === 'record' ? 'active' : ''}`}
                    onClick={() => setActiveTab('record')}
                >
                    📝 Registrar Merma
                </button>
                <button
                    className={`tab ${activeTab === 'report' ? 'active' : ''}`}
                    onClick={() => setActiveTab('report')}
                >
                    📈 Ver Reporte
                </button>
            </div>

            {/* Record Waste Tab */}
            {activeTab === 'record' && (
                <div className="card">
                    <h2>Registrar Nueva Merma</h2>
                    <form onSubmit={handleRecordWaste} className="form">
                        <div className="form-row">
                            {(() => {
                                const wh = warehouses.find(w => w.id.toString() === formData.warehouseId);
                                return (
                                    <Select
                                        label="Almacén *"
                                        options={warehouses.map((w) => ({ value: w.id.toString(), label: w.name }))}
                                        value={wh ? { value: formData.warehouseId, label: wh.name } : null}
                                        onChange={(option: SingleValue<StrOption>) => option && setFormData({ ...formData, warehouseId: option.value })}
                                        placeholder="Seleccionar almacén"
                                        required
                                    />
                                );
                            })()}

                            {(() => {
                                const prod = products.find(p => p.id.toString() === formData.productId);
                                return (
                                    <Select
                                        label="Producto *"
                                        options={products.map((p) => ({ value: p.id.toString(), label: `${p.name} (${p.unit})` }))}
                                        value={prod ? { value: formData.productId, label: `${prod.name} (${prod.unit})` } : null}
                                        onChange={(option: SingleValue<StrOption>) => option && setFormData({ ...formData, productId: option.value })}
                                        placeholder="Seleccionar producto"
                                        required
                                    />
                                );
                            })()}
                        </div>

                        <div className="form-row">
                            <div className="form-group">
                                <label>Cantidad *</label>
                                <input
                                    type="number"
                                    step="0.001"
                                    value={formData.quantity}
                                    onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                                    required
                                    min="0.001"
                                />
                            </div>

                            <Select
                                label="Razón *"
                                options={wasteReasons.map((reason) => ({ value: reason, label: reason }))}
                                value={formData.reason ? { value: formData.reason, label: formData.reason } : null}
                                onChange={(option: SingleValue<StrOption>) => option && setFormData({ ...formData, reason: option.value })}
                                placeholder="Seleccionar razón"
                                required
                                isSearchable={false}
                            />
                        </div>

                        <div className="form-group">
                            <label>Notas</label>
                            <textarea
                                value={formData.notes}
                                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                rows={3}
                                placeholder="Detalles adicionales..."
                            />
                        </div>

                        <button type="submit" className="btn btn-primary" disabled={loading}>
                            {loading ? 'Guardando...' : '💾 Registrar Merma'}
                        </button>
                    </form>
                </div>
            )}

            {/* Report Tab */}
            {activeTab === 'report' && (
                <>
                    {/* Filters */}
                    <div className="card">
                        <h2>Filtros</h2>
                        <div className="form-row">
                            <div className="form-group">
                                <label>Fecha Inicio</label>
                                <input
                                    type="date"
                                    value={filters.startDate}
                                    onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                                />
                            </div>

                            <div className="form-group">
                                <label>Fecha Fin</label>
                                <input
                                    type="date"
                                    value={filters.endDate}
                                    onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                                />
                            </div>

                            <Select
                                label="Almacén"
                                options={[
                                    { value: '', label: 'Todos' },
                                    ...warehouses.map((w) => ({ value: w.id.toString(), label: w.name }))
                                ]}
                                value={filters.warehouseId ? { value: filters.warehouseId, label: warehouses.find(w => w.id.toString() === filters.warehouseId)?.name || 'Todos' } : { value: '', label: 'Todos' }}
                                onChange={(option: SingleValue<StrOption>) => option && setFilters({ ...filters, warehouseId: option.value })}
                            />

                            <Select
                                label="Producto"
                                options={[
                                    { value: '', label: 'Todos' },
                                    ...products.map((p) => ({ value: p.id.toString(), label: p.name }))
                                ]}
                                value={filters.productId ? { value: filters.productId, label: products.find(p => p.id.toString() === filters.productId)?.name || 'Todos' } : { value: '', label: 'Todos' }}
                                onChange={(option: SingleValue<StrOption>) => option && setFilters({ ...filters, productId: option.value })}
                            />
                        </div>

                        <button onClick={loadReport} className="btn btn-primary" disabled={loading}>
                            {loading ? 'Cargando...' : '🔍 Generar Reporte'}
                        </button>
                    </div>

                    {/* Summary */}
                    {report && (
                        <>
                            <div className="stats-grid">
                                <div className="stat-card">
                                    <div className="stat-icon">📋</div>
                                    <div className="stat-content">
                                        <div className="stat-label">Total Entradas</div>
                                        <div className="stat-value">{report.summary.totalEntries}</div>
                                    </div>
                                </div>

                                <div className="stat-card">
                                    <div className="stat-icon">📦</div>
                                    <div className="stat-content">
                                        <div className="stat-label">Total Unidades</div>
                                        <div className="stat-value">{report.summary.totalUnits.toFixed(2)}</div>
                                    </div>
                                </div>

                                <div className="stat-card">
                                    <div className="stat-icon">💰</div>
                                    <div className="stat-content">
                                        <div className="stat-label">Costo Total</div>
                                        <div className="stat-value">{formatCurrency(report.summary.totalCost, settings)}</div>
                                    </div>
                                </div>
                            </div>

                            {/* By Reason */}
                            <div className="card">
                                <h2>Merma por Razón</h2>
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Razón</th>
                                            <th>Cantidad de Entradas</th>
                                            <th>Unidades</th>
                                            <th>Costo</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {report.byReason.map((item, idx) => (
                                            <tr key={idx}>
                                                <td>{item.reason}</td>
                                                <td>{item.count}</td>
                                                <td>{item.quantity.toFixed(2)}</td>
                                                <td>{formatCurrency(item.cost, settings)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* Details */}
                            <div className="card">
                                <h2>Detalle de Mermas</h2>
                                <div className="table-container">
                                    <table className="data-table">
                                        <thead>
                                            <tr>
                                                <th>Fecha</th>
                                                <th>Producto</th>
                                                <th>Cantidad</th>
                                                <th>Costo</th>
                                                <th>Razón</th>
                                                <th>Almacén</th>
                                                <th>Usuario</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {report.details.map((entry) => (
                                                <tr key={entry.id}>
                                                    <td>{new Date(entry.date).toLocaleDateString()}</td>
                                                    <td>{entry.product}</td>
                                                    <td>
                                                        {entry.quantity.toFixed(2)} {entry.unit}
                                                    </td>
                                                    <td>{formatCurrency(entry.cost, settings)}</td>
                                                    <td>{entry.reason}</td>
                                                    <td>{entry.warehouse}</td>
                                                    <td>{entry.user}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </>
                    )}
                </>
            )}
        </div>
    );
};

export default WasteReport;
