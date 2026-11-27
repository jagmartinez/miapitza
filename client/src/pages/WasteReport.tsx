import React, { useState, useEffect, useCallback, useRef } from 'react';
import { notifyError } from '../services/notify';
import api, { unitsAPI } from '../services/api';
import { formatCurrency, type CurrencySettings } from '../utils/currency';
import { Search, Save } from 'lucide-react';
import { useAppToast } from '../context/ToastContext';
import { formatLocalDateInput } from '../utils/dateInput';
import { newIdempotencyKey } from '../utils/idempotency';
import catalog from './catalog.module.css';
import {
    AppSelect, Button, DataTable, DateInput, EmptyState, Field, FormGrid, FormSection, Input, PageContent, PageHeader,
    StatCard, TableToolbar, Tabs, Textarea, formatNumber, type Column,
} from '@/ui';


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
            notifyError(error, 'No se pudieron cargar bodegas, productos o motivos de merma');
        }
    }, []);

    const loadSettings = useCallback(async () => {
        try {
            const response = await api.get('/settings');
            setSettings(response.data.data || {});
        } catch (error) {
            notifyError(error, 'No se pudo cargar la configuración; los montos usan el formato predeterminado', { type: 'warning' });
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
        <PageContent>
            <PageHeader
                title="Mermas y desperdicio"
                description="Registra y analiza las pérdidas de inventario para mejorar el control de costos."
            />

            <Tabs
                ariaLabel="Secciones de mermas"
                tabs={[
                    { id: 'record', label: 'Registrar merma' },
                    { id: 'report', label: 'Ver reporte' },
                ]}
                active={activeTab}
                onChange={(id) => setActiveTab(id as typeof activeTab)}
            />

            {/* Record Waste Tab */}
            {activeTab === 'record' && (
                <form onSubmit={handleRecordWaste} className={catalog.stack}>
                    <FormSection step={1} title="Nueva merma" description="Almacén, producto, cantidad y causa de la pérdida.">
                        <FormGrid>
                            <Field label="Almacén" htmlFor="waste-warehouse" required>
                                <AppSelect
                                    inputId="waste-warehouse"
                                    options={warehouses.map((w) => ({ value: w.id.toString(), label: w.name }))}
                                    value={formData.warehouseId || null}
                                    onChange={(v) => v && setFormData({ ...formData, warehouseId: v })}
                                    placeholder="Seleccionar almacén"
                                />
                            </Field>
                            <Field label="Producto" htmlFor="waste-product" required>
                                <AppSelect
                                    inputId="waste-product"
                                    options={products.map((p) => ({ value: p.id.toString(), label: `${p.name} (${p.unit})` }))}
                                    value={formData.productId || null}
                                    onChange={(v) => v && setFormData({ ...formData, productId: v })}
                                    placeholder="Seleccionar producto"
                                />
                            </Field>
                            <Field label="Cantidad" htmlFor="waste-quantity" required>
                                <Input
                                    id="waste-quantity"
                                    type="number"
                                    step="0.001"
                                    className="ui-input--number"
                                    value={formData.quantity}
                                    onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                                    required
                                    min="0.001"
                                    placeholder="0.000"
                                />
                            </Field>
                            <Field label="Unidad" htmlFor="waste-unit">
                                <AppSelect
                                    inputId="waste-unit"
                                    options={productUnits.map((u) => ({ value: u.abbreviation, label: u.isBase ? `${u.abbreviation} (base)` : u.abbreviation }))}
                                    value={formData.unit || null}
                                    onChange={(v) => v && setFormData({ ...formData, unit: v })}
                                    placeholder={formData.productId ? 'Unidad base' : 'Seleccione producto'}
                                    isDisabled={!formData.productId || productUnits.length === 0}
                                />
                            </Field>
                            <Field label="Razón" htmlFor="waste-reason" required>
                                <AppSelect
                                    inputId="waste-reason"
                                    options={wasteReasons.map((reason) => ({ value: reason, label: reason }))}
                                    value={formData.reason || null}
                                    onChange={(v) => v && setFormData({ ...formData, reason: v })}
                                    placeholder="Seleccionar razón"
                                />
                            </Field>
                        </FormGrid>
                        <Field label="Notas" htmlFor="waste-notes">
                            <Textarea
                                id="waste-notes"
                                value={formData.notes}
                                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                rows={3}
                                placeholder="Detalles adicionales..."
                            />
                        </Field>
                    </FormSection>
                    <div className={catalog.inline} style={{ justifyContent: 'flex-end' }}>
                        <Button variant="primary" type="submit" icon={Save} loading={loading}>
                            Registrar merma
                        </Button>
                    </div>
                </form>
            )}

            {/* Report Tab */}
            {activeTab === 'report' && (
                <>
                    {report && (
                        <div className={catalog.kpiGrid}>
                            <StatCard
                                label="Costo total de merma"
                                tone={report.summary.totalCost > 0 ? 'danger' : 'neutral'}
                                value={formatCurrency(report.summary.totalCost, settings)}
                                context={`${formatNumber(report.summary.totalEntries ?? report.details.length, 0)} registros · ${report.byReason[0] ? `mayor causa: ${report.byReason[0].reason}` : 'sin causas registradas'}`}
                            />
                        </div>
                    )}

                    <DataTable
                        ariaLabel="Detalle de mermas"
                        rows={detailEntries}
                        rowKey={(entry) => entry.id}
                        loading={loading}
                        defaultPageSize={PAGE_SIZE}
                        pageSizeOptions={[10, 20, 50, 100]}
                        empty={<EmptyState title={report ? 'Sin registros de merma en el período seleccionado' : 'Aplica los filtros para generar el reporte.'} />}
                        toolbar={(
                            <TableToolbar actions={(
                                <Button variant="primary" icon={Search} onClick={loadReport} loading={loading}>Generar reporte</Button>
                            )}>
                                <DateInput aria-label="Desde" value={filters.startDate} onChange={(e) => setFilters({ ...filters, startDate: e.target.value })} />
                                <DateInput aria-label="Hasta" value={filters.endDate} onChange={(e) => setFilters({ ...filters, endDate: e.target.value })} />
                                <AppSelect
                                    aria-label="Almacén"
                                    options={warehouses.map((w) => ({ value: w.id.toString(), label: w.name }))}
                                    value={filters.warehouseId || null}
                                    onChange={(v) => setFilters({ ...filters, warehouseId: v || '' })}
                                    placeholder="Todos los almacenes"
                                    isClearable
                                />
                                <AppSelect
                                    aria-label="Producto"
                                    options={products.map((p) => ({ value: p.id.toString(), label: p.name }))}
                                    value={filters.productId || null}
                                    onChange={(v) => setFilters({ ...filters, productId: v || '' })}
                                    placeholder="Todos los productos"
                                    isClearable
                                />
                            </TableToolbar>
                        )}
                        columns={[
                            { key: 'date', header: 'Fecha', type: 'date' },
                            { key: 'product', header: 'Producto' },
                            { key: 'quantity', header: 'Cantidad', type: 'qty', render: (entry) => `${formatNumber(entry.quantity)} ${entry.unit}` },
                            { key: 'cost', header: 'Costo', type: 'money', total: true, accessor: (entry) => entry.cost },
                            { key: 'reason', header: 'Razón' },
                            { key: 'warehouse', header: 'Almacén', hideBelow: 'lg' },
                            { key: 'user', header: 'Responsable' },
                        ] as Column<(typeof detailEntries)[number]>[]}
                        footerLabel="Total de la página"
                    />

                    {report && report.byReason.length > 0 && (
                        <FormSection title="Merma por razón" description={`${report.byReason.length} razones en el período`}>
                            <DataTable
                                ariaLabel="Merma por razón"
                                rows={report.byReason}
                                rowKey={(item) => item.reason}
                                empty={<EmptyState title="Sin datos para los filtros seleccionados" />}
                                columns={[
                                    { key: 'reason', header: 'Razón' },
                                    { key: 'count', header: 'Entradas', type: 'number', decimals: 0 },
                                    { key: 'quantity', header: 'Unidades', type: 'qty' },
                                    { key: 'unit', header: 'Unidad' },
                                    { key: 'cost', header: 'Costo', type: 'money', render: (item) => formatCurrency(item.cost, settings) },
                                ] as Column<(typeof report.byReason)[number]>[]}
                            />
                        </FormSection>
                    )}
                </>
            )}
        </PageContent>
    );
};

export default WasteReport;
