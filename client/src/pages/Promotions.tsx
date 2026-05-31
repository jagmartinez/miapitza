import { useState, useEffect } from 'react';
import { promotionsAPI } from '../services/api';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useAppToast } from '../context/ToastContext';
import Button from '../components/Button';
import Sidebar from '../components/Sidebar';
import { Plus, Edit, Percent, DollarSign, Ticket, XCircle, Calendar, FileText } from 'lucide-react';
import './Promotions.css';

interface PromotionRow {
    id: number;
    code: string;
    name: string;
    description?: string | null;
    type: 'PERCENTAGE' | 'FIXED_AMOUNT';
    value: number;
    minOrderAmount?: number | null;
    maxDiscount?: number | null;
    validFrom?: string | null;
    validTo?: string | null;
    usageLimit?: number | null;
    usageCount?: number;
    active: boolean;
}

interface PromotionPayload {
    code: string;
    name: string;
    description: string | null;
    type: 'PERCENTAGE' | 'FIXED_AMOUNT';
    value: number;
    minOrderAmount: number | null;
    maxDiscount: number | null;
    validFrom: Date;
    validTo: Date | null;
    usageLimit: number | null;
}

function axiosMsg(err: unknown, fallback: string): string {
    if (typeof err === 'object' && err !== null && 'response' in err) {
        const m = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
        if (typeof m === 'string' && m) return m;
    }
    return fallback;
}

function toApiPayload(payload: PromotionPayload): Record<string, unknown> {
    return payload as unknown as Record<string, unknown>;
}

export default function Promotions() {
    const { confirm } = useConfirmDialog();
    const { error: showError } = useAppToast();
    const [promotions, setPromotions] = useState<PromotionRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [editing, setEditing] = useState<PromotionRow | null>(null);
    const [formData, setFormData] = useState({
        code: '', name: '', description: '',
        type: 'PERCENTAGE' as 'PERCENTAGE' | 'FIXED_AMOUNT',
        value: '', minOrderAmount: '', maxDiscount: '',
        validFrom: '', validTo: '', usageLimit: '',
    });
    const [saving, setSaving] = useState(false);
    const [activeTab, setActiveTab] = useState<'identidad' | 'reglas' | 'vigencia'>('identidad');

    useEffect(() => { loadData(); }, []);

    const loadData = async () => {
        try {
            const res = await promotionsAPI.getAll(false); // Get all, including inactive
            setPromotions(res.data.data || []);
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    };

    const handleOpen = (promo?: PromotionRow) => {
        if (promo) {
            setEditing(promo);
            setFormData({
                code: promo.code, name: promo.name, description: promo.description || '',
                type: promo.type,
                value: String(promo.value),
                minOrderAmount: promo.minOrderAmount ? String(promo.minOrderAmount) : '',
                maxDiscount: promo.maxDiscount ? String(promo.maxDiscount) : '',
                validFrom: promo.validFrom ? new Date(promo.validFrom).toISOString().slice(0, 10) : '',
                validTo: promo.validTo ? new Date(promo.validTo).toISOString().slice(0, 10) : '',
                usageLimit: promo.usageLimit ? String(promo.usageLimit) : '',
            });
        } else {
            setEditing(null);
            setFormData({
                code: '', name: '', description: '',
                type: 'PERCENTAGE', value: '', minOrderAmount: '',
                maxDiscount: '', validFrom: '', validTo: '', usageLimit: '',
            });
        }
        setActiveTab('identidad');
        setIsSidebarOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const payload: PromotionPayload = {
            code: formData.code.toUpperCase(),
            name: formData.name,
            description: formData.description || null,
            type: formData.type,
            value: parseFloat(formData.value),
            minOrderAmount: formData.minOrderAmount ? parseFloat(formData.minOrderAmount) : null,
            maxDiscount: formData.maxDiscount ? parseFloat(formData.maxDiscount) : null,
            validFrom: formData.validFrom ? new Date(formData.validFrom) : new Date(),
            validTo: formData.validTo ? new Date(formData.validTo) : null,
            usageLimit: formData.usageLimit ? parseInt(formData.usageLimit) : null,
        };
        setSaving(true);
        try {
            if (editing) {
                await promotionsAPI.update(editing.id, toApiPayload(payload));
            } else {
                await promotionsAPI.create(toApiPayload(payload));
            }
            setIsSidebarOpen(false);
            loadData();
        } catch (err: unknown) {
            showError(axiosMsg(err, 'Error al guardar'));
        } finally {
            setSaving(false);
        }
    };

    const handleDeactivate = async (id: number) => {
        if (!(await confirm('¿Desactivar esta promoción?', { title: 'Confirmar acción' }))) return;
        try {
            await promotionsAPI.deactivate(id);
            loadData();
        } catch (err: unknown) {
            showError(axiosMsg(err, 'Error'));
        }
    };

    const getStatus = (p: PromotionRow) => {
        if (!p.active) return 'inactive';
        if (p.validTo && new Date(p.validTo) < new Date()) return 'expired';
        return 'active';
    };

    const formatDate = (d?: string | null) => d ? new Date(d).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

    if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-secondary)' }}>Cargando...</div>;

    return (
        <div className="promotions-page">
            <div className="promo-header">
                <div>
                    <h1><Ticket size={28} /> Promociones</h1>
                    <p>Gestiona códigos de descuento y ofertas especiales</p>
                </div>
                <Button onClick={() => handleOpen()}>
                    <Plus size={18} /> Nueva Promoción
                </Button>
            </div>

            {promotions.length === 0 ? (
                <div className="promo-empty">
                    <Ticket size={64} />
                    <p>No hay promociones creadas</p>
                </div>
            ) : (
                <div className="promo-grid">
                    {promotions.map(p => {
                        const status = getStatus(p);
                        const usageCount = p.usageCount || 0;
                        const usagePct = p.usageLimit ? Math.min(100, (usageCount / p.usageLimit) * 100) : 0;
                        return (
                            <div key={p.id} className={`promo-card ${status === 'inactive' ? 'inactive' : ''}`}>
                                <div className="promo-card-top">
                                    <span className="promo-code-badge">{p.code}</span>
                                    <span className={`promo-type-badge ${p.type === 'PERCENTAGE' ? 'percentage' : 'fixed'}`}>
                                        {p.type === 'PERCENTAGE' ? 'Porcentaje' : 'Monto Fijo'}
                                    </span>
                                </div>

                                <div className="promo-card-body">
                                    <div className="promo-name">{p.name}</div>
                                    {p.description && <div className="promo-desc">{p.description}</div>}

                                    <div className="promo-value-display">
                                        {p.type === 'PERCENTAGE' ? `${Number(p.value)}%` : `$${Number(p.value).toFixed(0)}`}
                                    </div>

                                    <div className="promo-details">
                                        <div className="promo-detail-row">
                                            <span className="label">Estado</span>
                                            <span className={`promo-status ${status}`}>
                                                {status === 'active' ? 'Activa' : status === 'expired' ? 'Expirada' : 'Inactiva'}
                                            </span>
                                        </div>
                                        <div className="promo-detail-row">
                                            <span className="label">Vigencia</span>
                                            <span className="value">{formatDate(p.validFrom)} — {formatDate(p.validTo)}</span>
                                        </div>
                                        {p.minOrderAmount && (
                                            <div className="promo-detail-row">
                                                <span className="label">Mínimo</span>
                                                <span className="value">${Number(p.minOrderAmount).toFixed(0)}</span>
                                            </div>
                                        )}
                                        {p.maxDiscount && (
                                            <div className="promo-detail-row">
                                                <span className="label">Desc. máximo</span>
                                                <span className="value">${Number(p.maxDiscount).toFixed(0)}</span>
                                            </div>
                                        )}
                                        <div className="promo-detail-row">
                                            <span className="label">Usos</span>
                                            <span className="value">{usageCount}{p.usageLimit ? ` / ${p.usageLimit}` : ' (ilimitado)'}</span>
                                        </div>
                                        {p.usageLimit && (
                                            <div className="promo-usage-bar">
                                                <div className="promo-usage-fill" style={{ width: `${usagePct}%` }} />
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="promo-card-actions">
                                    <button className="promo-action-btn" onClick={() => handleOpen(p)}>
                                        <Edit size={15} /> Editar
                                    </button>
                                    {p.active && (
                                        <button className="promo-action-btn deactivate" onClick={() => handleDeactivate(p.id)}>
                                            <XCircle size={15} /> Desactivar
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            <Sidebar isOpen={isSidebarOpen} onClose={() => { setIsSidebarOpen(false); setActiveTab('identidad'); }} title={editing ? 'Editar Promoción' : 'Nueva Promoción'}>
                <div className="premium-modal-content">
                    <div className="modal-tabs">
                        <button
                            type="button"
                            className={`modal-tab ${activeTab === 'identidad' ? 'active' : ''}`}
                            onClick={() => setActiveTab('identidad')}
                        >
                            <FileText size={18} />
                            <span>Identidad</span>
                        </button>
                        <button
                            type="button"
                            className={`modal-tab ${activeTab === 'reglas' ? 'active' : ''}`}
                            onClick={() => setActiveTab('reglas')}
                        >
                            <Percent size={18} />
                            <span>Reglas</span>
                        </button>
                        <button
                            type="button"
                            className={`modal-tab ${activeTab === 'vigencia' ? 'active' : ''}`}
                            onClick={() => setActiveTab('vigencia')}
                        >
                            <Calendar size={18} />
                            <span>Vigencia</span>
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} className="modal-form-new">
                        <div className="modal-tab-content">
                            {activeTab === 'identidad' && (
                                <div className="modal-section animate-slide-in">
                                    <div className="modal-section-header">
                                        <FileText size={16} />
                                        <h3>Identidad de la Promoción</h3>
                                    </div>
                                    <div className="modal-form-row">
                                        <div className="modal-input-group">
                                            <label className="modal-input-label" htmlFor="promo-code">Código</label>
                                            <input id="promo-code" className="modal-standard-input" value={formData.code} style={{ textTransform: 'uppercase', fontFamily: 'monospace' }}
                                                onChange={e => setFormData({ ...formData, code: e.target.value })} placeholder="PROMO10" required autoFocus />
                                        </div>
                                        <div className="modal-input-group">
                                            <label className="modal-input-label" htmlFor="promo-name">Nombre</label>
                                            <input id="promo-name" className="modal-standard-input" value={formData.name}
                                                onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="Happy Hour" required />
                                        </div>
                                    </div>
                                    <div className="modal-input-group">
                                        <label className="modal-input-label" htmlFor="promo-description">Descripción</label>
                                        <input id="promo-description" className="modal-standard-input" value={formData.description}
                                            onChange={e => setFormData({ ...formData, description: e.target.value })} placeholder="Opcional..." />
                                    </div>
                                </div>
                            )}

                            {activeTab === 'reglas' && (
                                <div className="modal-section animate-slide-in">
                                    <div className="modal-section-header">
                                        <Percent size={16} />
                                        <h3>Reglas de Descuento</h3>
                                    </div>
                                    <div className="modal-input-group">
                                        <label className="modal-input-label" id="promo-discount-type-label">Tipo de Descuento</label>
                                        <div className="promo-type-toggle" role="group" aria-labelledby="promo-discount-type-label">
                                            <button type="button" className={`promo-type-btn ${formData.type === 'PERCENTAGE' ? 'active' : ''}`}
                                                onClick={() => setFormData({ ...formData, type: 'PERCENTAGE' })}>
                                                <Percent size={14} /> Porcentaje
                                            </button>
                                            <button type="button" className={`promo-type-btn ${formData.type === 'FIXED_AMOUNT' ? 'active' : ''}`}
                                                onClick={() => setFormData({ ...formData, type: 'FIXED_AMOUNT' })}>
                                                <DollarSign size={14} /> Monto Fijo
                                            </button>
                                        </div>
                                    </div>
                                    <div className="modal-form-row">
                                        <div className="modal-input-group">
                                            <label className="modal-input-label" htmlFor="promo-value">{formData.type === 'PERCENTAGE' ? 'Porcentaje (%)' : 'Monto ($)'}</label>
                                            <input id="promo-value" className="modal-standard-input" type="number" step="0.01" min="0" value={formData.value}
                                                onChange={e => setFormData({ ...formData, value: e.target.value })} required />
                                        </div>
                                        <div className="modal-input-group">
                                            <label className="modal-input-label" htmlFor="promo-min-order">Mínimo de Orden ($)</label>
                                            <input id="promo-min-order" className="modal-standard-input" type="number" step="0.01" min="0" value={formData.minOrderAmount}
                                                onChange={e => setFormData({ ...formData, minOrderAmount: e.target.value })} placeholder="Opcional" />
                                        </div>
                                    </div>
                                    <div className="modal-form-row">
                                        <div className="modal-input-group">
                                            <label className="modal-input-label" htmlFor="promo-max-discount">Desc. Máximo ($)</label>
                                            <input id="promo-max-discount" className="modal-standard-input" type="number" step="0.01" min="0" value={formData.maxDiscount}
                                                onChange={e => setFormData({ ...formData, maxDiscount: e.target.value })} placeholder="Opcional" />
                                        </div>
                                        <div className="modal-input-group">
                                            <label className="modal-input-label" htmlFor="promo-usage-limit">Límite de Usos</label>
                                            <input id="promo-usage-limit" className="modal-standard-input" type="number" min="0" value={formData.usageLimit}
                                                onChange={e => setFormData({ ...formData, usageLimit: e.target.value })} placeholder="Ilimitado" />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'vigencia' && (
                                <div className="modal-section animate-slide-in">
                                    <div className="modal-section-header">
                                        <Calendar size={16} />
                                        <h3>Período de Vigencia</h3>
                                    </div>
                                    <div className="modal-form-row">
                                        <div className="modal-input-group">
                                            <label className="modal-input-label" htmlFor="promo-valid-from">Vigente Desde</label>
                                            <input id="promo-valid-from" className="modal-standard-input" type="date" value={formData.validFrom}
                                                onChange={e => setFormData({ ...formData, validFrom: e.target.value })} />
                                        </div>
                                        <div className="modal-input-group">
                                            <label className="modal-input-label" htmlFor="promo-valid-to">Vigente Hasta</label>
                                            <input id="promo-valid-to" className="modal-standard-input" type="date" value={formData.validTo}
                                                onChange={e => setFormData({ ...formData, validTo: e.target.value })} />
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="modal-footer">
                            <Button type="button" variant="ghost" onClick={() => { setIsSidebarOpen(false); setActiveTab('identidad'); }}>
                                Cancelar
                            </Button>
                            <Button type="submit" variant="primary" disabled={saving}>
                                {saving ? 'Guardando...' : editing ? 'Actualizar' : 'Crear Promoción'}
                            </Button>
                        </div>
                    </form>
                </div>
            </Sidebar>
        </div>
    );
}
