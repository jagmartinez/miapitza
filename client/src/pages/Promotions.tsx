import { useState, useEffect, useMemo } from 'react';
import type { MultiValue, SingleValue } from 'react-select';
import { branchesAPI, categoriesAPI, menuAPI, promotionsAPI } from '../services/api';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useAppToast } from '../context/ToastContext';
import Button from '../components/Button';
import Sidebar from '../components/Sidebar';
import Select from '../components/Select';
import ViewToggle from '../components/ViewToggle';
import CatalogTable, { type CatalogColumn } from '../components/CatalogTable';
import { useViewMode } from '../hooks/useViewMode';
import { Plus, Edit, Percent, DollarSign, Ticket, XCircle, Calendar, FileText, Gift, Layers, MapPin, Trash2 } from 'lucide-react';
import { useCurrency } from '../hooks/useCurrency';
import { useAuth } from '../hooks/useAuth';
import { formatPromotionDateKey, promotionDateInput, promotionDatePayload, type PromotionDateFields } from '../utils/promotionDates';
import {
    describePromotionBranches,
    describePromotionSchedule,
    describePromotionScope,
    describePromotionValue,
    EMPTY_PROMOTION_RULES,
    promotionRulesForm,
    promotionRulesPayload,
    promotionTypeLabel,
    validatePromotionRules,
    WEEKDAYS,
    type PromotionRulesForm,
    type PromotionRulesView,
    type PromotionType,
} from '../utils/promotionRules';
import './Promotions.css';

interface PromotionRow extends PromotionRulesView {
    id: number;
    code: string;
    name: string;
    description?: string | null;
    type: PromotionType;
    value: number;
    minOrderAmount?: number | null;
    maxDiscount?: number | null;
    validFrom?: string | null;
    validTo?: string | null;
    /** Calendar day (YYYY-MM-DD) of validFrom in the company time zone. */
    validFromDate?: string | null;
    /** Calendar day (YYYY-MM-DD) of validTo in the company time zone. */
    validToDate?: string | null;
    usageLimit?: number | null;
    usageCount?: number;
    active: boolean;
}

interface PromotionPayload {
    code: string;
    name: string;
    description: string | null;
    type: PromotionType;
    value: number;
    minOrderAmount: number | null;
    maxDiscount: number | null;
    /** Calendar date (YYYY-MM-DD) in the company time zone; omitted = now (create) / unchanged (edit). */
    validFrom?: string;
    /** Calendar date (YYYY-MM-DD) in the company time zone, inclusive; omitted = unchanged (edit). */
    validTo?: string | null;
    usageLimit: number | null;
}

interface NamedOption { id: number; name: string }
type Option = { value: number; label: string };

function axiosMsg(err: unknown, fallback: string): string {
    if (typeof err === 'object' && err !== null && 'response' in err) {
        const m = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
        if (typeof m === 'string' && m) return m;
    }
    return fallback;
}

function toApiPayload(payload: PromotionPayload, rules: PromotionRulesForm): Record<string, unknown> {
    return { ...payload, ...promotionRulesPayload(rules) };
}

const TYPE_BUTTONS: Array<{ type: PromotionType; label: string; icon: typeof Percent }> = [
    { type: 'PERCENTAGE', label: 'Porcentaje', icon: Percent },
    { type: 'FIXED_AMOUNT', label: 'Monto Fijo', icon: DollarSign },
    { type: 'BUY_X_GET_Y', label: 'N x M', icon: Gift },
    { type: 'COMBO', label: 'Combo', icon: Layers },
];

export default function Promotions() {
    const { formatMoney } = useCurrency();
    const { user } = useAuth();
    // Fallback only: the session zone may be the branch's. The API's
    // validFromDate/validToDate (company zone) are authoritative when present.
    const sessionTimeZone = user?.timezone || undefined;
    const { confirm } = useConfirmDialog();
    const { error: showError } = useAppToast();
    const [promotions, setPromotions] = useState<PromotionRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [editing, setEditing] = useState<PromotionRow | null>(null);
    const [initialDates, setInitialDates] = useState<PromotionDateFields | null>(null);
    const [formData, setFormData] = useState({
        code: '', name: '', description: '',
        value: '', minOrderAmount: '', maxDiscount: '',
        validFrom: '', validTo: '', usageLimit: '',
    });
    const [rules, setRules] = useState<PromotionRulesForm>(EMPTY_PROMOTION_RULES);
    const [menuItems, setMenuItems] = useState<NamedOption[]>([]);
    const [categories, setCategories] = useState<NamedOption[]>([]);
    const [branches, setBranches] = useState<NamedOption[]>([]);
    const [saving, setSaving] = useState(false);
    const [activeTab, setActiveTab] = useState<'identidad' | 'reglas' | 'aplicacion' | 'vigencia'>('identidad');
    const { viewMode, setViewMode } = useViewMode('promotions');

    useEffect(() => { loadData(); loadCatalogs(); }, []);

    const loadData = async () => {
        try {
            const res = await promotionsAPI.getAll(false); // Get all, including inactive
            setPromotions(res.data.data || []);
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    };

    const loadCatalogs = async () => {
        const [menuRes, categoriesRes, branchesRes] = await Promise.allSettled([
            menuAPI.getAll({ active: true }),
            categoriesAPI.getAll(),
            branchesAPI.getAll(),
        ]);
        const named = (rows: unknown): NamedOption[] => (Array.isArray(rows) ? rows : [])
            .map((row: { id: number; name: string }) => ({ id: row.id, name: row.name }))
            .sort((a, b) => a.name.localeCompare(b.name, 'es'));
        if (menuRes.status === 'fulfilled') setMenuItems(named(menuRes.value.data.data));
        if (categoriesRes.status === 'fulfilled') setCategories(named(categoriesRes.value.data.data));
        if (branchesRes.status === 'fulfilled') setBranches(named(branchesRes.value.data.data));
    };

    const menuOptions = useMemo<Option[]>(() => menuItems.map((item) => ({ value: item.id, label: item.name })), [menuItems]);
    const categoryOptions = useMemo<Option[]>(() => categories.map((item) => ({ value: item.id, label: item.name })), [categories]);
    const branchOptions = useMemo<Option[]>(() => branches.map((item) => ({ value: item.id, label: item.name })), [branches]);
    const pick = (options: Option[], ids: number[]) => options.filter((option) => ids.includes(option.value));
    const branchName = (id: number) => branches.find((branch) => branch.id === id)?.name;

    const handleOpen = (promo?: PromotionRow) => {
        if (promo) {
            const dates: PromotionDateFields = {
                validFrom: promotionDateInput(promo.validFromDate, promo.validFrom, sessionTimeZone),
                validTo: promotionDateInput(promo.validToDate, promo.validTo, sessionTimeZone),
            };
            setEditing(promo);
            setInitialDates(dates);
            setFormData({
                code: promo.code, name: promo.name, description: promo.description || '',
                value: promo.type === 'BUY_X_GET_Y' ? '' : String(promo.value),
                minOrderAmount: promo.minOrderAmount ? String(promo.minOrderAmount) : '',
                maxDiscount: promo.maxDiscount ? String(promo.maxDiscount) : '',
                ...dates,
                usageLimit: promo.usageLimit ? String(promo.usageLimit) : '',
            });
            setRules(promotionRulesForm(promo));
        } else {
            setEditing(null);
            setInitialDates(null);
            setFormData({
                code: '', name: '', description: '',
                value: '', minOrderAmount: '',
                maxDiscount: '', validFrom: '', validTo: '', usageLimit: '',
            });
            setRules(EMPTY_PROMOTION_RULES);
        }
        setActiveTab('identidad');
        setIsSidebarOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const ruleError = validatePromotionRules(rules);
        if (ruleError) {
            showError(ruleError);
            return;
        }
        const value = rules.type === 'BUY_X_GET_Y' ? 0 : parseFloat(formData.value);
        if (rules.type !== 'BUY_X_GET_Y' && !(value > 0)) {
            showError(rules.type === 'COMBO' ? 'Indique el precio del combo' : 'El valor de la promoción debe ser mayor a 0');
            setActiveTab('reglas');
            return;
        }
        const payload: PromotionPayload = {
            code: formData.code.toUpperCase(),
            name: formData.name,
            description: formData.description || null,
            type: rules.type,
            value,
            minOrderAmount: formData.minOrderAmount ? parseFloat(formData.minOrderAmount) : null,
            maxDiscount: formData.maxDiscount ? parseFloat(formData.maxDiscount) : null,
            // Date-only strings: the server resolves them to the whole local day
            // in the company time zone (validTo inclusive until 23:59:59). On
            // edit only changed bounds are sent, so an intra-day start is kept.
            ...promotionDatePayload(
                { validFrom: formData.validFrom, validTo: formData.validTo },
                editing ? initialDates : null,
            ),
            usageLimit: formData.usageLimit ? parseInt(formData.usageLimit) : null,
        };
        setSaving(true);
        try {
            if (editing) {
                await promotionsAPI.update(editing.id, toApiPayload(payload, rules));
            } else {
                await promotionsAPI.create(toApiPayload(payload, rules));
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

    const formatDate = (d?: string | null, dateKey?: string | null) => {
        if (dateKey) return formatPromotionDateKey(dateKey);
        if (!d) return '—';
        try {
            return new Date(d).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', timeZone: sessionTimeZone });
        } catch {
            return new Date(d).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
        }
    };

    const toggleWeekday = (day: number) => setRules((current) => ({
        ...current,
        weekdays: current.weekdays.includes(day)
            ? current.weekdays.filter((value) => value !== day)
            : [...current.weekdays, day].sort((a, b) => a - b),
    }));

    const updateComboItem = (index: number, patch: Partial<{ menuItemId: number; quantity: number }>) => setRules((current) => ({
        ...current,
        comboItems: current.comboItems.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
    }));

    const valueLabel = rules.type === 'PERCENTAGE'
        ? (rules.scope === 'ITEMS' ? 'Porcentaje por producto (%)' : 'Porcentaje (%)')
        : rules.type === 'COMBO'
            ? 'Precio del combo'
            : (rules.scope === 'ITEMS' ? 'Monto por unidad' : 'Monto');

    if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-secondary)' }}>Cargando...</div>;

    return (
        <div className="promotions-page">
            <div className="promo-header">
                <div>
                    <h1><Ticket size={28} /> Promociones</h1>
                    <p>Gestiona códigos de descuento, happy hours, combos y ofertas por producto o sucursal</p>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <ViewToggle value={viewMode} onChange={setViewMode} />
                    <Button onClick={() => handleOpen()}>
                        <Plus size={18} /> Nueva Promoción
                    </Button>
                </div>
            </div>

            {viewMode === 'table' && promotions.length > 0 && (
                <CatalogTable<PromotionRow>
                    rows={promotions}
                    rowKey={(p) => p.id}
                    columns={[
                        {
                            key: 'name',
                            header: 'Promoción',
                            render: (p) => (
                                <div className="catalog-cell-stack">
                                    <span className="cell-title">{p.name}</span>
                                    <span className="cell-sub">{p.code}</span>
                                </div>
                            )
                        },
                        { key: 'type', header: 'Tipo', render: (p) => promotionTypeLabel(p.type) },
                        { key: 'value', header: 'Valor', align: 'right', render: (p) => describePromotionValue(p, formatMoney) },
                        {
                            key: 'scope',
                            header: 'Aplica a',
                            render: (p) => (
                                <div className="catalog-cell-stack">
                                    <span>{describePromotionScope(p)}</span>
                                    <span className="cell-sub">{describePromotionBranches(p, branchName)}</span>
                                </div>
                            )
                        },
                        {
                            key: 'validity',
                            header: 'Vigencia',
                            render: (p) => {
                                const schedule = describePromotionSchedule(p);
                                return (
                                    <div className="catalog-cell-stack">
                                        <span>{`${formatDate(p.validFrom, p.validFromDate)} — ${formatDate(p.validTo, p.validToDate)}`}</span>
                                        {schedule && <span className="cell-sub">{schedule}</span>}
                                    </div>
                                );
                            }
                        },
                        { key: 'usage', header: 'Usos', align: 'center', render: (p) => `${p.usageCount || 0}${p.usageLimit ? ` / ${p.usageLimit}` : ''}` },
                        {
                            key: 'status',
                            header: 'Estado',
                            render: (p) => {
                                const status = getStatus(p);
                                const tone = status === 'active' ? 'ok' : status === 'expired' ? 'warning' : 'neutral';
                                return <span className={`catalog-pill ${tone}`}>{status === 'active' ? 'Activa' : status === 'expired' ? 'Expirada' : 'Inactiva'}</span>;
                            }
                        },
                        {
                            key: 'actions',
                            header: 'Acciones',
                            align: 'right',
                            render: (p) => (
                                <div className="catalog-table-actions">
                                    <button className="catalog-action-btn" onClick={() => handleOpen(p)} title="Editar">
                                        <Edit size={16} />
                                    </button>
                                    {p.active && (
                                        <button className="catalog-action-btn danger" onClick={() => handleDeactivate(p.id)} title="Desactivar">
                                            <XCircle size={16} />
                                        </button>
                                    )}
                                </div>
                            )
                        }
                    ] as CatalogColumn<PromotionRow>[]}
                />
            )}

            {promotions.length === 0 ? (
                <div className="promo-empty">
                    <Ticket size={64} />
                    <p>No hay promociones creadas</p>
                </div>
            ) : viewMode === 'cards' ? (
                <div className="promo-grid">
                    {promotions.map(p => {
                        const status = getStatus(p);
                        const usageCount = p.usageCount || 0;
                        const usagePct = p.usageLimit ? Math.min(100, (usageCount / p.usageLimit) * 100) : 0;
                        const schedule = describePromotionSchedule(p);
                        return (
                            <div key={p.id} className={`promo-card ${status === 'inactive' ? 'inactive' : ''}`}>
                                <div className="promo-card-top">
                                    <span className="promo-code-badge">{p.code}</span>
                                    <span className={`promo-type-badge ${p.type === 'PERCENTAGE' ? 'percentage' : 'fixed'}`}>
                                        {promotionTypeLabel(p.type)}
                                    </span>
                                </div>

                                <div className="promo-card-body">
                                    <div className="promo-name">{p.name}</div>
                                    {p.description && <div className="promo-desc">{p.description}</div>}

                                    <div className="promo-value-display">
                                        {describePromotionValue(p, formatMoney)}
                                    </div>

                                    <div className="promo-details">
                                        <div className="promo-detail-row">
                                            <span className="label">Estado</span>
                                            <span className={`promo-status ${status}`}>
                                                {status === 'active' ? 'Activa' : status === 'expired' ? 'Expirada' : 'Inactiva'}
                                            </span>
                                        </div>
                                        <div className="promo-detail-row">
                                            <span className="label">Aplica a</span>
                                            <span className="value">{describePromotionScope(p)}</span>
                                        </div>
                                        <div className="promo-detail-row">
                                            <span className="label">Sucursales</span>
                                            <span className="value">{describePromotionBranches(p, branchName)}</span>
                                        </div>
                                        <div className="promo-detail-row">
                                            <span className="label">Vigencia</span>
                                            <span className="value">{formatDate(p.validFrom, p.validFromDate)} — {formatDate(p.validTo, p.validToDate)}</span>
                                        </div>
                                        {schedule && (
                                            <div className="promo-detail-row">
                                                <span className="label">Horario</span>
                                                <span className="value">{schedule}</span>
                                            </div>
                                        )}
                                        {p.minOrderAmount && (
                                            <div className="promo-detail-row">
                                                <span className="label">Mínimo</span>
                                                <span className="value">{formatMoney(Number(p.minOrderAmount))}</span>
                                            </div>
                                        )}
                                        {p.maxDiscount && (
                                            <div className="promo-detail-row">
                                                <span className="label">Desc. máximo</span>
                                                <span className="value">{formatMoney(Number(p.maxDiscount))}</span>
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
            ) : null}

            <Sidebar isOpen={isSidebarOpen} onClose={() => { setIsSidebarOpen(false); setActiveTab('identidad'); }} title={editing ? 'Editar Promoción' : 'Nueva Promoción'}>
                <div className="premium-modal-content">
                    <div className="modal-tabs" role="tablist" aria-label="Secciones de la promoción">
                        <button
                            type="button"
                            role="tab"
                            aria-selected={activeTab === 'identidad'}
                            className={`modal-tab ${activeTab === 'identidad' ? 'active' : ''}`}
                            onClick={() => setActiveTab('identidad')}
                        >
                            <FileText size={18} />
                            <span>Identidad</span>
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={activeTab === 'reglas'}
                            className={`modal-tab ${activeTab === 'reglas' ? 'active' : ''}`}
                            onClick={() => setActiveTab('reglas')}
                        >
                            <Percent size={18} />
                            <span>Reglas</span>
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={activeTab === 'aplicacion'}
                            className={`modal-tab ${activeTab === 'aplicacion' ? 'active' : ''}`}
                            onClick={() => setActiveTab('aplicacion')}
                        >
                            <MapPin size={18} />
                            <span>Sucursales</span>
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={activeTab === 'vigencia'}
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
                                <div className="modal-content-group">
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
                                <div className="modal-content-group">
                                    <div className="modal-section-header">
                                        <Percent size={16} />
                                        <h3>Reglas de Descuento</h3>
                                    </div>
                                    <div className="modal-input-group">
                                        <label className="modal-input-label" id="promo-discount-type-label">Tipo de Promoción</label>
                                        <div className="promo-type-toggle" role="group" aria-labelledby="promo-discount-type-label">
                                            {TYPE_BUTTONS.map(({ type, label, icon: Icon }) => (
                                                <button key={type} type="button" className={`promo-type-btn ${rules.type === type ? 'active' : ''}`}
                                                    aria-pressed={rules.type === type}
                                                    onClick={() => setRules({
                                                        ...rules,
                                                        type,
                                                        scope: type === 'COMBO' || type === 'BUY_X_GET_Y' ? 'ITEMS' : rules.scope,
                                                    })}>
                                                    <Icon size={14} /> {label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {(rules.type === 'PERCENTAGE' || rules.type === 'FIXED_AMOUNT') && (
                                        <div className="modal-input-group">
                                            <label className="modal-input-label" id="promo-scope-label">Se aplica a</label>
                                            <div className="promo-type-toggle" role="group" aria-labelledby="promo-scope-label">
                                                <button type="button" className={`promo-type-btn ${rules.scope === 'ORDER' ? 'active' : ''}`}
                                                    aria-pressed={rules.scope === 'ORDER'}
                                                    onClick={() => setRules({ ...rules, scope: 'ORDER' })}>
                                                    Toda la orden
                                                </button>
                                                <button type="button" className={`promo-type-btn ${rules.scope === 'ITEMS' ? 'active' : ''}`}
                                                    aria-pressed={rules.scope === 'ITEMS'}
                                                    onClick={() => setRules({ ...rules, scope: 'ITEMS' })}>
                                                    Productos / categorías
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {rules.type === 'BUY_X_GET_Y' ? (
                                        <div className="modal-form-row">
                                            <div className="modal-input-group">
                                                <label className="modal-input-label" htmlFor="promo-buy">Lleva (N)</label>
                                                <input id="promo-buy" className="modal-standard-input" type="number" min="2" step="1" value={rules.buyQuantity}
                                                    onChange={e => setRules({ ...rules, buyQuantity: e.target.value })} placeholder="3" required />
                                            </div>
                                            <div className="modal-input-group">
                                                <label className="modal-input-label" htmlFor="promo-pay">Paga (M)</label>
                                                <input id="promo-pay" className="modal-standard-input" type="number" min="1" step="1" value={rules.payQuantity}
                                                    onChange={e => setRules({ ...rules, payQuantity: e.target.value })} placeholder="2" required />
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="modal-input-group">
                                            <label className="modal-input-label" htmlFor="promo-value">{valueLabel}</label>
                                            <input id="promo-value" className="modal-standard-input" type="number" step="0.01" min="0" value={formData.value}
                                                onChange={e => setFormData({ ...formData, value: e.target.value })} required />
                                        </div>
                                    )}
                                    {rules.type === 'BUY_X_GET_Y' && (
                                        <p className="promo-hint">Por cada N unidades elegibles se cobran M; las más baratas de cada grupo salen gratis.</p>
                                    )}

                                    {rules.type !== 'COMBO' && rules.scope === 'ITEMS' && (
                                        <>
                                            <div className="modal-input-group">
                                                <Select<Option, true>
                                                    label="Productos"
                                                    inputId="promo-target-products"
                                                    isMulti
                                                    variant="modal"
                                                    options={menuOptions}
                                                    value={pick(menuOptions, rules.targetMenuItemIds)}
                                                    onChange={(selected: MultiValue<Option>) => setRules({ ...rules, targetMenuItemIds: selected.map((option) => option.value) })}
                                                    placeholder="Seleccionar productos..."
                                                />
                                            </div>
                                            <div className="modal-input-group">
                                                <Select<Option, true>
                                                    label="Categorías"
                                                    inputId="promo-target-categories"
                                                    isMulti
                                                    variant="modal"
                                                    options={categoryOptions}
                                                    value={pick(categoryOptions, rules.targetCategoryIds)}
                                                    onChange={(selected: MultiValue<Option>) => setRules({ ...rules, targetCategoryIds: selected.map((option) => option.value) })}
                                                    placeholder="Seleccionar categorías..."
                                                />
                                            </div>
                                            <p className="promo-hint">El descuento se calcula por cada línea elegible, no sobre toda la orden.</p>
                                        </>
                                    )}

                                    {rules.type === 'COMBO' && (
                                        <div className="modal-input-group">
                                            <span className="modal-input-label">Productos del combo</span>
                                            {rules.comboItems.map((item, index) => (
                                                <div key={index} className="promo-combo-row">
                                                    <div className="promo-combo-product">
                                                        <Select<Option>
                                                            inputId={`promo-combo-item-${index}`}
                                                            aria-label={`Producto ${index + 1} del combo`}
                                                            variant="modal"
                                                            options={menuOptions}
                                                            value={menuOptions.find((option) => option.value === item.menuItemId) ?? null}
                                                            onChange={(selected: SingleValue<Option>) => selected && updateComboItem(index, { menuItemId: selected.value })}
                                                            placeholder="Producto..."
                                                        />
                                                    </div>
                                                    <input className="modal-standard-input promo-combo-qty" type="number" min="1" max="99" step="1"
                                                        aria-label={`Cantidad del producto ${index + 1}`}
                                                        value={item.quantity}
                                                        onChange={e => updateComboItem(index, { quantity: Math.max(1, parseInt(e.target.value) || 1) })} />
                                                    <button type="button" className="catalog-action-btn danger" title="Quitar"
                                                        onClick={() => setRules({ ...rules, comboItems: rules.comboItems.filter((_, itemIndex) => itemIndex !== index) })}>
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            ))}
                                            <Button type="button" variant="ghost"
                                                disabled={menuOptions.length === 0}
                                                onClick={() => {
                                                    const used = new Set(rules.comboItems.map((item) => item.menuItemId));
                                                    const next = menuOptions.find((option) => !used.has(option.value));
                                                    if (next) setRules({ ...rules, comboItems: [...rules.comboItems, { menuItemId: next.value, quantity: 1 }] });
                                                }}>
                                                <Plus size={16} /> Agregar producto
                                            </Button>
                                            <p className="promo-hint">
                                                Cuando la orden contiene el juego completo se cobra el precio del combo (por cada juego).
                                                Cada producto se registra y descuenta del inventario por separado.
                                            </p>
                                        </div>
                                    )}

                                    <div className="modal-form-row">
                                        <div className="modal-input-group">
                                            <label className="modal-input-label" htmlFor="promo-min-order">Mínimo de Orden</label>
                                            <input id="promo-min-order" className="modal-standard-input" type="number" step="0.01" min="0" value={formData.minOrderAmount}
                                                onChange={e => setFormData({ ...formData, minOrderAmount: e.target.value })} placeholder="Opcional" />
                                        </div>
                                        <div className="modal-input-group">
                                            <label className="modal-input-label" htmlFor="promo-max-discount">Desc. Máximo</label>
                                            <input id="promo-max-discount" className="modal-standard-input" type="number" step="0.01" min="0" value={formData.maxDiscount}
                                                onChange={e => setFormData({ ...formData, maxDiscount: e.target.value })} placeholder="Opcional" />
                                        </div>
                                    </div>
                                    <div className="modal-input-group">
                                        <label className="modal-input-label" htmlFor="promo-usage-limit">Límite de Usos</label>
                                        <input id="promo-usage-limit" className="modal-standard-input" type="number" min="0" value={formData.usageLimit}
                                            onChange={e => setFormData({ ...formData, usageLimit: e.target.value })} placeholder="Ilimitado" />
                                    </div>
                                </div>
                            )}

                            {activeTab === 'aplicacion' && (
                                <div className="modal-content-group">
                                    <div className="modal-section-header">
                                        <MapPin size={16} />
                                        <h3>Sucursales</h3>
                                    </div>
                                    <div className="promo-type-toggle" role="group" aria-label="Sucursales donde aplica">
                                        <button type="button" className={`promo-type-btn ${rules.allBranches ? 'active' : ''}`}
                                            aria-pressed={rules.allBranches}
                                            onClick={() => setRules({ ...rules, allBranches: true })}>
                                            Todas las sucursales
                                        </button>
                                        <button type="button" className={`promo-type-btn ${!rules.allBranches ? 'active' : ''}`}
                                            aria-pressed={!rules.allBranches}
                                            onClick={() => setRules({ ...rules, allBranches: false })}>
                                            Solo algunas
                                        </button>
                                    </div>
                                    {!rules.allBranches && (
                                        <div className="modal-input-group">
                                            <Select<Option, true>
                                                label="Sucursales"
                                                inputId="promo-branches"
                                                isMulti
                                                variant="modal"
                                                options={branchOptions}
                                                value={pick(branchOptions, rules.branchIds)}
                                                onChange={(selected: MultiValue<Option>) => setRules({ ...rules, branchIds: selected.map((option) => option.value) })}
                                                placeholder="Seleccionar sucursales..."
                                            />
                                        </div>
                                    )}
                                    <p className="promo-hint">El POS solo ofrece y aplica la promoción en órdenes de las sucursales seleccionadas.</p>
                                </div>
                            )}

                            {activeTab === 'vigencia' && (
                                <div className="modal-content-group">
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

                                    <div className="modal-section-header">
                                        <Calendar size={16} />
                                        <h3>Happy hour (opcional)</h3>
                                    </div>
                                    <div className="modal-input-group">
                                        <span className="modal-input-label" id="promo-weekdays-label">Días</span>
                                        <div className="promo-weekdays" role="group" aria-labelledby="promo-weekdays-label">
                                            {WEEKDAYS.map((day) => (
                                                <button key={day.value} type="button" title={day.label}
                                                    className={`promo-weekday-btn ${rules.weekdays.includes(day.value) ? 'active' : ''}`}
                                                    aria-pressed={rules.weekdays.includes(day.value)}
                                                    onClick={() => toggleWeekday(day.value)}>
                                                    {day.short}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="modal-form-row">
                                        <div className="modal-input-group">
                                            <label className="modal-input-label" htmlFor="promo-start-time">Hora inicial</label>
                                            <input id="promo-start-time" className="modal-standard-input" type="time" value={rules.dailyStartTime}
                                                onChange={e => setRules({ ...rules, dailyStartTime: e.target.value })} />
                                        </div>
                                        <div className="modal-input-group">
                                            <label className="modal-input-label" htmlFor="promo-end-time">Hora final</label>
                                            <input id="promo-end-time" className="modal-standard-input" type="time" value={rules.dailyEndTime}
                                                onChange={e => setRules({ ...rules, dailyEndTime: e.target.value })} />
                                        </div>
                                    </div>
                                    <p className="promo-hint">
                                        {describePromotionSchedule(rules)
                                            ?? 'Sin días ni horario: la promoción aplica todo el día.'}
                                        {' '}Se evalúa en la zona horaria de la empresa; si la hora final es menor que la inicial el horario cruza la medianoche.
                                        Solo se descuentan los productos pedidos dentro del horario.
                                    </p>
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
