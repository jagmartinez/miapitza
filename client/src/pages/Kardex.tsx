import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { warehousesAPI, reportsAPI, settingsAPI } from '../services/api';
import Select from '../components/Select';
import Button from '../components/Button';
import Pagination from '../components/Pagination';
import { ToastContainer } from '../components/Toast';
import { useToast } from '../hooks/useToast';
import { formatCurrency, type CurrencySettings } from '../utils/currency';
import { FileText, Download, Calendar, Filter, ArrowLeft } from 'lucide-react';
import type { SingleValue } from 'react-select';
import './Kardex.css';

interface WarehouseRow {
    id: number;
    name: string;
}

type WarehouseSelectOption = { value: number | null; label: string };
type StrOption = { value: string; label: string };

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

const PAGE_SIZE = 20;

export default function Kardex() {
    const navigate = useNavigate();
    const { toasts, removeToast, success: showSuccess, error: showError } = useToast();
    const showErrorRef = useRef(showError);
    showErrorRef.current = showError;

    const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
    const [kardexData, setKardexData] = useState<KardexData | null>(null);
    const [loading, setLoading] = useState(false);

    // Filters
    const [selectedProduct, setSelectedProduct] = useState<number | null>(null);
    const [selectedWarehouse, setSelectedWarehouse] = useState<number | null>(null);
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [movementType, setMovementType] = useState<string>('');
    const [currentPage, setCurrentPage] = useState(1);
    const [settings, setSettings] = useState<CurrencySettings>({});

    const loadSettings = useCallback(async () => {
        try {
            const res = await settingsAPI.getAll();
            setSettings(res.data.data || {});
        } catch (error) {
            console.error('Error loading settings:', error);
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
            setCurrentPage(1);
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : 'Error al cargar kardex';
            showErrorRef.current(msg);
        } finally {
            setLoading(false);
        }
    }, [dateFrom, dateTo, movementType, selectedProduct, selectedWarehouse]);

    useEffect(() => {
        void loadWarehouses();
        void loadSettings();

        const params = new URLSearchParams(window.location.search);
        const productId = params.get('productId');
        if (productId) {
            setSelectedProduct(parseInt(productId));
        }
    }, [loadWarehouses, loadSettings]);

    useEffect(() => {
        if (selectedProduct) {
            void loadKardex();
        }
    }, [loadKardex, selectedProduct]);

    useEffect(() => {
        setCurrentPage(1);
    }, [dateFrom, dateTo, movementType, selectedWarehouse, kardexData?.movements.length]);

    const movements = kardexData?.movements ?? [];
    // Stock/balances are kept in the product's base unit; prefer its real
    // abbreviation and fall back to the legacy `unit` field.
    const unitLabel = kardexData?.baseUnitAbbr || kardexData?.product.unit || '';
    const totalPages = Math.max(1, Math.ceil(movements.length / PAGE_SIZE));
    const pagedMovements = movements.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

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
            a.download = `Kardex_${kardexData?.product.name}_${new Date().toISOString().split('T')[0]}.xlsx`;
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
            <div className="kardex-header">
                <div className="header-title-section">
                    <h1>
                        <FileText size={32} />
                        Kardex de Inventario {kardexData ? `: ${kardexData.product.name}` : ''}
                    </h1>
                    <p className="header-subtitle">Reporte detallado de movimientos</p>
                </div>
            </div>

            {/* Filters */}
            <div className="kardex-filters">
                <div className="filter-row">
                    <Select
                        label="Almacén"
                        options={[
                            { value: null, label: 'Todos los almacenes' },
                            ...warehouses.map(w => ({ value: w.id, label: w.name }))
                        ]}
                        value={selectedWarehouse ? { value: selectedWarehouse, label: warehouses.find(w => w.id === selectedWarehouse)?.name || '' } : { value: null, label: 'Todos los almacenes' }}
                        onChange={(option: SingleValue<WarehouseSelectOption>) => setSelectedWarehouse(option?.value ?? null)}
                    />

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

                    <Select
                        label="Tipo"
                        options={[
                            { value: '', label: 'Todos' },
                            { value: 'IN', label: 'Entrada' },
                            { value: 'OUT', label: 'Salida' },
                            { value: 'ADJUSTMENT', label: 'Ajuste' },
                            { value: 'TRANSFER', label: 'Transferencia' }
                        ]}
                        value={{ value: movementType, label: movementType || 'Todos' }}
                        onChange={(option: SingleValue<StrOption>) => setMovementType(option?.value || '')}
                    />

                    <Button onClick={loadKardex} disabled={!selectedProduct || loading}>
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
                            <span className="balance-qty">{kardexData.openingBalance.quantity.toFixed(3)} {unitLabel}</span>
                            <span className="balance-cost">{formatCurrency(kardexData.openingBalance.cost, settings)}</span>
                        </div>

                        <div className="balance-card total-in">
                            <span className="balance-label">Total Entradas</span>
                            <span className="balance-value in">{kardexData.totals.totalIn.toFixed(3)} {unitLabel}</span>
                        </div>

                        <div className="balance-card total-out">
                            <span className="balance-label">Total Salidas</span>
                            <span className="balance-value out">{kardexData.totals.totalOut.toFixed(3)} {unitLabel}</span>
                        </div>

                        <div className="balance-card closing">
                            <span className="balance-label">Saldo Final</span>
                            <span className="balance-qty">{kardexData.closingBalance.quantity.toFixed(3)} {unitLabel}</span>
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
                    <div className="data-table-scroll">
                        <table className="data-table kardex-table">
                            <thead>
                                <tr>
                                    <th>Fecha</th>
                                    <th>Tipo</th>
                                    <th>Referencia</th>
                                    <th className="text-right">Entrada</th>
                                    <th className="text-right">Salida</th>
                                    <th className="text-right">Saldo</th>
                                    <th className="text-right">Costo Unit.</th>
                                    <th className="text-right">Costo Total</th>
                                    <th>Almacén</th>
                                    <th>Sucursal</th>
                                    <th>Usuario</th>
                                </tr>
                            </thead>
                            <tbody>
                                {pagedMovements.map((movement) => {
                                    // Show the user-entered "original" unit/quantity when it
                                    // differs from the base unit the kardex is expressed in.
                                    const showOriginal = !!movement.originalUnit
                                        && movement.originalUnit !== unitLabel
                                        && movement.originalQuantity != null;
                                    const originalHint = showOriginal ? (
                                        <span className="kardex-original-unit" style={{ display: 'block', fontSize: '11px', color: 'var(--color-neutral-500)' }}>
                                            ({movement.originalQuantity} {movement.originalUnit})
                                        </span>
                                    ) : null;
                                    return (
                                    <tr key={movement.id}>
                                        <td>{new Date(movement.date).toLocaleDateString()}</td>
                                        <td>
                                            <span className={`movement-type ${movement.type.toLowerCase()}`}>
                                                {movement.type}
                                            </span>
                                        </td>
                                        <td>{movement.reference}</td>
                                        <td className={`text-right ${movement.in ? 'movement-in' : ''}`}>
                                            {movement.in ? `${movement.in.toFixed(3)} ${unitLabel}` : '-'}
                                            {movement.in ? originalHint : null}
                                        </td>
                                        <td className={`text-right ${movement.out ? 'movement-out' : ''}`}>
                                            {movement.out ? `${movement.out.toFixed(3)} ${unitLabel}` : '-'}
                                            {movement.out ? originalHint : null}
                                        </td>
                                        <td className="text-right font-bold">{movement.balance.toFixed(3)} {unitLabel}</td>
                                        <td className="text-right">{formatCurrency(movement.unitCost, settings)}</td>
                                        <td className="text-right">{formatCurrency(movement.totalCost, settings)}</td>
                                        <td>{movement.warehouse}</td>
                                        <td>{movement.branch}</td>
                                        <td>{movement.user}</td>
                                    </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    <Pagination
                        page={currentPage}
                        totalPages={totalPages}
                        totalItems={movements.length}
                        pageSize={PAGE_SIZE}
                        onPageChange={setCurrentPage}
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
                    <p>Selecciona un producto para ver su kardex</p>
                </div>
            ) : null}

            <ToastContainer toasts={toasts} onRemove={removeToast} />
        </div>
    );
}
