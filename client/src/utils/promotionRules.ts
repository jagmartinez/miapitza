/**
 * Promotion rule helpers shared by the admin page (Promociones) and the POS.
 * The server is authoritative: it recomputes every discount from the persisted
 * order lines, so these helpers only build payloads and human-readable labels.
 */

export type PromotionType = 'PERCENTAGE' | 'FIXED_AMOUNT' | 'BUY_X_GET_Y' | 'COMBO';
export type PromotionScope = 'ORDER' | 'ITEMS';

export interface PromotionRulesView {
    type: PromotionType;
    value: number | string;
    scope?: PromotionScope;
    /** ISO weekdays (1 = lunes … 7 = domingo); null = todos los días. */
    weekdays?: number[] | null;
    dailyStartTime?: string | null;
    dailyEndTime?: string | null;
    allBranches?: boolean;
    branchIds?: number[];
    targetMenuItemIds?: number[];
    targetCategoryIds?: number[];
    comboItems?: Array<{ menuItemId: number; quantity: number; name?: string }>;
    buyQuantity?: number | null;
    payQuantity?: number | null;
    /** false when the promotion is outside its happy-hour window right now. */
    scheduleActiveNow?: boolean;
}

export const WEEKDAYS: Array<{ value: number; short: string; label: string }> = [
    { value: 1, short: 'Lun', label: 'Lunes' },
    { value: 2, short: 'Mar', label: 'Martes' },
    { value: 3, short: 'Mié', label: 'Miércoles' },
    { value: 4, short: 'Jue', label: 'Jueves' },
    { value: 5, short: 'Vie', label: 'Viernes' },
    { value: 6, short: 'Sáb', label: 'Sábado' },
    { value: 7, short: 'Dom', label: 'Domingo' },
];

export const PROMOTION_TYPE_LABELS: Record<PromotionType, string> = {
    PERCENTAGE: 'Porcentaje',
    FIXED_AMOUNT: 'Monto Fijo',
    BUY_X_GET_Y: 'N x M',
    COMBO: 'Combo',
};

export function promotionTypeLabel(type: string): string {
    return PROMOTION_TYPE_LABELS[type as PromotionType] ?? type;
}

/** "20%", "C$10.00", "3x2", "Combo C$250.00" (+ " c/u" for per-item fixed amounts). */
export function describePromotionValue(promo: PromotionRulesView, formatMoney: (amount: unknown) => string): string {
    if (promo.type === 'BUY_X_GET_Y') return `${promo.buyQuantity ?? '?'}x${promo.payQuantity ?? '?'}`;
    if (promo.type === 'COMBO') return `Combo ${formatMoney(Number(promo.value))}`;
    if (promo.type === 'PERCENTAGE') return `${Number(promo.value)}%`;
    return `${formatMoney(Number(promo.value))}${promo.scope === 'ITEMS' ? ' c/u' : ''}`;
}

/** Compact day list: "Lun–Vie", "Lun, Mié, Vie", "Todos los días". */
export function describeWeekdays(weekdays: number[] | null | undefined): string {
    const days = Array.from(new Set(weekdays ?? [])).filter((day) => day >= 1 && day <= 7).sort((a, b) => a - b);
    if (days.length === 0 || days.length === 7) return 'Todos los días';
    const isRange = days.length >= 3 && days.every((day, index) => index === 0 || day === days[index - 1] + 1);
    const short = (day: number) => WEEKDAYS[day - 1].short;
    return isRange ? `${short(days[0])}–${short(days[days.length - 1])}` : days.map(short).join(', ');
}

/** "Lun–Vie 17:00–19:00", "Vie 22:00–02:00 (cruza medianoche)", or null without schedule. */
export function describePromotionSchedule(promo: Pick<PromotionRulesView, 'weekdays' | 'dailyStartTime' | 'dailyEndTime'>): string | null {
    const hasDays = Boolean(promo.weekdays && promo.weekdays.length > 0 && promo.weekdays.length < 7);
    const hasTime = Boolean(promo.dailyStartTime && promo.dailyEndTime);
    if (!hasDays && !hasTime) return null;
    const days = describeWeekdays(promo.weekdays);
    if (!hasTime) return days;
    const crosses = String(promo.dailyStartTime) > String(promo.dailyEndTime);
    return `${days} ${promo.dailyStartTime}–${promo.dailyEndTime}${crosses ? ' (cruza medianoche)' : ''}`;
}

/** "Todas las sucursales" or "2 sucursales" / the branch name when only one. */
export function describePromotionBranches(promo: Pick<PromotionRulesView, 'allBranches' | 'branchIds'>, branchName?: (id: number) => string | undefined): string {
    if (promo.allBranches !== false) return 'Todas las sucursales';
    const ids = promo.branchIds ?? [];
    if (ids.length === 1) return branchName?.(ids[0]) ?? '1 sucursal';
    return `${ids.length} sucursales`;
}

/** Scope label for cards/tables. */
export function describePromotionScope(promo: PromotionRulesView): string {
    if (promo.type === 'COMBO') {
        const items = promo.comboItems ?? [];
        return items.length > 0
            ? items.map((item) => `${item.quantity > 1 ? `${item.quantity}× ` : ''}${item.name ?? `#${item.menuItemId}`}`).join(' + ')
            : 'Combo';
    }
    if (promo.scope !== 'ITEMS') return 'Toda la orden';
    const products = promo.targetMenuItemIds?.length ?? 0;
    const categories = promo.targetCategoryIds?.length ?? 0;
    const parts = [
        products > 0 ? `${products} producto${products === 1 ? '' : 's'}` : null,
        categories > 0 ? `${categories} categoría${categories === 1 ? '' : 's'}` : null,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' y ') : 'Productos seleccionados';
}

export interface PromotionRulesForm {
    type: PromotionType;
    scope: PromotionScope;
    weekdays: number[];
    dailyStartTime: string;
    dailyEndTime: string;
    allBranches: boolean;
    branchIds: number[];
    targetMenuItemIds: number[];
    targetCategoryIds: number[];
    comboItems: Array<{ menuItemId: number; quantity: number }>;
    buyQuantity: string;
    payQuantity: string;
}

export const EMPTY_PROMOTION_RULES: PromotionRulesForm = {
    type: 'PERCENTAGE',
    scope: 'ORDER',
    weekdays: [],
    dailyStartTime: '',
    dailyEndTime: '',
    allBranches: true,
    branchIds: [],
    targetMenuItemIds: [],
    targetCategoryIds: [],
    comboItems: [],
    buyQuantity: '',
    payQuantity: '',
};

export function promotionRulesForm(promo: PromotionRulesView): PromotionRulesForm {
    return {
        type: promo.type,
        scope: promo.type === 'COMBO' || promo.type === 'BUY_X_GET_Y' ? 'ITEMS' : (promo.scope ?? 'ORDER'),
        weekdays: promo.weekdays ?? [],
        dailyStartTime: promo.dailyStartTime ?? '',
        dailyEndTime: promo.dailyEndTime ?? '',
        allBranches: promo.allBranches !== false,
        branchIds: promo.branchIds ?? [],
        targetMenuItemIds: promo.targetMenuItemIds ?? [],
        targetCategoryIds: promo.targetCategoryIds ?? [],
        comboItems: (promo.comboItems ?? []).map(({ menuItemId, quantity }) => ({ menuItemId, quantity })),
        buyQuantity: promo.buyQuantity ? String(promo.buyQuantity) : '',
        payQuantity: promo.payQuantity ? String(promo.payQuantity) : '',
    };
}

/** Client-side checks (Spanish) mirrored by the server; returns the first problem or null. */
export function validatePromotionRules(form: PromotionRulesForm): string | null {
    if ((form.dailyStartTime === '') !== (form.dailyEndTime === '')) return 'Indique hora inicial y hora final del horario';
    if (form.dailyStartTime && form.dailyStartTime === form.dailyEndTime) return 'La hora inicial y la hora final no pueden ser iguales';
    if (!form.allBranches && form.branchIds.length === 0) return 'Seleccione al menos una sucursal para la promoción';
    if (form.type === 'COMBO') {
        if (form.comboItems.reduce((sum, item) => sum + item.quantity, 0) < 2) return 'El combo debe incluir al menos dos productos';
        return null;
    }
    const scope = form.type === 'BUY_X_GET_Y' ? 'ITEMS' : form.scope;
    if (scope === 'ITEMS' && form.targetMenuItemIds.length + form.targetCategoryIds.length === 0) {
        return 'Seleccione al menos un producto o categoría para la promoción';
    }
    if (form.type === 'BUY_X_GET_Y') {
        const buy = Number(form.buyQuantity);
        const pay = Number(form.payQuantity);
        if (!Number.isInteger(buy) || !Number.isInteger(pay) || buy < 2 || pay < 1 || pay >= buy) {
            return 'La promoción N x M requiere llevar al menos 2 unidades y pagar menos de las que lleva';
        }
    }
    return null;
}

/** Rule fields of the create/update payload. */
export function promotionRulesPayload(form: PromotionRulesForm): Record<string, unknown> {
    const scope: PromotionScope = form.type === 'COMBO' || form.type === 'BUY_X_GET_Y' ? 'ITEMS' : form.scope;
    return {
        scope,
        weekdays: form.weekdays.length > 0 && form.weekdays.length < 7 ? [...form.weekdays].sort((a, b) => a - b) : null,
        dailyStartTime: form.dailyStartTime || null,
        dailyEndTime: form.dailyEndTime || null,
        allBranches: form.allBranches,
        branchIds: form.allBranches ? [] : form.branchIds,
        targetMenuItemIds: scope === 'ITEMS' && form.type !== 'COMBO' ? form.targetMenuItemIds : [],
        targetCategoryIds: scope === 'ITEMS' && form.type !== 'COMBO' ? form.targetCategoryIds : [],
        comboItems: form.type === 'COMBO' ? form.comboItems : [],
        buyQuantity: form.type === 'BUY_X_GET_Y' ? Number(form.buyQuantity) : null,
        payQuantity: form.type === 'BUY_X_GET_Y' ? Number(form.payQuantity) : null,
    };
}

/** POS line as sent to POST /promotions/validate for the preview. */
export interface PromotionPreviewItem {
    menuItemId: number;
    quantity: number;
    unitPrice: number;
    modifierUnitPrice?: number;
}

/**
 * Lines the POS previews a promotion against: persisted (non-voided) lines of
 * the open order plus the unsent cart. Unit prices already include modifiers.
 */
export function promotionPreviewItems(
    cart: Array<{ menuItemId: number; quantity: number; price: number; modifiers?: Array<{ price: number }> }>,
    orderItems: Array<{ menuItemId: number; quantity: number; price: number | string; modifiers?: Array<{ price: number | string }> }> = [],
): PromotionPreviewItem[] {
    const modifierTotal = (mods?: Array<{ price: number | string }>) => (mods ?? []).reduce((sum, mod) => sum + (Number(mod.price) || 0), 0);
    return [
        ...orderItems.filter((item) => item.quantity > 0).map((item) => ({
            menuItemId: item.menuItemId, quantity: item.quantity, unitPrice: Number(item.price) || 0, modifierUnitPrice: modifierTotal(item.modifiers),
        })),
        ...cart.filter((item) => item.quantity > 0).map((item) => ({
            menuItemId: item.menuItemId, quantity: item.quantity, unitPrice: Number(item.price) || 0, modifierUnitPrice: modifierTotal(item.modifiers),
        })),
    ];
}
