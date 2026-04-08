import { useState, useEffect } from 'react';
import { promotionsAPI } from '../services/api';
import Button from '../components/Button';
import Sidebar from '../components/Sidebar';
import { Plus, Edit, Percent, DollarSign, Ticket, XCircle } from 'lucide-react';
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
        try {
            if (editing) {
                await promotionsAPI.update(editing.id, toApiPayload(payload));
            } else {
                await promotionsAPI.create(toApiPayload(payload));
            }
            setIsSidebarOpen(false);
            loadData();
        } catch (err: unknown) {
            alert(axiosMsg(err, 'Error al guardar'));
        }
    };

    const handleDeactivate = async (id: number) => {
        if (!confirm('¿Desactivar esta promoción?')) return;
        try {
            await promotionsAPI.deactivate(id);
            loadData();
        } catch (err: unknown) {
            alert(axiosMsg(err, 'Error'));
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

            <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} title={editing ? 'Editar Promoción' : 'Nueva Promoción'}>
                <form onSubmit={handleSubmit} className="promo-form">
                    <div className="promo-form-row">
                        <div className="promo-form-group">
                            <label>Código</label>
                            <input className="promo-input" value={formData.code} style={{ textTransform: 'uppercase', fontFamily: 'monospace' }}
                                onChange={e => setFormData({ ...formData, code: e.target.value })} placeholder="PROMO10" required />
                        </div>
                        <div className="promo-form-group">
                            <label>Nombre</label>
                            <input className="promo-input" value={formData.name}
                                onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="Happy Hour" required />
                        </div>
                    </div>

                    <div className="promo-form-group">
                        <label>Descripción</label>
                        <input className="promo-input" value={formData.description}
                            onChange={e => setFormData({ ...formData, description: e.target.value })} placeholder="Opcional..." />
                    </div>

                    <div className="promo-form-group">
                        <label>Tipo de Descuento</label>
                        <div className="promo-type-toggle">
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

                    <div className="promo-form-row">
                        <div className="promo-form-group">
                            <label>{formData.type === 'PERCENTAGE' ? 'Porcentaje (%)' : 'Monto ($)'}</label>
                            <input className="promo-input" type="number" step="0.01" min="0" value={formData.value}
                                onChange={e => setFormData({ ...formData, value: e.target.value })} required />
                        </div>
                        <div className="promo-form-group">
                            <label>Mínimo de Orden ($)</label>
                            <input className="promo-input" type="number" step="0.01" min="0" value={formData.minOrderAmount}
                                onChange={e => setFormData({ ...formData, minOrderAmount: e.target.value })} placeholder="Opcional" />
                        </div>
                    </div>

                    <div className="promo-form-row">
                        <div className="promo-form-group">
                            <label>Desc. Máximo ($)</label>
                            <input className="promo-input" type="number" step="0.01" min="0" value={formData.maxDiscount}
                                onChange={e => setFormData({ ...formData, maxDiscount: e.target.value })} placeholder="Opcional" />
                        </div>
                        <div className="promo-form-group">
                            <label>Límite de Usos</label>
                            <input className="promo-input" type="number" min="0" value={formData.usageLimit}
                                onChange={e => setFormData({ ...formData, usageLimit: e.target.value })} placeholder="Ilimitado" />
                        </div>
                    </div>

                    <div className="promo-form-row">
                        <div className="promo-form-group">
                            <label>Vigente Desde</label>
                            <input className="promo-input" type="date" value={formData.validFrom}
                                onChange={e => setFormData({ ...formData, validFrom: e.target.value })} />
                        </div>
                        <div className="promo-form-group">
                            <label>Vigente Hasta</label>
                            <input className="promo-input" type="date" value={formData.validTo}
                                onChange={e => setFormData({ ...formData, validTo: e.target.value })} />
                        </div>
                    </div>

                    <div className="promo-form-actions">
                        <Button type="button" variant="secondary" onClick={() => setIsSidebarOpen(false)} fullWidth>Cancelar</Button>
                        <Button type="submit" fullWidth>{editing ? 'Actualizar' : 'Crear Promoción'}</Button>
                    </div>
                </form>
            </Sidebar>
        </div>
    );
}
