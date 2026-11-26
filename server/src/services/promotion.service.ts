import type { Prisma, Promotion } from '@prisma/client';
import prisma from '../utils/prisma';
import { getZonedParts, parseZonedDateEnd, parseZonedDateStart, zonedDateKey } from '../utils/timezone';
import { DEFAULT_COMPANY_SETTINGS, SettingService } from './setting.service';

export type PromotionValidationCode =
    | 'INVALID_TOTAL'
    | 'INACTIVE'
    | 'NOT_STARTED'
    | 'EXPIRED'
    | 'USAGE_LIMIT'
    | 'MINIMUM_NOT_MET'
    | 'OUTSIDE_SCHEDULE'
    | 'BRANCH_NOT_ELIGIBLE'
    | 'NO_ELIGIBLE_ITEMS'
    | 'BUY_QUANTITY_NOT_MET'
    | 'COMBO_INCOMPLETE';

export const PROMOTION_VALIDATION_MESSAGES: Record<PromotionValidationCode, string> = {
    INVALID_TOTAL: 'El total de la orden no es válido',
    INACTIVE: 'Esta promoción ya no está activa',
    NOT_STARTED: 'Esta promoción aún no está vigente',
    EXPIRED: 'Esta promoción ha expirado',
    USAGE_LIMIT: 'Esta promoción ha alcanzado su límite de uso',
    MINIMUM_NOT_MET: 'El subtotal no alcanza el monto mínimo de la promoción',
    OUTSIDE_SCHEDULE: 'Esta promoción no está vigente en este día u horario',
    BRANCH_NOT_ELIGIBLE: 'Esta promoción no aplica en esta sucursal',
    NO_ELIGIBLE_ITEMS: 'La orden no contiene productos elegibles para esta promoción',
    BUY_QUANTITY_NOT_MET: 'La orden no alcanza la cantidad de productos requerida por la promoción',
    COMBO_INCOMPLETE: 'La orden no contiene todos los productos del combo'
};

export class PromotionValidationError extends Error {
    constructor(public readonly code: PromotionValidationCode) {
        // User-facing (Spanish) message: order writes surface it verbatim.
        super(PROMOTION_VALIDATION_MESSAGES[code]);
        this.name = 'PromotionValidationError';
    }
}

/** Non-negative money -> integer cents (half-up on the 3rd decimal, float-safe). */
function toCents(value: number): number {
    return Math.round(Math.max(0, value) * 100 + 1e-7);
}

type PromotionBaseRule = Pick<Promotion, 'active' | 'validFrom' | 'validTo' | 'usageLimit' | 'usageCount' | 'minOrderAmount' | 'type' | 'value' | 'maxDiscount'>;

function assertPromotionUsable(promotion: PromotionBaseRule, orderTotal: number, now: Date): number {
    if (!Number.isFinite(orderTotal) || orderTotal < 0) throw new PromotionValidationError('INVALID_TOTAL');
    if (!promotion.active) throw new PromotionValidationError('INACTIVE');
    if (promotion.validFrom > now) throw new PromotionValidationError('NOT_STARTED');
    if (promotion.validTo && promotion.validTo < now) throw new PromotionValidationError('EXPIRED');
    if (promotion.usageLimit !== null && promotion.usageCount >= promotion.usageLimit) {
        throw new PromotionValidationError('USAGE_LIMIT');
    }
    const totalCents = toCents(orderTotal);
    if (promotion.minOrderAmount !== null && totalCents < toCents(Number(promotion.minOrderAmount))) {
        throw new PromotionValidationError('MINIMUM_NOT_MET');
    }
    return totalCents;
}

/** Half-up percentage of an integer-cent base (basis points, no float drift). */
function percentOfCents(baseCents: number, percent: number): number {
    const basisPoints = Math.round(Math.min(Math.max(percent, 0), 100) * 100);
    return Math.floor((baseCents * basisPoints + 5000) / 10000);
}

/**
 * Single authoritative promotion calculation used by preview and order writes.
 * All arithmetic runs in integer cents / basis points so percentage discounts
 * round half-up exactly (e.g. 15% of 1.50 = 0.23, not 0.22 from 0.22499999...).
 * The discount is applied to the pre-tax subtotal; IVA is computed afterwards on
 * the discounted base by the order pricing code.
 *
 * Order-level (legacy) rule; evaluatePromotion() handles every rule and
 * delegates here for ORDER promotions without a schedule.
 */
export function calculatePromotionDiscount(
    promotion: PromotionBaseRule,
    orderTotal: number,
    now = new Date()
): number {
    const totalCents = assertPromotionUsable(promotion, orderTotal, now);
    const value = Number(promotion.value);
    if (!Number.isFinite(value) || value < 0) return 0;
    let discountCents: number;
    if (promotion.type === 'PERCENTAGE') {
        discountCents = percentOfCents(totalCents, value);
    } else {
        discountCents = toCents(value);
    }
    if (promotion.maxDiscount !== null) discountCents = Math.min(discountCents, toCents(Number(promotion.maxDiscount)));
    return Math.min(Math.max(0, discountCents), totalCents) / 100;
}

// ---------------------------------------------------------------------------
// Promotion rules: happy hour, per-item, N x M, combos and branch scope.
// ---------------------------------------------------------------------------

export type PromotionRule = PromotionBaseRule & Partial<Pick<Promotion,
    'scope' | 'weekdays' | 'dailyStartTime' | 'dailyEndTime' | 'allBranches' | 'buyQuantity' | 'payQuantity'>> & {
    branches?: Array<{ branchId: number }>;
    targets?: Array<{ menuItemId: number | null; categoryId: number | null }>;
    comboItems?: Array<{ menuItemId: number; quantity: number }>;
};

/** One sellable order line as seen by the promotion engine. */
export interface PromotionLine {
    /** OrderItem id (or a stable client index for previews). */
    id: number;
    menuItemId: number;
    categoryId: number | null;
    quantity: number;
    /** Unit price including the selected modifiers. */
    unitPrice: number;
    /** Persisted line subtotal; defaults to unitPrice x quantity. */
    subtotal?: number;
    /** Modifier extra per unit (combos price the base product only). */
    modifierUnitPrice?: number;
    /** When the line was ordered (happy hour). Missing = now. */
    orderedAt?: Date | null;
}

export interface PromotionContext {
    /** Gross order subtotal (all sellable lines). */
    subtotal: number;
    lines?: PromotionLine[];
    branchId?: number | null;
    /** Company time zone for the happy-hour window. */
    timeZone?: string;
    now?: Date;
    /**
     * apply: the code is being applied now — it must be inside its schedule and
     * actually discount something. reprice: an already applied code is
     * re-evaluated after its lines changed — a rule that no longer matches any
     * line yields 0 instead of blocking the order (it can match again later).
     */
    mode?: 'apply' | 'reprice';
}

export interface PromotionEvaluation {
    discount: number;
    /** Discount attributed per line (line-based rules only); sums to `discount`. */
    lineDiscounts: Array<{ lineId: number; discount: number }>;
    /** false for legacy order-level rules (proportional allocation, nothing to persist per line). */
    lineBased: boolean;
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parsePromotionWeekdays(value: string | null | undefined): number[] | null {
    if (value === null || value === undefined || !String(value).trim()) return null;
    const days = String(value).split(',').map((part) => Number(part.trim()))
        .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7);
    return days.length > 0 ? Array.from(new Set(days)).sort((a, b) => a - b) : null;
}

function timeToMinutes(value: string): number {
    const match = TIME_RE.exec(value);
    if (!match) return NaN;
    return Number(match[1]) * 60 + Number(match[2]);
}

export function promotionHasSchedule(rule: Pick<PromotionRule, 'weekdays' | 'dailyStartTime' | 'dailyEndTime'>): boolean {
    return Boolean(parsePromotionWeekdays(rule.weekdays) || rule.dailyStartTime || rule.dailyEndTime);
}

/**
 * Happy-hour window in the company time zone. Weekdays are ISO (1 = lunes …
 * 7 = domingo). The daily window is [start, end); when start > end it crosses
 * midnight and the after-midnight part belongs to the START day, e.g. a Friday
 * 22:00–02:00 window is active Saturday 01:30 but not Friday 01:30.
 */
export function isWithinPromotionSchedule(
    rule: Pick<PromotionRule, 'weekdays' | 'dailyStartTime' | 'dailyEndTime'>,
    instant: Date,
    timeZone: string
): boolean {
    const weekdays = parsePromotionWeekdays(rule.weekdays);
    const parts = getZonedParts(instant, timeZone);
    const jsDay = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
    const isoDay = jsDay === 0 ? 7 : jsDay;
    const previousIsoDay = isoDay === 1 ? 7 : isoDay - 1;
    const dayAllowed = (day: number) => !weekdays || weekdays.includes(day);
    if (!rule.dailyStartTime || !rule.dailyEndTime) return dayAllowed(isoDay);
    const start = timeToMinutes(rule.dailyStartTime);
    const end = timeToMinutes(rule.dailyEndTime);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
    const minutes = parts.hour * 60 + parts.minute;
    if (start < end) return minutes >= start && minutes < end && dayAllowed(isoDay);
    if (start > end) {
        return (minutes >= start && dayAllowed(isoDay)) || (minutes < end && dayAllowed(previousIsoDay));
    }
    return false;
}

/** Legacy order-level rule: no per-line attribution, no schedule. */
export function isOrderLevelPromotion(rule: PromotionRule): boolean {
    return (rule.scope ?? 'ORDER') === 'ORDER'
        && (rule.type === 'PERCENTAGE' || rule.type === 'FIXED_AMOUNT')
        && !promotionHasSchedule(rule);
}

/** Largest-remainder split of `totalCents` by weights (ties: lower key first). */
export function allocateCentsByWeight(totalCents: number, weights: number[], keys: number[]): number[] {
    const denominator = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
    if (totalCents <= 0 || denominator <= 0) return weights.map(() => 0);
    const exact = weights.map((weight) => totalCents * Math.max(0, weight) / denominator);
    const result = exact.map(Math.floor);
    const remainder = totalCents - result.reduce((sum, value) => sum + value, 0);
    const order = exact.map((value, index) => ({ index, fraction: value - result[index], key: keys[index] ?? index }))
        .sort((a, b) => b.fraction - a.fraction || a.key - b.key);
    for (let k = 0; k < remainder; k += 1) result[order[k % order.length].index] += 1;
    return result;
}

/**
 * Splits an order discount over its lines: amounts attributed to a line by a
 * line-based promotion stay on that line; any unattributed remainder (legacy
 * order-level promotions, manual discounts) is spread over the remaining net
 * line amounts. With no attribution this is the plain proportional split.
 * Returns null when the attribution is inconsistent (caller falls back).
 */
export function allocateDiscountWithAttribution(
    totalCents: number,
    grossCents: number[],
    attributedCents: number[],
    keys: number[]
): number[] | null {
    const attributedTotal = attributedCents.reduce((sum, value) => sum + value, 0);
    if (attributedTotal <= 0) return null;
    if (attributedTotal > totalCents || attributedCents.some((value, index) => value < 0 || value > grossCents[index])) return null;
    const remainderWeights = grossCents.map((gross, index) => gross - attributedCents[index]);
    const remainder = allocateCentsByWeight(totalCents - attributedTotal, remainderWeights, keys);
    if (totalCents - attributedTotal > 0 && remainder.reduce((sum, value) => sum + value, 0) !== totalCents - attributedTotal) return null;
    return attributedCents.map((value, index) => value + remainder[index]);
}

function lineSubtotalCents(line: PromotionLine): number {
    return line.subtotal !== undefined ? toCents(Number(line.subtotal)) : toCents(Number(line.unitPrice) * line.quantity);
}

function isTargeted(rule: PromotionRule, line: PromotionLine): boolean {
    return (rule.targets ?? []).some((target) =>
        (target.menuItemId !== null && target.menuItemId === line.menuItemId)
        || (target.categoryId !== null && line.categoryId !== null && target.categoryId === line.categoryId));
}

/** Per-unit cents of a line; the last unit absorbs the rounding cent. */
function lineUnits(line: PromotionLine, extraPerUnitCents = 0): Array<{ lineId: number; cents: number }> {
    const total = lineSubtotalCents(line);
    const base = Math.floor(total / line.quantity);
    return Array.from({ length: line.quantity }, (_, index) => ({
        lineId: line.id,
        cents: Math.max(0, (index === line.quantity - 1 ? total - base * (line.quantity - 1) : base) - extraPerUnitCents)
    }));
}

/** N x M: every group of N units (most expensive first) pays M; the cheapest N-M of each group are free. */
function buyXGetYLineDiscounts(lines: PromotionLine[], buy: number, pay: number): Map<number, number> {
    const units = lines.flatMap((line) => lineUnits(line));
    units.sort((a, b) => b.cents - a.cents || a.lineId - b.lineId);
    const result = new Map<number, number>();
    const groups = Math.floor(units.length / buy);
    for (let group = 0; group < groups; group += 1) {
        for (let k = pay; k < buy; k += 1) {
            const unit = units[group * buy + k];
            result.set(unit.lineId, (result.get(unit.lineId) ?? 0) + unit.cents);
        }
    }
    return result;
}

/**
 * Combo: each complete set (every component x quantity) is charged the combo
 * price. Lines keep their own price (inventory is still consumed per real
 * product); the difference is the discount, attributed to the consumed units
 * in proportion to their base price. Modifier extras stay charged. Sets use
 * the cheapest available units, so the discount is never overstated.
 */
function comboLineDiscounts(lines: PromotionLine[], components: Array<{ menuItemId: number; quantity: number }>, comboPriceCents: number) {
    const pools = new Map<number, Array<{ lineId: number; cents: number }>>();
    for (const component of components) pools.set(component.menuItemId, []);
    for (const line of lines) {
        const pool = pools.get(line.menuItemId);
        if (!pool) continue;
        pool.push(...lineUnits(line, toCents(Number(line.modifierUnitPrice ?? 0))));
    }
    for (const pool of pools.values()) pool.sort((a, b) => a.cents - b.cents || a.lineId - b.lineId);
    const sets = components.length === 0 ? 0 : Math.min(...components.map((component) =>
        Math.floor((pools.get(component.menuItemId)?.length ?? 0) / Math.max(1, component.quantity))));
    const result = new Map<number, number>();
    for (let set = 0; set < sets; set += 1) {
        const consumed = components.flatMap((component) =>
            pools.get(component.menuItemId)!.slice(set * component.quantity, (set + 1) * component.quantity));
        const regular = consumed.reduce((sum, unit) => sum + unit.cents, 0);
        const setDiscount = Math.max(0, regular - comboPriceCents);
        const shares = allocateCentsByWeight(setDiscount, consumed.map((unit) => unit.cents), consumed.map((unit) => unit.lineId));
        consumed.forEach((unit, index) => result.set(unit.lineId, (result.get(unit.lineId) ?? 0) + shares[index]));
    }
    return { sets, discounts: result };
}

/**
 * Authoritative evaluation of any promotion rule against an order. ORDER
 * promotions without a schedule return exactly calculatePromotionDiscount()
 * and no line attribution (backward compatible). Every other rule attributes
 * its discount to the lines it was computed from.
 */
export function evaluatePromotion(rule: PromotionRule, context: PromotionContext): PromotionEvaluation {
    const now = context.now ?? new Date();
    const mode = context.mode ?? 'apply';
    if (rule.allBranches === false) {
        const allowed = (rule.branches ?? []).some((branch) => branch.branchId === context.branchId);
        if (!allowed) throw new PromotionValidationError('BRANCH_NOT_ELIGIBLE');
    }
    if (isOrderLevelPromotion(rule)) {
        return { discount: calculatePromotionDiscount(rule, context.subtotal, now), lineDiscounts: [], lineBased: false };
    }
    const subtotalCents = assertPromotionUsable(rule, context.subtotal, now);
    const timeZone = context.timeZone ?? DEFAULT_COMPANY_SETTINGS.timezone;
    const scheduled = promotionHasSchedule(rule);
    if (scheduled && mode === 'apply' && !isWithinPromotionSchedule(rule, now, timeZone)) {
        throw new PromotionValidationError('OUTSIDE_SCHEDULE');
    }
    const sellable = (context.lines ?? []).filter((line) => line.quantity > 0 && lineSubtotalCents(line) > 0);
    const inWindow = scheduled
        ? sellable.filter((line) => isWithinPromotionSchedule(rule, line.orderedAt ?? now, timeZone))
        : sellable;
    const none = (code: PromotionValidationCode): PromotionEvaluation => {
        if (mode === 'apply') throw new PromotionValidationError(code);
        return { discount: 0, lineDiscounts: [], lineBased: true };
    };

    const value = Number(rule.value);
    let perLine = new Map<number, number>();
    if (rule.type === 'COMBO') {
        const components = (rule.comboItems ?? []).filter((item) => item.quantity > 0);
        const { sets, discounts } = comboLineDiscounts(inWindow, components, toCents(value));
        if (sets === 0) return none(scheduled && sellable.length > inWindow.length ? 'OUTSIDE_SCHEDULE' : 'COMBO_INCOMPLETE');
        perLine = discounts;
    } else if ((rule.scope ?? 'ORDER') === 'ORDER') {
        // Scheduled order-level promotion: base = lines ordered inside the window.
        if (inWindow.length === 0) return none('OUTSIDE_SCHEDULE');
        const weights = inWindow.map(lineSubtotalCents);
        const baseCents = weights.reduce((sum, cents) => sum + cents, 0);
        const totalCents = rule.type === 'PERCENTAGE' ? percentOfCents(baseCents, value) : Math.min(toCents(value), baseCents);
        allocateCentsByWeight(totalCents, weights, inWindow.map((line) => line.id))
            .forEach((cents, index) => perLine.set(inWindow[index].id, cents));
    } else {
        const eligible = inWindow.filter((line) => isTargeted(rule, line));
        if (eligible.length === 0) {
            const anyTargeted = sellable.some((line) => isTargeted(rule, line));
            return none(scheduled && anyTargeted ? 'OUTSIDE_SCHEDULE' : 'NO_ELIGIBLE_ITEMS');
        }
        if (rule.type === 'BUY_X_GET_Y') {
            const buy = Number(rule.buyQuantity);
            const pay = Number(rule.payQuantity);
            if (!Number.isInteger(buy) || !Number.isInteger(pay) || buy < 2 || pay < 1 || pay >= buy) return none('NO_ELIGIBLE_ITEMS');
            perLine = buyXGetYLineDiscounts(eligible, buy, pay);
            if (perLine.size === 0) return none('BUY_QUANTITY_NOT_MET');
        } else {
            for (const line of eligible) {
                const lineCents = lineSubtotalCents(line);
                const cents = rule.type === 'PERCENTAGE'
                    ? percentOfCents(lineCents, value)
                    : Math.min(toCents(value), Math.floor(lineCents / line.quantity)) * line.quantity;
                perLine.set(line.id, Math.min(cents, lineCents));
            }
        }
    }

    let entries = Array.from(perLine.entries()).filter(([, cents]) => cents > 0).sort((a, b) => a[0] - b[0]);
    let totalCents = entries.reduce((sum, [, cents]) => sum + cents, 0);
    const capCents = rule.maxDiscount !== null && rule.maxDiscount !== undefined ? toCents(Number(rule.maxDiscount)) : null;
    const limitCents = Math.min(subtotalCents, capCents ?? Number.MAX_SAFE_INTEGER);
    if (totalCents > limitCents) {
        const scaled = allocateCentsByWeight(limitCents, entries.map(([, cents]) => cents), entries.map(([id]) => id));
        entries = entries.map(([id], index) => [id, scaled[index]] as [number, number]).filter(([, cents]) => cents > 0);
        totalCents = limitCents;
    }
    return {
        discount: totalCents / 100,
        lineDiscounts: entries.map(([lineId, cents]) => ({ lineId, discount: cents / 100 })),
        lineBased: true
    };
}

/** Relations needed by evaluatePromotion(). */
export const PROMOTION_RULE_INCLUDE = {
    branches: { select: { branchId: true } },
    targets: { select: { menuItemId: true, categoryId: true } },
    comboItems: { select: { menuItemId: true, quantity: true } }
} satisfies Prisma.PromotionInclude;

/**
 * Evaluates the promotion `code` against the persisted order lines (caller
 * holds the Order lock). Throws `notFoundMessage` when the code does not
 * exist and PromotionValidationError when it does not apply. Order-level
 * promotions without branch restriction keep the legacy single-query path.
 */
export async function evaluateOrderPromotion(
    tx: Prisma.TransactionClient,
    input: { companyId: number; orderId: number; code: string; subtotal: number; mode: 'apply' | 'reprice'; now?: Date },
    notFoundMessage: string
): Promise<PromotionEvaluation> {
    const promotion = await tx.promotion.findFirst({
        where: { companyId: input.companyId, code: input.code.trim().toUpperCase() },
        include: PROMOTION_RULE_INCLUDE
    });
    if (!promotion) throw new Error(notFoundMessage);
    let branchId: number | null = null;
    if (promotion.allBranches === false) {
        const order = await tx.order.findFirst({ where: { id: input.orderId, companyId: input.companyId }, select: { branchId: true } });
        branchId = order?.branchId ?? null;
    }
    let lines: PromotionLine[] | undefined;
    if (!isOrderLevelPromotion(promotion)) {
        const items = await tx.orderItem.findMany({
            where: { orderId: input.orderId },
            select: {
                id: true, menuItemId: true, quantity: true, price: true, subtotal: true, createdAt: true,
                menuItem: { select: { categoryId: true } },
                modifiers: { select: { price: true } }
            },
            orderBy: { id: 'asc' }
        });
        lines = items.map((item) => ({
            id: item.id,
            menuItemId: item.menuItemId,
            categoryId: item.menuItem?.categoryId ?? null,
            quantity: item.quantity,
            unitPrice: Number(item.price),
            subtotal: Number(item.subtotal),
            modifierUnitPrice: (item.modifiers ?? []).reduce((sum, modifier) => sum + Number(modifier.price), 0),
            orderedAt: item.createdAt ?? null
        }));
    }
    const timeZone = promotionHasSchedule(promotion) ? await SettingService.getTimezone(input.companyId) : undefined;
    return evaluatePromotion(promotion, {
        subtotal: input.subtotal, lines, branchId, timeZone, now: input.now, mode: input.mode
    });
}

/**
 * Persists the per-line attribution of Order.discount (OrderItem.promotionDiscount).
 * Lines not listed are reset to 0; only rows whose value changes are written.
 */
export async function syncOrderLinePromotionDiscounts(
    tx: Prisma.TransactionClient,
    orderId: number,
    lineDiscounts: Array<{ lineId: number; discount: number }>
): Promise<void> {
    const target = new Map(lineDiscounts.map((entry) => [entry.lineId, toCents(entry.discount)]));
    const current = await tx.orderItem.findMany({ where: { orderId }, select: { id: true, promotionDiscount: true } });
    for (const item of current ?? []) {
        const currentCents = toCents(Number(item.promotionDiscount ?? 0) || 0);
        const nextCents = target.get(item.id) ?? 0;
        if (currentCents !== nextCents) {
            await tx.orderItem.update({ where: { id: item.id }, data: { promotionDiscount: nextCents / 100 } });
        }
    }
}

/**
 * Promotion windows are configured as calendar dates in the company time zone.
 * A bare YYYY-MM-DD means the whole local day: validFrom = 00:00:00.000 and
 * validTo = 23:59:59.999 local (not UTC midnight, which in America/Managua
 * would end a "valid until the 18th" promotion at 18:00 on the 17th).
 * Full ISO instants are kept as-is.
 */
export function parsePromotionDate(value: Date | string, bound: 'start' | 'end', timeZone: string): Date {
    if (value instanceof Date) return new Date(value.getTime());
    const trimmed = String(value).trim();
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
    if (dateOnly) {
        const parsed = bound === 'start' ? parseZonedDateStart(dateOnly, timeZone) : parseZonedDateEnd(dateOnly, timeZone);
        return parsed;
    }
    return new Date(trimmed);
}

/**
 * Adds the window as calendar dates (YYYY-MM-DD) in the company time zone, the
 * same zone parsePromotionDate uses when saving. Clients must display and edit
 * these keys instead of re-deriving the day in the user's/branch's zone, which
 * would shift the window one day per save when the zones differ.
 */
export function withPromotionDateKeys<T extends { validFrom: Date; validTo: Date | null }>(promotion: T, timeZone: string) {
    return {
        ...promotion,
        validFromDate: zonedDateKey(promotion.validFrom, timeZone),
        validToDate: promotion.validTo ? zonedDateKey(promotion.validTo, timeZone) : null,
    };
}

type PromotionTypeInput = 'PERCENTAGE' | 'FIXED_AMOUNT' | 'BUY_X_GET_Y' | 'COMBO';
type PromotionScopeInput = 'ORDER' | 'ITEMS';

export interface PromotionRulesInput {
    scope?: PromotionScopeInput;
    /** ISO weekdays (1 = lunes … 7 = domingo); null/[] = every day. */
    weekdays?: number[] | null;
    dailyStartTime?: string | null;
    dailyEndTime?: string | null;
    allBranches?: boolean;
    branchIds?: number[];
    targetMenuItemIds?: number[];
    targetCategoryIds?: number[];
    comboItems?: Array<{ menuItemId: number; quantity?: number }>;
    buyQuantity?: number | null;
    payQuantity?: number | null;
}

export interface PromotionWriteInput extends PromotionRulesInput {
    code?: string; name?: string; description?: string | null;
    type?: PromotionTypeInput; value?: number | Prisma.Decimal;
    minOrderAmount?: number | Prisma.Decimal | null; maxDiscount?: number | Prisma.Decimal | null;
    validFrom?: Date | string; validTo?: Date | string | null;
    usageLimit?: number | null; active?: boolean;
}

type PromotionWithRules = Promotion & {
    branches?: Array<{ branchId: number }>;
    targets?: Array<{ menuItemId: number | null; categoryId: number | null }>;
    comboItems?: Array<{ menuItemId: number; quantity: number; menuItem?: { name: string } | null }>;
};

/** Relations returned to the admin UI and POS. */
const PROMOTION_DETAIL_INCLUDE = {
    branches: { select: { branchId: true } },
    targets: { select: { menuItemId: true, categoryId: true } },
    comboItems: { select: { menuItemId: true, quantity: true, menuItem: { select: { name: true } } } }
} satisfies Prisma.PromotionInclude;

function uniquePositiveIds(values: unknown, label: string): number[] {
    if (values === undefined || values === null) return [];
    if (!Array.isArray(values)) throw new Error(`${label} no es válido`);
    const ids = values.map((value) => Number(value));
    if (ids.some((id) => !Number.isInteger(id) || id <= 0)) throw new Error(`${label} no es válido`);
    return Array.from(new Set(ids)).sort((a, b) => a - b);
}

function normalizeTime(value: string | null | undefined, label: string): string | null {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const trimmed = String(value).trim();
    if (!TIME_RE.test(trimmed)) throw new Error(`${label} debe tener el formato HH:mm`);
    return trimmed;
}

/** Serializes a promotion with its rules for the API (company-TZ date keys included). */
export function serializePromotion(promotion: PromotionWithRules, timeZone: string, now = new Date()) {
    const { branches, targets, comboItems, ...rest } = promotion;
    const weekdayList = parsePromotionWeekdays(promotion.weekdays);
    return {
        ...withPromotionDateKeys(rest, timeZone),
        weekdays: weekdayList,
        branchIds: (branches ?? []).map((branch) => branch.branchId).sort((a, b) => a - b),
        targetMenuItemIds: (targets ?? []).flatMap((target) => target.menuItemId !== null ? [target.menuItemId] : []).sort((a, b) => a - b),
        targetCategoryIds: (targets ?? []).flatMap((target) => target.categoryId !== null ? [target.categoryId] : []).sort((a, b) => a - b),
        comboItems: (comboItems ?? []).map((item) => ({
            menuItemId: item.menuItemId,
            quantity: item.quantity,
            ...(item.menuItem ? { name: item.menuItem.name } : {})
        })),
        scheduleActiveNow: promotionHasSchedule(promotion) ? isWithinPromotionSchedule(promotion, now, timeZone) : true
    };
}

/**
 * Promotion Service
 * Handles discounts and promotional codes
 */
export class PromotionService {
    private static normalizeAndValidate(data: PromotionWriteInput, timeZone: string) {
        const normalized: Record<string, unknown> = {};
        if (data.code !== undefined) {
            const code = data.code.trim().toUpperCase();
            if (!code) throw new Error('El código de promoción es requerido');
            normalized.code = code;
        }
        if (data.name !== undefined) {
            const name = data.name.trim();
            if (!name) throw new Error('El nombre de promoción es requerido');
            normalized.name = name;
        }
        if (data.description !== undefined) normalized.description = data.description;
        if (data.type !== undefined) {
            if (!['PERCENTAGE', 'FIXED_AMOUNT', 'BUY_X_GET_Y', 'COMBO'].includes(data.type)) throw new Error('El tipo de promoción no es válido');
            normalized.type = data.type;
        }
        if (data.value !== undefined) {
            const value = Number(data.value);
            // "N x M" has no monetary value: its quantities define the discount.
            const allowsZero = data.type === 'BUY_X_GET_Y';
            if (!Number.isFinite(value) || value < 0 || (!allowsZero && value <= 0)) throw new Error('El valor de la promoción debe ser mayor a 0');
            normalized.value = value;
        }
        for (const field of ['minOrderAmount', 'maxDiscount'] as const) {
            if (data[field] === undefined) continue;
            if (data[field] === null) normalized[field] = null;
            else {
                const value = Number(data[field]);
                if (!Number.isFinite(value) || value < 0) throw new Error(`${field} no puede ser negativo`);
                normalized[field] = value;
            }
        }
        if (data.usageLimit !== undefined) {
            if (data.usageLimit === null) normalized.usageLimit = null;
            else if (!Number.isInteger(Number(data.usageLimit)) || Number(data.usageLimit) <= 0) {
                throw new Error('El límite de usos debe ser un entero mayor a 0');
            } else normalized.usageLimit = Number(data.usageLimit);
        }
        if (data.validFrom !== undefined) {
            const validFrom = parsePromotionDate(data.validFrom, 'start', timeZone);
            if (Number.isNaN(validFrom.getTime())) throw new Error('La fecha inicial no es válida');
            normalized.validFrom = validFrom;
        }
        if (data.validTo !== undefined) {
            if (data.validTo === null) normalized.validTo = null;
            else {
                const validTo = parsePromotionDate(data.validTo, 'end', timeZone);
                if (Number.isNaN(validTo.getTime())) throw new Error('La fecha final no es válida');
                normalized.validTo = validTo;
            }
        }
        if (data.active !== undefined) normalized.active = data.active;
        return normalized;
    }

    /**
     * Validates the rule set as it will be stored (current values merged with
     * the request) and returns the scalar columns plus the relation rows to
     * write. Ids are checked against the company so a promotion can never
     * reference another tenant's branches, menu items or categories.
     */
    private static async resolveRules(
        companyId: number,
        data: PromotionWriteInput,
        current: PromotionWithRules | null
    ) {
        const type = (data.type ?? current?.type ?? 'PERCENTAGE') as PromotionTypeInput;
        let scope = (data.scope ?? current?.scope ?? 'ORDER') as PromotionScopeInput;
        if (scope !== 'ORDER' && scope !== 'ITEMS') throw new Error('El alcance de la promoción no es válido');
        if (type === 'BUY_X_GET_Y' || type === 'COMBO') scope = 'ITEMS';

        // Happy hour
        const weekdaysInput = data.weekdays !== undefined
            ? data.weekdays
            : parsePromotionWeekdays(current?.weekdays);
        let weekdays: string | null = null;
        if (weekdaysInput !== null && weekdaysInput !== undefined) {
            if (!Array.isArray(weekdaysInput)) throw new Error('Los días de la promoción no son válidos');
            const days = weekdaysInput.map(Number);
            if (days.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) throw new Error('Los días de la promoción no son válidos');
            const unique = Array.from(new Set(days)).sort((a, b) => a - b);
            weekdays = unique.length === 0 || unique.length === 7 ? null : unique.join(',');
        }
        const dailyStartTime = data.dailyStartTime !== undefined
            ? normalizeTime(data.dailyStartTime, 'La hora inicial')
            : current?.dailyStartTime ?? null;
        const dailyEndTime = data.dailyEndTime !== undefined
            ? normalizeTime(data.dailyEndTime, 'La hora final')
            : current?.dailyEndTime ?? null;
        if ((dailyStartTime === null) !== (dailyEndTime === null)) throw new Error('Indique hora inicial y hora final del horario');
        if (dailyStartTime !== null && dailyStartTime === dailyEndTime) throw new Error('La hora inicial y la hora final no pueden ser iguales');

        // Branches
        const allBranches = data.allBranches ?? current?.allBranches ?? true;
        const branchIds = data.branchIds !== undefined
            ? uniquePositiveIds(data.branchIds, 'La lista de sucursales')
            : (current?.branches ?? []).map((branch) => branch.branchId);
        if (!allBranches && branchIds.length === 0) throw new Error('Seleccione al menos una sucursal para la promoción');

        // Targets (per-item promotions)
        const menuItemIds = scope === 'ITEMS' && type !== 'COMBO'
            ? (data.targetMenuItemIds !== undefined
                ? uniquePositiveIds(data.targetMenuItemIds, 'La lista de productos')
                : (current?.targets ?? []).flatMap((target) => target.menuItemId !== null ? [target.menuItemId] : []))
            : [];
        const categoryIds = scope === 'ITEMS' && type !== 'COMBO'
            ? (data.targetCategoryIds !== undefined
                ? uniquePositiveIds(data.targetCategoryIds, 'La lista de categorías')
                : (current?.targets ?? []).flatMap((target) => target.categoryId !== null ? [target.categoryId] : []))
            : [];
        if (scope === 'ITEMS' && type !== 'COMBO' && menuItemIds.length + categoryIds.length === 0) {
            throw new Error('Seleccione al menos un producto o categoría para la promoción');
        }

        // Combo components
        let comboItems: Array<{ menuItemId: number; quantity: number }> = [];
        if (type === 'COMBO') {
            const source = data.comboItems !== undefined ? data.comboItems : (current?.comboItems ?? []);
            if (!Array.isArray(source)) throw new Error('Los productos del combo no son válidos');
            const byItem = new Map<number, number>();
            for (const entry of source) {
                const menuItemId = Number(entry?.menuItemId);
                const quantity = entry?.quantity === undefined ? 1 : Number(entry.quantity);
                if (!Number.isInteger(menuItemId) || menuItemId <= 0 || !Number.isInteger(quantity) || quantity <= 0 || quantity > 99) {
                    throw new Error('Los productos del combo no son válidos');
                }
                byItem.set(menuItemId, (byItem.get(menuItemId) ?? 0) + quantity);
            }
            comboItems = Array.from(byItem, ([menuItemId, quantity]) => ({ menuItemId, quantity })).sort((a, b) => a.menuItemId - b.menuItemId);
            if (comboItems.reduce((sum, item) => sum + item.quantity, 0) < 2) {
                throw new Error('El combo debe incluir al menos dos productos');
            }
        }

        // N x M
        let buyQuantity: number | null = null;
        let payQuantity: number | null = null;
        if (type === 'BUY_X_GET_Y') {
            buyQuantity = Number(data.buyQuantity !== undefined ? data.buyQuantity : current?.buyQuantity);
            payQuantity = Number(data.payQuantity !== undefined ? data.payQuantity : current?.payQuantity);
            if (!Number.isInteger(buyQuantity) || !Number.isInteger(payQuantity) || buyQuantity < 2 || buyQuantity > 100
                || payQuantity < 1 || payQuantity >= buyQuantity) {
                throw new Error('La promoción N x M requiere llevar al menos 2 unidades y pagar menos de las que lleva');
            }
        }
        const value = data.value !== undefined ? Number(data.value) : (current ? Number(current.value) : undefined);
        if (type === 'PERCENTAGE' && value !== undefined && value > 100) throw new Error('El porcentaje no puede exceder 100');
        if (type !== 'BUY_X_GET_Y' && value !== undefined && !(value > 0)) throw new Error('El valor de la promoción debe ser mayor a 0');

        // Tenant ownership of every referenced row.
        if (!allBranches) {
            const owned = await prisma.branch.count({ where: { companyId, id: { in: branchIds } } });
            if (owned !== branchIds.length) throw new Error('Una o más sucursales no pertenecen a la empresa');
        }
        const allMenuItemIds = Array.from(new Set([...menuItemIds, ...comboItems.map((item) => item.menuItemId)]));
        if (allMenuItemIds.length > 0) {
            const owned = await prisma.menuItem.count({ where: { companyId, id: { in: allMenuItemIds } } });
            if (owned !== allMenuItemIds.length) throw new Error('Uno o más productos no pertenecen a la empresa');
        }
        if (categoryIds.length > 0) {
            const owned = await prisma.category.count({ where: { companyId, id: { in: categoryIds } } });
            if (owned !== categoryIds.length) throw new Error('Una o más categorías no pertenecen a la empresa');
        }

        return {
            scalars: { scope, weekdays, dailyStartTime, dailyEndTime, allBranches, buyQuantity, payQuantity },
            branchIds: allBranches ? [] : branchIds,
            menuItemIds,
            categoryIds,
            comboItems
        };
    }

    private static async writeRuleRelations(
        tx: Prisma.TransactionClient,
        promotionId: number,
        rules: Awaited<ReturnType<typeof PromotionService.resolveRules>>
    ) {
        await tx.promotionBranch.deleteMany({ where: { promotionId } });
        await tx.promotionTarget.deleteMany({ where: { promotionId } });
        await tx.promotionComboItem.deleteMany({ where: { promotionId } });
        if (rules.branchIds.length > 0) {
            await tx.promotionBranch.createMany({ data: rules.branchIds.map((branchId) => ({ promotionId, branchId })) });
        }
        const targets = [
            ...rules.menuItemIds.map((menuItemId) => ({ promotionId, menuItemId })),
            ...rules.categoryIds.map((categoryId) => ({ promotionId, categoryId }))
        ];
        if (targets.length > 0) await tx.promotionTarget.createMany({ data: targets });
        if (rules.comboItems.length > 0) {
            await tx.promotionComboItem.createMany({ data: rules.comboItems.map((item) => ({ promotionId, ...item })) });
        }
    }

    /** Company time zone, read only when a bound is a bare calendar date. */
    private static async resolveWindowTimeZone(
        companyId: number,
        data: { validFrom?: Date | string | null; validTo?: Date | string | null }
    ): Promise<string> {
        const isDateOnly = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
        return isDateOnly(data.validFrom) || isDateOnly(data.validTo)
            ? await SettingService.getTimezone(companyId)
            : 'UTC';
    }

    /**
     * Get all promotions for a company. `branchId` keeps only promotions valid
     * in that branch; `availableNow` (with the company time zone) also drops
     * promotions outside their happy-hour window.
     */
    static async getAll(companyId: number, activeOnly = true, options: { branchId?: number; availableNow?: boolean; timeZone?: string } = {}) {
        const where: Prisma.PromotionWhereInput = { companyId };

        if (activeOnly) {
            where.active = true;
            where.validFrom = { lte: new Date() };
            where.OR = [
                { validTo: null },
                { validTo: { gte: new Date() } }
            ];
        }
        if (options.branchId !== undefined) {
            where.AND = [{ OR: [{ allBranches: true }, { branches: { some: { branchId: options.branchId } } }] }];
        }

        const promotions = await prisma.promotion.findMany({
            where,
            include: PROMOTION_DETAIL_INCLUDE,
            orderBy: { createdAt: 'desc' }
        });
        if (!options.availableNow) return promotions;
        const now = new Date();
        const timeZone = options.timeZone ?? await SettingService.getTimezone(companyId);
        return promotions.filter((promotion) => !promotionHasSchedule(promotion) || isWithinPromotionSchedule(promotion, now, timeZone));
    }

    /**
     * Get promotion by code
     */
    static async getByCode(code: string, companyId: number) {
        // companyId is required so a code belonging to another tenant can never be returned.
        return await prisma.promotion.findFirst({
            where: { code: code.toUpperCase(), companyId },
            include: PROMOTION_RULE_INCLUDE
        });
    }

    /**
     * Create a new promotion
     */
    static async create(companyId: number, data: PromotionWriteInput & {
        code: string;
        name: string;
        type: PromotionTypeInput;
    }) {
        const input = data.type === 'BUY_X_GET_Y' && data.value === undefined ? { ...data, value: 0 } : data;
        const normalized = this.normalizeAndValidate(input, await this.resolveWindowTimeZone(companyId, data));
        if (normalized.value === undefined) throw new Error('El valor de la promoción debe ser mayor a 0');
        const validFrom = (normalized.validFrom as Date | undefined) ?? new Date();
        const validTo = normalized.validTo as Date | null | undefined;
        if (validTo && validTo < validFrom) throw new Error('La fecha final no puede ser anterior a la fecha inicial');
        const rules = await this.resolveRules(companyId, input, null);
        if (data.type === 'BUY_X_GET_Y') normalized.value = 0;
        return await prisma.$transaction(async (tx) => {
            const created = await tx.promotion.create({
                data: { companyId, ...normalized, ...rules.scalars, validFrom } as Prisma.PromotionUncheckedCreateInput
            });
            await this.writeRuleRelations(tx, created.id, rules);
            return await tx.promotion.findUniqueOrThrow({ where: { id: created.id }, include: PROMOTION_DETAIL_INCLUDE });
        });
    }

    /**
     * Update a promotion
     */
    static async update(id: number, companyId: number, data: PromotionWriteInput) {
        const promo = await prisma.promotion.findFirst({ where: { id, companyId }, include: PROMOTION_RULE_INCLUDE });
        if (!promo) throw new Error('Promoción no encontrada');
        const normalizedData = this.normalizeAndValidate(data, await this.resolveWindowTimeZone(companyId, data)) as Prisma.PromotionUpdateInput;
        const nextFrom = data.validFrom === undefined ? promo.validFrom : normalizedData.validFrom as Date;
        const nextTo = data.validTo === undefined ? promo.validTo : (normalizedData.validTo as Date | null);
        if (nextTo && nextTo < nextFrom) throw new Error('La fecha final no puede ser anterior a la fecha inicial');
        const rules = await this.resolveRules(companyId, data, promo);
        if ((data.type ?? promo.type) === 'BUY_X_GET_Y') normalizedData.value = 0;
        // Orders, prefactura reservations and settlement claims resolve the
        // promotion by code. Renaming a code already applied to an order would
        // orphan those uses (never claimed / never released). Legacy rows may
        // hold a padded/lower-case code: re-saving its normalized form is not a
        // rename and must not rewrite the stored code.
        const nextCode = normalizedData.code as string | undefined;
        return await prisma.$transaction(async (tx) => {
            // Serialize with concurrent renames/updates of the same promotion so
            // the reference check and the write see the same code.
            await tx.$queryRaw`SELECT id FROM \`Promotion\` WHERE id = ${id} AND companyId = ${companyId} FOR UPDATE`;
            const locked = await tx.promotion.findFirst({ where: { id, companyId }, select: { code: true } });
            if (!locked) throw new Error('Promoción no encontrada');
            const currentCode = locked.code.trim().toUpperCase();
            const isRename = nextCode !== undefined && nextCode !== currentCode;
            if (nextCode !== undefined && !isRename) delete normalizedData.code;
            if (isRename) {
                const referencing = await tx.order.count({
                    where: { companyId, discountCode: { in: Array.from(new Set([locked.code, currentCode])) } }
                });
                if (referencing > 0) {
                    throw new Error('El código ya fue aplicado a órdenes; desactive esta promoción y cree una nueva con el código deseado');
                }
            }
            await tx.promotion.update({
                where: { id },
                data: { ...normalizedData, ...rules.scalars }
            });
            await this.writeRuleRelations(tx, id, rules);
            return await tx.promotion.findUniqueOrThrow({ where: { id }, include: PROMOTION_DETAIL_INCLUDE });
        });
    }

    /**
     * Validate and preview a promotion (POS). `items` are the order lines the
     * code would apply to (needed by per-item, combo and happy-hour rules) and
     * `branchId` the order's branch. The order write recomputes the discount
     * authoritatively from the persisted lines.
     */
    static async validateAndApply(code: string, orderTotal: number, companyId: number, options: {
        branchId?: number | null;
        items?: Array<{ menuItemId: number; quantity: number; unitPrice: number; modifierUnitPrice?: number }>;
        now?: Date;
    } = {}): Promise<{
        valid: boolean;
        discount: number;
        message: string;
        promotion?: Promotion;
        lineDiscounts?: Array<{ lineId: number; discount: number }>;
    }> {
        const promotion = await this.getByCode(code.toUpperCase(), companyId);

        if (!promotion) {
            return { valid: false, discount: 0, message: 'Código de promoción no encontrado' };
        }

        let evaluation: PromotionEvaluation;
        try {
            let lines: PromotionLine[] | undefined;
            if (!isOrderLevelPromotion(promotion) && options.items?.length) {
                const menuItemIds = Array.from(new Set(options.items.map((item) => Number(item.menuItemId))));
                const menuItems = await prisma.menuItem.findMany({
                    where: { companyId, id: { in: menuItemIds } },
                    select: { id: true, categoryId: true }
                });
                const categoryByItem = new Map(menuItems.map((item) => [item.id, item.categoryId]));
                lines = options.items.flatMap((item, index) => {
                    if (!categoryByItem.has(Number(item.menuItemId))) return [];
                    const quantity = Number(item.quantity);
                    const unitPrice = Number(item.unitPrice);
                    if (!Number.isInteger(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) return [];
                    return [{
                        id: index,
                        menuItemId: Number(item.menuItemId),
                        categoryId: categoryByItem.get(Number(item.menuItemId)) ?? null,
                        quantity,
                        unitPrice,
                        modifierUnitPrice: Number(item.modifierUnitPrice ?? 0) || 0
                    }];
                });
            }
            const timeZone = promotionHasSchedule(promotion) ? await SettingService.getTimezone(companyId) : undefined;
            evaluation = evaluatePromotion(promotion, {
                subtotal: orderTotal,
                lines,
                branchId: options.branchId ?? null,
                timeZone,
                now: options.now,
                mode: 'apply'
            });
        } catch (error) {
            if (!(error instanceof PromotionValidationError)) throw error;
            const message = error.code === 'MINIMUM_NOT_MET'
                ? `El monto mínimo de compra es ${promotion.minOrderAmount}`
                : PROMOTION_VALIDATION_MESSAGES[error.code];
            return { valid: false, discount: 0, message };
        }
        const discount = evaluation.discount;

        const settings = await prisma.setting.findMany({ where: { companyId: promotion.companyId } });
        const currencySymbol = settings.find((s) => s.name === `${promotion.companyId}_currency_symbol`)?.value || 'C$';

        return {
            valid: true,
            discount,
            message: `Descuento de ${currencySymbol}${discount.toFixed(2)} aplicado`,
            promotion,
            lineDiscounts: evaluation.lineDiscounts
        };
    }

    /**
     * Increment usage count atomically with conditional check to prevent race conditions.
     * Returns null if usage limit was already reached.
     */
    static async incrementUsage(promotionId: number) {
        // Atomic conditional update: only increment if under the limit
        const promotion = await prisma.promotion.findUnique({ where: { id: promotionId } });
        if (!promotion) return null;

        if (promotion.usageLimit) {
            // Use updateMany with a condition to prevent exceeding the limit
            const result = await prisma.promotion.updateMany({
                where: {
                    id: promotionId,
                    OR: [
                        { usageLimit: null },
                        { usageCount: { lt: promotion.usageLimit } }
                    ]
                },
                data: {
                    usageCount: { increment: 1 }
                }
            });
            if (result.count === 0) {
                throw new Error('La promoción alcanzó su límite de uso');
            }
            return result;
        }

        return await prisma.promotion.update({
            where: { id: promotionId },
            data: {
                usageCount: { increment: 1 }
            }
        });
    }

    /**
     * Deactivate a promotion
     */
    static async deactivate(id: number, companyId: number) {
        const promo = await prisma.promotion.findFirst({ where: { id, companyId } });
        if (!promo) throw new Error('Promoción no encontrada');

        return await prisma.promotion.update({
            where: { id },
            data: { active: false }
        });
    }
}

export const PROMOTION_USAGE_RESERVED = 'PROMOTION_USAGE_RESERVED';
export const PROMOTION_USAGE_RELEASED = 'PROMOTION_USAGE_RELEASED';

type PromotionTx = Prisma.TransactionClient;

/**
 * Per-order promotion usage reservations are recorded as an append-only
 * AuditLog pair (RESERVED / RELEASED) on the Order entity, so no schema
 * change is needed. Callers MUST hold the Order row lock: the latest marker is
 * the authoritative reservation state for that order.
 */
export async function getActivePromotionReservation(
    tx: PromotionTx,
    companyId: number,
    orderId: number
): Promise<{ promotionId: number; code: string } | null> {
    const latest = await tx.auditLog.findFirst({
        where: {
            companyId,
            entityType: 'Order',
            entityId: orderId,
            action: { in: [PROMOTION_USAGE_RESERVED, PROMOTION_USAGE_RELEASED] }
        },
        orderBy: { id: 'desc' },
        select: { action: true, details: true }
    });
    if (!latest || latest.action !== PROMOTION_USAGE_RESERVED) return null;
    const details = (latest.details ?? {}) as { promotionId?: unknown; code?: unknown };
    const promotionId = Number(details.promotionId);
    if (!Number.isInteger(promotionId) || promotionId <= 0) return null;
    return { promotionId, code: typeof details.code === 'string' ? details.code : '' };
}

/** Atomic conditional increment that never exceeds the limit read under the same predicate. */
async function claimPromotionSlot(tx: PromotionTx, promotion: { id: number; usageLimit: number | null }) {
    const claimed = await tx.promotion.updateMany({
        where: {
            id: promotion.id,
            usageLimit: promotion.usageLimit,
            ...(promotion.usageLimit === null ? {} : { usageCount: { lt: promotion.usageLimit } })
        },
        data: { usageCount: { increment: 1 } }
    });
    return claimed.count === 1;
}

/**
 * Claims one promotion use for the order when its prefactura is issued, so a
 * partially paid account can never become unsettleable because the limit was
 * consumed by other orders meanwhile. Idempotent per order.
 */
export async function reservePromotionUsageForOrder(
    tx: PromotionTx,
    input: { companyId: number; orderId: number; discountCode: string | null | undefined; userId: number }
): Promise<boolean> {
    const code = input.discountCode?.trim().toUpperCase();
    if (!code) return false;
    const promotion = await tx.promotion.findFirst({
        where: { companyId: input.companyId, code },
        select: { id: true, usageLimit: true }
    });
    if (!promotion) return false;
    const active = await getActivePromotionReservation(tx, input.companyId, input.orderId);
    if (active?.promotionId === promotion.id) return false;
    if (active) {
        await releasePromotionReservationForOrder(tx, {
            companyId: input.companyId, orderId: input.orderId, userId: input.userId,
            reason: 'Código de promoción reemplazado'
        });
    }
    if (!(await claimPromotionSlot(tx, promotion))) {
        throw new Error('La promoción alcanzó su límite de uso; retire el código antes de emitir la prefactura');
    }
    await tx.auditLog.create({
        data: {
            companyId: input.companyId,
            entityType: 'Order',
            entityId: input.orderId,
            action: PROMOTION_USAGE_RESERVED,
            userId: input.userId,
            details: { promotionId: promotion.id, code }
        }
    });
    return true;
}

/** Releases the order's active reservation (if any). Returns true when one was released. */
export async function releasePromotionReservationForOrder(
    tx: PromotionTx,
    input: { companyId: number; orderId: number; userId: number; reason: string }
): Promise<boolean> {
    const active = await getActivePromotionReservation(tx, input.companyId, input.orderId);
    if (!active) return false;
    await tx.promotion.updateMany({
        where: { id: active.promotionId, companyId: input.companyId, usageCount: { gt: 0 } },
        data: { usageCount: { decrement: 1 } }
    });
    await tx.auditLog.create({
        data: {
            companyId: input.companyId,
            entityType: 'Order',
            entityId: input.orderId,
            action: PROMOTION_USAGE_RELEASED,
            userId: input.userId,
            details: { promotionId: active.promotionId, code: active.code, reason: input.reason }
        }
    });
    return true;
}

/**
 * Final-settlement claim. Honors an active prefactura reservation for the same
 * promotion (no double count); otherwise claims as before (legacy/unreserved).
 */
export async function claimPromotionUsageAtSettlement(
    tx: PromotionTx,
    input: { companyId: number; orderId: number; discountCode: string | null | undefined }
): Promise<void> {
    const code = input.discountCode?.trim().toUpperCase();
    if (!code) return;
    const promotion = await tx.promotion.findFirst({
        where: { companyId: input.companyId, code },
        select: { id: true, usageLimit: true }
    });
    if (!promotion) return;
    const active = await getActivePromotionReservation(tx, input.companyId, input.orderId);
    if (active?.promotionId === promotion.id) return;
    if (!(await claimPromotionSlot(tx, promotion))) {
        throw new Error('La promoción alcanzó su límite de uso');
    }
}

/**
 * Returns the order's single promotion use to the pool when a settled sale is
 * fully reversed (final credit note). Exactly once:
 *  - a prefactura reservation is released through the RESERVED/RELEASED marker
 *    pair (a second call finds no active reservation and is a no-op);
 *  - an unreserved use claimed at settlement is decremented directly; callers
 *    run this only on the transition that un-settles the order.
 */
export async function returnPromotionUsageForOrder(
    tx: PromotionTx,
    input: { companyId: number; orderId: number; discountCode: string | null | undefined; userId: number; reason: string }
): Promise<'RELEASED' | 'DECREMENTED' | 'NONE'> {
    const code = input.discountCode?.trim().toUpperCase();
    if (!code) return 'NONE';
    if (await releasePromotionReservationForOrder(tx, {
        companyId: input.companyId, orderId: input.orderId, userId: input.userId, reason: input.reason
    })) {
        return 'RELEASED';
    }
    const promotion = await tx.promotion.findFirst({
        where: { companyId: input.companyId, code },
        select: { id: true }
    });
    if (!promotion) return 'NONE';
    const result = await tx.promotion.updateMany({
        where: { id: promotion.id, companyId: input.companyId, usageCount: { gt: 0 } },
        data: { usageCount: { decrement: 1 } }
    });
    return result.count === 1 ? 'DECREMENTED' : 'NONE';
}
