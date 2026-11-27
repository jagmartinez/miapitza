import { useState, useEffect, useMemo } from 'react';
import { branchesAPI, categoriesAPI, menuAPI, promotionsAPI } from '../services/api';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useAppToast } from '../context/ToastContext';
import { Plus, Pencil, Ticket, Power, Trash2, Search } from 'lucide-react';
import { useCurrency } from '../hooks/useCurrency';
import {
    AppSelect, Badge, Button, DataTable, DateInput, EmptyState, Field, FormGrid, FormSection, FullScreenModal, IconButton, Input,
    NumberInput, PageContent, PageHeader, SegmentedControl, TableToolbar, type Column,
} from '@/ui';
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
import styles from './catalog.module.css';

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

const TYPE_OPTIONS: Array<{ value: PromotionType; label: string }> = [
    { value: 'PERCENTAGE', label: 'Porcentaje' },
    { value: 'FIXED_AMOUNT', label: 'Monto fijo' },
    { value: 'BUY_X_GET_Y', label: 'N x M' },
    { value: 'COMBO', label: 'Combo' },
];

type StatusFilter = 'all' | 'active' | 'expired' | 'inactive';
const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'Todas' },
    { value: 'active', label: 'Activas' },
    { value: 'expired', label: 'Expiradas' },
    { value: 'inactive', label: 'Inactivas' },
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
    const [loadError, setLoadError] = useState<string | null>(null);
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
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

    useEffect(() => { loadData(); loadCatalogs(); }, []);

    const loadData = async () => {
        try {
            const res = await promotionsAPI.getAll(false); // Get all, including inactive
            setPromotions(res.data.data || []);
            setLoadError(null);
        } catch (e) {
            console.error(e);
            setLoadError('No se pudieron cargar las promociones.');
        }
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

    const getStatus = (p: PromotionRow): Exclude<StatusFilter, 'all'> => {
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

    const q = search.trim().toLowerCase();
    const filteredPromotions = promotions.filter((p) => {
        if (statusFilter !== 'all' && getStatus(p) !== statusFilter) return false;
        return !q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q);
    });

    const columns: Column<PromotionRow>[] = [
        {
            key: 'name',
            header: 'Promoción',
            render: (p) => (
                <div className={styles.cellStack}>
                    <span className={styles.cellTitle}>{p.name}</span>
                    <span className={styles.muted}>{p.code}</span>
                </div>
            )
        },
        { key: 'type', header: 'Tipo', width: '1fr', accessor: (p) => promotionTypeLabel(p.type) },
        { key: 'value', header: 'Valor', type: 'number', render: (p) => describePromotionValue(p, formatMoney) },
        {
            key: 'scope',
            header: 'Aplica a',
            render: (p) => (
                <div className={styles.cellStack}>
                    <span>{describePromotionScope(p)}</span>
                    <span className={styles.muted}>{describePromotionBranches(p, branchName)}</span>
                </div>
            )
        },
        {
            key: 'validity',
            header: 'Vigencia',
            render: (p) => {
                const schedule = describePromotionSchedule(p);
                return (
                    <div className={styles.cellStack}>
                        <span>{`${formatDate(p.validFrom, p.validFromDate)} — ${formatDate(p.validTo, p.validToDate)}`}</span>
                        {schedule && <span className={styles.muted}>{schedule}</span>}
                    </div>
                );
            }
        },
        { key: 'usage', header: 'Usos', type: 'number', render: (p) => `${p.usageCount || 0}${p.usageLimit ? ` / ${p.usageLimit}` : ''}` },
        {
            key: 'status',
            header: 'Estado',
            render: (p) => {
                const status = getStatus(p);
                const tone = status === 'active' ? 'success' : status === 'expired' ? 'warning' : 'neutral';
                return <Badge tone={tone} dot>{status === 'active' ? 'Activa' : status === 'expired' ? 'Expirada' : 'Inactiva'}</Badge>;
            }
        },
        {
            key: 'actions',
            header: 'Acciones',
            type: 'actions',
            width: '100px',
            render: (p) => (
                <div className={styles.rowActions}>
                    <IconButton size="sm" icon={Pencil} tooltip="Editar" label={`Editar ${p.name}`} onClick={() => handleOpen(p)} />
                    {p.active && <IconButton size="sm" icon={Power} tone="danger" tooltip="Desactivar" label={`Desactivar ${p.name}`} onClick={() => handleDeactivate(p.id)} />}
                </div>
            )
        }
    ] as Column<PromotionRow>[];

    return (
        <PageContent>
            <PageHeader
                title="Promociones"
                description="Gestiona códigos de descuento, happy hours, combos y ofertas por producto o sucursal"
                actions={(
                    <Button variant="primary" icon={Plus} onClick={() => handleOpen()}>
                        Nueva promoción
                    </Button>
                )}
            />

            <TableToolbar>
                <Input
                    type="search"
                    aria-label="Buscar promoción"
                    placeholder="Buscar por nombre o código"
                    prefix={<Search size={14} aria-hidden="true" />}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
                <SegmentedControl ariaLabel="Estado" options={STATUS_OPTIONS} value={statusFilter} onChange={setStatusFilter} />
            </TableToolbar>

            <DataTable<PromotionRow>
                ariaLabel="Promociones"
                rows={filteredPromotions}
                rowKey={(p) => p.id}
                columns={columns}
                loading={loading}
                error={loadError}
                onRetry={() => void loadData()}
                resetKey={`${q}|${statusFilter}`}
                onRowClick={(p) => handleOpen(p)}
                empty={promotions.length === 0
                    ? <EmptyState icon={Ticket} title="No hay promociones creadas" />
                    : 'No hay promociones con este filtro.'}
            />

            <FullScreenModal
                isOpen={isSidebarOpen}
                onClose={() => { setIsSidebarOpen(false); setActiveTab('identidad'); }}
                title={editing ? 'Editar promoción' : 'Nueva promoción'}
                breadcrumb={['Ventas', 'Promociones']}
                tabs={[
                    { id: 'identidad', label: 'Identidad' },
                    { id: 'reglas', label: 'Reglas' },
                    { id: 'aplicacion', label: 'Sucursales' },
                    { id: 'vigencia', label: 'Vigencia' },
                ]}
                activeTab={activeTab}
                onTabChange={(id) => setActiveTab(id as typeof activeTab)}
                footer={({ requestClose }) => (
                    <>
                        <Button onClick={requestClose}>Cancelar</Button>
                        <Button type="submit" form="promotion-form" variant="primary" loading={saving}>
                            {editing ? 'Guardar cambios' : 'Crear promoción'}
                        </Button>
                    </>
                )}
            >
                <form id="promotion-form" onSubmit={handleSubmit} className={styles.stack}>
                    {activeTab === 'identidad' && (
                        <FormSection step={1} title="Identidad de la promoción" description="Código que el cajero ingresa y nombre visible.">
                            <FormGrid>
                                <Field label="Código" htmlFor="promo-code" required>
                                    <Input id="promo-code" value={formData.code} className={styles.mono}
                                        onChange={e => setFormData({ ...formData, code: e.target.value })} placeholder="PROMO10" required autoFocus />
                                </Field>
                                <Field label="Nombre" htmlFor="promo-name" required>
                                    <Input id="promo-name" value={formData.name}
                                        onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="Happy Hour" required />
                                </Field>
                            </FormGrid>
                            <Field label="Descripción" htmlFor="promo-description">
                                <Input id="promo-description" value={formData.description}
                                    onChange={e => setFormData({ ...formData, description: e.target.value })} placeholder="Opcional..." />
                            </Field>
                        </FormSection>
                    )}

                    {activeTab === 'reglas' && (
                        <>
                            <FormSection step={1} title="Tipo de promoción" description="Define cómo se calcula el descuento.">
                                <div className={styles.inline}>
                                    <SegmentedControl<PromotionType>
                                        ariaLabel="Tipo de promoción"
                                        options={TYPE_OPTIONS}
                                        value={rules.type}
                                        onChange={(type) => setRules({
                                            ...rules,
                                            type,
                                            scope: type === 'COMBO' || type === 'BUY_X_GET_Y' ? 'ITEMS' : rules.scope,
                                        })}
                                    />
                                </div>
                                {(rules.type === 'PERCENTAGE' || rules.type === 'FIXED_AMOUNT') && (
                                    <div className={styles.cellStack}>
                                        <span className={styles.muted}>Se aplica a</span>
                                        <div className={styles.inline}>
                                            <SegmentedControl<'ORDER' | 'ITEMS'>
                                                ariaLabel="Se aplica a"
                                                options={[
                                                    { value: 'ORDER', label: 'Toda la orden' },
                                                    { value: 'ITEMS', label: 'Productos / categorías' },
                                                ]}
                                                value={rules.scope}
                                                onChange={(scope) => setRules({ ...rules, scope })}
                                            />
                                        </div>
                                    </div>
                                )}
                                <FormGrid>
                                    {rules.type === 'BUY_X_GET_Y' ? (
                                        <>
                                            <Field label="Lleva (N)" htmlFor="promo-buy" required>
                                                <Input id="promo-buy" type="number" min="2" step="1" className="ui-input--number" value={rules.buyQuantity}
                                                    onChange={e => setRules({ ...rules, buyQuantity: e.target.value })} placeholder="3" required />
                                            </Field>
                                            <Field label="Paga (M)" htmlFor="promo-pay" required>
                                                <Input id="promo-pay" type="number" min="1" step="1" className="ui-input--number" value={rules.payQuantity}
                                                    onChange={e => setRules({ ...rules, payQuantity: e.target.value })} placeholder="2" required />
                                            </Field>
                                        </>
                                    ) : (
                                        <Field label={valueLabel} htmlFor="promo-value" required>
                                            <Input id="promo-value" type="number" step="0.01" min="0" className="ui-input--number" value={formData.value}
                                                onChange={e => setFormData({ ...formData, value: e.target.value })} required />
                                        </Field>
                                    )}
                                </FormGrid>
                                {rules.type === 'BUY_X_GET_Y' && (
                                    <p className={styles.muted}>Por cada N unidades elegibles se cobran M; las más baratas de cada grupo salen gratis.</p>
                                )}
                            </FormSection>

                            {rules.type !== 'COMBO' && rules.scope === 'ITEMS' && (
                                <FormSection step={2} title="Productos elegibles" description="El descuento se calcula por cada línea elegible, no sobre toda la orden.">
                                    <FormGrid>
                                        <Field label="Productos" htmlFor="promo-target-products">
                                            <AppSelect
                                                kind="multi"
                                                inputId="promo-target-products"
                                                options={menuOptions}
                                                value={rules.targetMenuItemIds}
                                                onChange={(ids) => setRules({ ...rules, targetMenuItemIds: ids })}
                                                placeholder="Seleccionar productos..."
                                            />
                                        </Field>
                                        <Field label="Categorías" htmlFor="promo-target-categories">
                                            <AppSelect
                                                kind="multi"
                                                inputId="promo-target-categories"
                                                options={categoryOptions}
                                                value={rules.targetCategoryIds}
                                                onChange={(ids) => setRules({ ...rules, targetCategoryIds: ids })}
                                                placeholder="Seleccionar categorías..."
                                            />
                                        </Field>
                                    </FormGrid>
                                </FormSection>
                            )}

                            {rules.type === 'COMBO' && (
                                <FormSection
                                    step={2}
                                    title="Productos del combo"
                                    description="Cuando la orden contiene el juego completo se cobra el precio del combo (por cada juego). Cada producto se registra y descuenta del inventario por separado."
                                >
                                    {rules.comboItems.map((item, index) => (
                                        <div key={index} className={styles.comboRow}>
                                            <AppSelect
                                                inputId={`promo-combo-item-${index}`}
                                                aria-label={`Producto ${index + 1} del combo`}
                                                options={menuOptions}
                                                value={menuOptions.some((option) => option.value === item.menuItemId) ? item.menuItemId : null}
                                                onChange={(v) => { if (v !== null) updateComboItem(index, { menuItemId: v }); }}
                                                placeholder="Producto..."
                                            />
                                            <NumberInput
                                                aria-label={`Cantidad del producto ${index + 1}`}
                                                decimals={0}
                                                min={1}
                                                value={item.quantity}
                                                onChange={(v) => updateComboItem(index, { quantity: Math.min(99, Math.max(1, Math.trunc(v ?? 1))) })}
                                            />
                                            <IconButton
                                                icon={Trash2}
                                                label={`Quitar producto ${index + 1}`}
                                                onClick={() => setRules({ ...rules, comboItems: rules.comboItems.filter((_, itemIndex) => itemIndex !== index) })}
                                            />
                                        </div>
                                    ))}
                                    <div>
                                        <Button icon={Plus} variant="ghost"
                                            disabled={menuOptions.length === 0}
                                            onClick={() => {
                                                const used = new Set(rules.comboItems.map((item) => item.menuItemId));
                                                const next = menuOptions.find((option) => !used.has(option.value));
                                                if (next) setRules({ ...rules, comboItems: [...rules.comboItems, { menuItemId: next.value, quantity: 1 }] });
                                            }}>
                                            Agregar producto
                                        </Button>
                                    </div>
                                </FormSection>
                            )}

                            <FormSection step={rules.type === 'COMBO' || rules.scope === 'ITEMS' ? 3 : 2} title="Límites" description="Opcionales; vacíos significa sin límite.">
                                <FormGrid>
                                    <Field label="Mínimo de orden" htmlFor="promo-min-order">
                                        <Input id="promo-min-order" type="number" step="0.01" min="0" className="ui-input--number" value={formData.minOrderAmount}
                                            onChange={e => setFormData({ ...formData, minOrderAmount: e.target.value })} placeholder="Opcional" />
                                    </Field>
                                    <Field label="Descuento máximo" htmlFor="promo-max-discount">
                                        <Input id="promo-max-discount" type="number" step="0.01" min="0" className="ui-input--number" value={formData.maxDiscount}
                                            onChange={e => setFormData({ ...formData, maxDiscount: e.target.value })} placeholder="Opcional" />
                                    </Field>
                                    <Field label="Límite de usos" htmlFor="promo-usage-limit">
                                        <Input id="promo-usage-limit" type="number" min="0" className="ui-input--number" value={formData.usageLimit}
                                            onChange={e => setFormData({ ...formData, usageLimit: e.target.value })} placeholder="Ilimitado" />
                                    </Field>
                                </FormGrid>
                            </FormSection>
                        </>
                    )}

                    {activeTab === 'aplicacion' && (
                        <FormSection step={1} title="Sucursales" description="El POS solo ofrece y aplica la promoción en órdenes de las sucursales seleccionadas.">
                            <SegmentedControl<'all' | 'some'>
                                ariaLabel="Sucursales donde aplica"
                                options={[
                                    { value: 'all', label: 'Todas las sucursales' },
                                    { value: 'some', label: 'Solo algunas' },
                                ]}
                                value={rules.allBranches ? 'all' : 'some'}
                                onChange={(v) => setRules({ ...rules, allBranches: v === 'all' })}
                            />
                            {!rules.allBranches && (
                                <FormGrid>
                                    <Field label="Sucursales" htmlFor="promo-branches">
                                        <AppSelect
                                            kind="multi"
                                            inputId="promo-branches"
                                            options={branchOptions}
                                            value={rules.branchIds}
                                            onChange={(ids) => setRules({ ...rules, branchIds: ids })}
                                            placeholder="Seleccionar sucursales..."
                                        />
                                    </Field>
                                </FormGrid>
                            )}
                        </FormSection>
                    )}

                    {activeTab === 'vigencia' && (
                        <>
                            <FormSection step={1} title="Período de vigencia">
                                <FormGrid>
                                    <Field label="Vigente desde" htmlFor="promo-valid-from">
                                        <DateInput id="promo-valid-from" value={formData.validFrom}
                                            onChange={e => setFormData({ ...formData, validFrom: e.target.value })} />
                                    </Field>
                                    <Field label="Vigente hasta" htmlFor="promo-valid-to">
                                        <DateInput id="promo-valid-to" value={formData.validTo}
                                            onChange={e => setFormData({ ...formData, validTo: e.target.value })} />
                                    </Field>
                                </FormGrid>
                            </FormSection>
                            <FormSection
                                step={2}
                                title="Happy hour (opcional)"
                                description={`${describePromotionSchedule(rules) ?? 'Sin días ni horario: la promoción aplica todo el día.'} Se evalúa en la zona horaria de la empresa; si la hora final es menor que la inicial el horario cruza la medianoche. Solo se descuentan los productos pedidos dentro del horario.`}
                            >
                                <div role="group" aria-label="Días" className={styles.inline}>
                                    {WEEKDAYS.map((day) => (
                                        <Button
                                            key={day.value}
                                            title={day.label}
                                            variant={rules.weekdays.includes(day.value) ? 'primary' : 'secondary'}
                                            aria-pressed={rules.weekdays.includes(day.value)}
                                            onClick={() => toggleWeekday(day.value)}
                                        >
                                            {day.short}
                                        </Button>
                                    ))}
                                </div>
                                <FormGrid>
                                    <Field label="Hora inicial" htmlFor="promo-start-time">
                                        <Input id="promo-start-time" type="time" value={rules.dailyStartTime}
                                            onChange={e => setRules({ ...rules, dailyStartTime: e.target.value })} />
                                    </Field>
                                    <Field label="Hora final" htmlFor="promo-end-time">
                                        <Input id="promo-end-time" type="time" value={rules.dailyEndTime}
                                            onChange={e => setRules({ ...rules, dailyEndTime: e.target.value })} />
                                    </Field>
                                </FormGrid>
                            </FormSection>
                        </>
                    )}
                </form>
            </FullScreenModal>
        </PageContent>
    );
}
