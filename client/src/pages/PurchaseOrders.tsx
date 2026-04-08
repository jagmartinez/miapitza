import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { purchaseOrdersAPI } from '../services/api';
import api from '../services/api';
import Card from '../components/Card';
import Button from '../components/Button';
import Sidebar from '../components/Sidebar';
import PurchaseOrderForm from './PurchaseOrderForm';
import PurchaseOrderImport from '../components/PurchaseOrderImport';
import { useAuth } from '../hooks/useAuth';
import { getUserRoleNames } from '../utils/authz';
import { Plus, Eye, Zap, X, ShoppingCart, FileDown, FileText } from 'lucide-react';
import { formatCurrency, type CurrencySettings } from '../utils/currency';
import type { AutoPurchaseSuggestion, PurchaseOrder } from '../types';
import './PurchaseOrders.css';

type PoSuggestionRow = AutoPurchaseSuggestion & { unit?: string };

interface PoSuggestionsData {
    summary: {
        urgentProducts: number;
        totalProducts?: number;
        totalEstimatedCost?: number | string;
    };
    suggestions: PoSuggestionRow[];
}

function errMsg(error: unknown, fallback: string): string {
    if (typeof error === 'object' && error !== null && 'response' in error) {
        const m = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
        if (typeof m === 'string' && m) return m;
    }
    if (error instanceof Error) return error.message;
    return fallback;
}

export default function PurchaseOrders() {
    const { user } = useAuth();
    const userRoleNames = getUserRoleNames(user);
    const canManagePurchaseOrders = userRoleNames.some((role) => ['SUPERADMIN', 'ADMIN'].includes(role));
    const navigate = useNavigate();
    const [orders, setOrders] = useState<PurchaseOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [showSuggestionsModal, setShowSuggestionsModal] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [editingOrderId, setEditingOrderId] = useState<number | undefined>(undefined);
    const [suggestions, setSuggestions] = useState<PoSuggestionsData | null>(null);
    const [loadingSuggestions, setLoadingSuggestions] = useState(false);
    const [isImportSidebarOpen, setIsImportSidebarOpen] = useState(false);
    const [settings, setSettings] = useState<CurrencySettings>({});

    // Pagination and Filters state
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 5;

    // Default to last month
    const [startDate, setStartDate] = useState(() => {
        const d = new Date();
        d.setMonth(d.getMonth() - 1);
        return d.toISOString().split('T')[0];
    });
    const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);

    useEffect(() => {
        loadOrders();
        loadSettings();
    }, []);

    const loadSettings = async () => {
        try {
            const response = await api.get('/settings');
            setSettings(response.data.data || {});
        } catch (error) {
            console.error('Error loading settings:', error);
        }
    };

    const loadOrders = async () => {
        try {
            const res = await purchaseOrdersAPI.getAll();
            setOrders(Array.isArray(res.data.data) ? res.data.data : []);
        } catch (error) {
            console.error('Error loading purchase orders:', error);
            setOrders([]);
        } finally {
            setLoading(false);
        }
    };

    const loadAutoSuggestions = async () => {
        if (!canManagePurchaseOrders) {
            alert('No tienes permisos para generar órdenes automáticamente');
            return;
        }
        setLoadingSuggestions(true);
        try {
            const response = await api.get('/advanced/auto-po/suggestions');
            setSuggestions(response.data.data);
            setShowSuggestionsModal(true);
        } catch (error: unknown) {
            alert('Error al cargar sugerencias: ' + errMsg(error, 'Error'));
        } finally {
            setLoadingSuggestions(false);
        }
    };

    const getStatusBadge = (status: string) => {
        const styles: Record<string, string> = {
            DRAFT: 'status-borrador',
            ISSUED: 'status-emitida',
            RECEIVED: 'status-recibida',
            CANCELLED: 'status-cancelada'
        };
        const labels: Record<string, string> = {
            DRAFT: 'Borrador',
            ISSUED: 'Emitida',
            RECEIVED: 'Recibida',
            CANCELLED: 'Cancelada'
        };
        return (
            <span className={`modern-status-badge ${styles[status] || ''}`}>
                {labels[status] ?? status}
            </span>
        );
    };

    const filteredOrders = orders.filter(order => {
        const matchesStatus = statusFilter === 'all' || order.status === statusFilter;

        const searchLower = searchQuery.toLowerCase();
        const matchesSearch =
            String(order.id).includes(searchLower) ||
            order.supplier?.name.toLowerCase().includes(searchLower) ||
            (order.invoiceNumber && order.invoiceNumber.toLowerCase().includes(searchLower));

        // Date range filter
        let matchesDate = true;
        if (startDate || endDate) {
            const orderDate = new Date(order.date);
            orderDate.setHours(0, 0, 0, 0);

            if (startDate) {
                const start = new Date(startDate);
                start.setHours(0, 0, 0, 0);
                if (orderDate < start) matchesDate = false;
            }
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(0, 0, 0, 0);
                if (orderDate > end) matchesDate = false;
            }
        }

        return matchesStatus && matchesSearch && matchesDate;
    });

    // Pagination logic
    const totalPages = Math.ceil(filteredOrders.length / itemsPerPage);
    const paginatedOrders = filteredOrders.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );

    // Reset page when filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [statusFilter, searchQuery, startDate, endDate]);

    const handleOpenForm = (id?: number) => {
        if (!canManagePurchaseOrders) {
            alert('No tienes permisos para gestionar órdenes de compra');
            return;
        }
        setEditingOrderId(id);
        setIsSidebarOpen(true);
    };

    const handleFormClose = () => {
        setIsSidebarOpen(false);
        setEditingOrderId(undefined);
    };

    const handleFormSaved = () => {
        loadOrders();
        handleFormClose();
    };

    const handleDeleteOrder = async (id: number) => {
        if (!canManagePurchaseOrders) {
            alert('No tienes permisos para eliminar órdenes');
            return;
        }
        const order = orders.find(o => o.id === id);
        if (order?.status === 'RECEIVED') {
            alert('No se pueden eliminar órdenes con estado RECIBIDA.');
            return;
        }

        if (!window.confirm('¿Está seguro de que desea eliminar esta orden de compra?')) return;

        try {
            await purchaseOrdersAPI.delete(id);
            loadOrders();
        } catch (error: unknown) {
            alert('Error al eliminar orden: ' + errMsg(error, 'Error'));
        }
    };

    if (loading) return <div>Cargando...</div>;

    return (
        <div className="purchase-orders-page">
            <header className="po-header">
                <div className="header-info">
                    <h1><ShoppingCart size={32} className="po-title-icon" /> Órdenes de Compra</h1>
                    <p className="header-subtitle">Gestión de suministros y abastecimiento</p>
                </div>
                <div className="header-actions">
                    <Button variant="secondary" onClick={loadAutoSuggestions} disabled={loadingSuggestions || !canManagePurchaseOrders}>
                        <Zap size={20} />
                        {loadingSuggestions ? 'Cargando...' : 'Auto-Generar'}
                    </Button>
                    <Button variant="secondary" onClick={() => setIsImportSidebarOpen(true)} disabled={!canManagePurchaseOrders}>
                        <FileDown size={20} />
                        Carga Masiva
                    </Button>
                    <Button onClick={() => handleOpenForm()} disabled={!canManagePurchaseOrders}>
                        <Plus size={20} />
                        Nueva Orden
                    </Button>
                </div>
            </header>

            <div className="po-controls">
                <div className="status-filters">
                    {['all', 'DRAFT', 'ISSUED', 'RECEIVED', 'CANCELLED'].map(status => (
                        <button
                            key={status}
                            className={`filter-btn ${status.toLowerCase()} ${statusFilter === status ? 'active' : ''}`}
                            onClick={() => setStatusFilter(status)}
                        >
                            {status === 'all' ? 'Todas' :
                                status === 'DRAFT' ? 'Borrador' :
                                    status === 'ISSUED' ? 'Emitida' :
                                        status === 'RECEIVED' ? 'Recibida' : 'Cancelada'}
                        </button>
                    ))}
                </div>
                <div className="search-section">
                    <div className="search-wrapper">
                        <input
                            type="text"
                            placeholder="Buscar por ID, proveedor o factura..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </div>
                <div className="date-filters">
                    <div className="date-input-group">
                        <label>Desde:</label>
                        <input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                        />
                    </div>
                    <div className="date-input-group">
                        <label>Hasta:</label>
                        <input
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                        />
                    </div>
                    {(startDate || endDate) && (
                        <button className="clear-dates" onClick={() => { setStartDate(''); setEndDate(''); }}>
                            <X size={14} />
                        </button>
                    )}
                </div>
            </div>

            <Card className="po-table-card">
                <div className="table-wrapper">
                    <table className="modern-table">
                        <thead>
                            <tr>
                                <th>Orden</th>
                                <th>Proveedor</th>
                                <th>Nº Factura</th>
                                <th>Fecha</th>
                                <th className="text-right">Total</th>
                                <th>Estado</th>
                                <th className="text-center">Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            {paginatedOrders.map(order => (
                                <tr key={order.id} onClick={() => canManagePurchaseOrders && handleOpenForm(order.id)} className="clickable-row">
                                    <td data-label="Orden">
                                        <div className="order-id">
                                            <span className="hashtag">#</span>
                                            {order.id}
                                        </div>
                                    </td>
                                    <td data-label="Proveedor">
                                        <div className="supplier-cell">
                                            <span className="supplier-name">{order.supplier?.name}</span>
                                        </div>
                                    </td>
                                    <td data-label="Nº Factura">
                                        <div className="invoice-cell">
                                            {order.invoiceNumber || <span className="text-muted">-</span>}
                                        </div>
                                    </td>
                                    <td data-label="Fecha">
                                        <div className="date-cell">
                                            {new Date(order.date).toLocaleDateString('es-ES', {
                                                day: '2-digit',
                                                month: 'short',
                                                year: 'numeric'
                                            })}
                                        </div>
                                    </td>
                                    <td data-label="Total" className="text-right">
                                        <div className="total-cell">
                                            {formatCurrency(Number(order.total) || 0, settings)}
                                        </div>
                                    </td>
                                    <td data-label="Estado">{getStatusBadge(order.status)}</td>
                                    <td className="text-center">
                                        <div className="action-buttons-group">
                                            {canManagePurchaseOrders && (
                                                <button
                                                    className="action-btn-mini edit"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleOpenForm(order.id);
                                                    }}
                                                    title={order.status === 'RECEIVED' ? 'Ver detalles' : 'Editar'}
                                                >
                                                    {order.status === 'RECEIVED' ? <Eye size={18} /> : <Zap size={18} />}
                                                    <span className="mobile-action-label">
                                                        {order.status === 'RECEIVED' ? 'Ver' : 'Editar'}
                                                    </span>
                                                </button>
                                            )}
                                            {order.invoicePdf && (
                                                <a
                                                    href={`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}${order.invoicePdf}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="action-btn-mini pdf"
                                                    onClick={(e) => e.stopPropagation()}
                                                    title="Ver Factura PDF"
                                                >
                                                    <FileText size={18} />
                                                    <span className="mobile-action-label">PDF</span>
                                                </a>
                                            )}
                                            {canManagePurchaseOrders && (
                                                <button
                                                    className={`action-btn-mini delete ${order.status === 'RECEIVED' ? 'disabled' : ''}`}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleDeleteOrder(order.id);
                                                    }}
                                                    title={order.status === 'RECEIVED' ? 'No se puede eliminar' : 'Eliminar'}
                                                    disabled={order.status === 'RECEIVED'}
                                                >
                                                    <X size={18} />
                                                    <span className="mobile-action-label">Eliminar</span>
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {filteredOrders.length === 0 && (
                                <tr>
                                    <td colSpan={6}>
                                        <div className="empty-state">
                                            <ShoppingCart size={48} />
                                            <p>No se encontraron órdenes de compra</p>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {totalPages > 1 && (
                    <div className="pagination-controls">
                        <button
                            disabled={currentPage === 1}
                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                            className="pagi-btn"
                        >
                            Anterior
                        </button>
                        <div className="page-numbers">
                            {Array.from({ length: totalPages }, (_, i) => i + 1).map(num => (
                                <button
                                    key={num}
                                    className={`page-num ${currentPage === num ? 'active' : ''}`}
                                    onClick={() => setCurrentPage(num)}
                                >
                                    {num}
                                </button>
                            ))}
                        </div>
                        <button
                            disabled={currentPage === totalPages}
                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                            className="pagi-btn"
                        >
                            Siguiente
                        </button>
                    </div>
                )}
            </Card>

            {/* Auto Suggestions Modal */}
            {showSuggestionsModal && suggestions && (
                <div className="modal-overlay" onClick={() => setShowSuggestionsModal(false)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '800px' }}>
                        <div className="modal-header">
                            <h2>⚡ Sugerencias de Órdenes de Compra Automáticas</h2>
                            <button className="close-btn" onClick={() => setShowSuggestionsModal(false)}>
                                <X size={24} />
                            </button>
                        </div>

                        <div className="modal-body">
                            <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
                                <div className="stat-card">
                                    <div className="stat-icon">📦</div>
                                    <div className="stat-content">
                                        <div className="stat-label">Productos</div>
                                        <div className="stat-value">{suggestions.summary.totalProducts}</div>
                                    </div>
                                </div>
                                <div className="stat-card warning">
                                    <div className="stat-icon">🚨</div>
                                    <div className="stat-content">
                                        <div className="stat-label">Urgentes</div>
                                        <div className="stat-value">{suggestions.summary.urgentProducts}</div>
                                    </div>
                                </div>
                                <div className="stat-card">
                                    <div className="stat-icon">💰</div>
                                    <div className="stat-content">
                                        <div className="stat-label">Costo Estimado</div>
                                        <div className="stat-value">{formatCurrency(Number(suggestions.summary.totalEstimatedCost) || 0, settings)}</div>
                                    </div>
                                </div>
                            </div>

                            <div className="table-container">
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Prioridad</th>
                                            <th>Producto</th>
                                            <th>Stock Actual</th>
                                            <th>Mínimo</th>
                                            <th>Cantidad Sugerida</th>
                                            <th>Costo Est.</th>
                                            <th>Almacén</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {suggestions.suggestions.map((item, idx: number) => (
                                            <tr key={idx} className={item.priority === 'URGENT' ? 'warning' : ''}>
                                                <td>
                                                    <span className={`badge ${item.priority === 'URGENT' ? 'error' : 'warning'}`}>
                                                        {item.priority === 'URGENT' ? '🚨 URGENTE' : '⚠️ Normal'}
                                                    </span>
                                                </td>
                                                <td>{item.productName}</td>
                                                <td>{Number(item.currentStock || 0).toFixed(2)} {item.unit}</td>
                                                <td>{Number(item.minStock || 0).toFixed(2)} {item.unit}</td>
                                                <td><strong>{item.suggestedQuantity.toFixed(2)} {item.unit}</strong></td>
                                                <td>{formatCurrency(Number(item.estimatedCost) || 0, settings)}</td>
                                                <td>{item.warehouseName}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: 'rgba(59, 130, 246, 0.1)', borderRadius: '8px' }}>
                                <p><strong>💡 Nota:</strong> Estas sugerencias se basan en productos con stock bajo. Para crear una orden de compra, usa el botón "Nueva Orden" y selecciona los productos manualmente.</p>
                            </div>
                        </div>

                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowSuggestionsModal(false)}>
                                Cerrar
                            </button>
                            <button className="btn btn-primary" disabled={!canManagePurchaseOrders} onClick={() => {
                                setShowSuggestionsModal(false);
                                navigate('/purchase-orders/new');
                            }}>
                                Crear Orden Manual
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* Purchase Order Form Sidebar */}
            <Sidebar
                isOpen={isSidebarOpen}
                onClose={handleFormClose}
                title={editingOrderId ? `Editar Orden #${editingOrderId}` : 'Nueva Orden de Compra'}
            >
                <PurchaseOrderForm
                    sidebarId={editingOrderId}
                    onClose={handleFormClose}
                    onSaved={handleFormSaved}
                />
            </Sidebar>

            {/* Bulk Import Sidebar */}
            <Sidebar
                isOpen={isImportSidebarOpen}
                onClose={() => setIsImportSidebarOpen(false)}
                title="Carga Masiva desde Excel"
                width="wide"
            >
                <PurchaseOrderImport
                    onClose={() => setIsImportSidebarOpen(false)}
                    onSaved={() => {
                        setIsImportSidebarOpen(false);
                        loadOrders();
                    }}
                    settings={settings}
                />
            </Sidebar>
        </div>
    );
}
