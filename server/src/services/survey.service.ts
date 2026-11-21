import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { SessionService } from './session.service';
import { SurveyError } from './survey-errors';
import { assertBranchAccess, resolveBranchScope } from '../utils/branch-scope';
import { parseOptionalQueryDateFrom, parseOptionalQueryDateTo } from '../utils/date-range';
import { getZonedMonthBounds, getZonedParts, zonedDateKey, zonedStartOfDay } from '../utils/timezone';
import { MIN_RANKING_RESPONSES, RANKING_PRIOR_WEIGHT, meanOrNull, npsSummary, rankWaiters } from '../utils/nps';

export interface SurveyActor {
    userId: number;
    companyId: number;
    branchId?: number | null;
    role?: string;
    roles?: string[];
}

export interface SurveyViewer extends SurveyActor {
    timezone?: string;
}

export interface SurveyReportFilters {
    dateFrom?: string;
    dateTo?: string;
    branchId?: number;
}

export interface SurveyResponsesFilters extends SurveyReportFilters {
    waiterUserId?: number;
    detractorsOnly?: boolean;
    page?: number;
    pageSize?: number;
}

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MIN_SELF_RESPONSES = 3;
const MAX_RANGE_MS = 366 * 24 * 60 * 60 * 1000;

export interface SurveySubmitResult {
    id: number;
    orderId: number;
    created: boolean;
}

const PHONE_RE = /^[0-9+()\-\s]{6,30}$/;
const DEVICE_TAG_RE = /^op-device:(\d+)$/;

function intInRange(value: unknown, min: number, max: number): number {
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) throw new SurveyError('SURVEY_INVALID');
    return n;
}

function optionalRating(value: unknown): number | null {
    return value === undefined || value === null || value === '' ? null : intInRange(value, 1, 5);
}

function optionalText(value: unknown, max: number): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') throw new SurveyError('SURVEY_INVALID');
    const text = value.trim();
    if (text.length > max) throw new SurveyError('SURVEY_INVALID');
    return text === '' ? null : text;
}

/** Hand-cast and validate the body (validate() does not write coerced values back). */
export function normalizeSurveyInput(raw: Record<string, unknown>) {
    const contactPhone = optionalText(raw.contactPhone, 30);
    if (contactPhone !== null && !PHONE_RE.test(contactPhone)) throw new SurveyError('SURVEY_INVALID');
    return {
        orderId: intInRange(raw.orderId, 1, 2147483647),
        nps: intInRange(raw.nps, 0, 10),
        waiterRating: optionalRating(raw.waiterRating),
        waitRating: optionalRating(raw.waitRating),
        ambienceRating: optionalRating(raw.ambienceRating),
        foodRating: optionalRating(raw.foodRating),
        comment: optionalText(raw.comment, 500),
        contactPhone,
    };
}

function roundAvg(value: number): number {
    return Math.round(value * 10) / 10;
}

export class SurveyService {
    private static tz(viewer: SurveyViewer): string {
        return viewer.timezone || 'UTC';
    }

    private static scope(viewer: SurveyViewer, branchId?: number) {
        return resolveBranchScope(viewer as Parameters<typeof resolveBranchScope>[0], branchId);
    }

    private static dateWindow(viewer: SurveyViewer, f: SurveyReportFilters) {
        const tz = SurveyService.tz(viewer);
        const given = { from: parseOptionalQueryDateFrom(f.dateFrom, tz), to: parseOptionalQueryDateTo(f.dateTo, tz) };
        // Always bounded: a missing side defaults to the current month in the user timezone.
        const gte = given.from ?? getZonedMonthBounds(tz, given.to ?? new Date()).start;
        const lte = given.to ?? getZonedMonthBounds(tz).endInclusive;
        if (lte.getTime() - gte.getTime() > MAX_RANGE_MS) throw new SurveyError('SURVEY_RANGE_TOO_LARGE');
        return { createdAt: { gte, lte } };
    }

    /** [start, endExclusive) of a YYYY-MM month in the viewer timezone; defaults to the current month. */
    static monthBounds(viewer: SurveyViewer, month?: string) {
        const tz = SurveyService.tz(viewer);
        let year: number;
        let mon: number;
        if (month === undefined || month === '') {
            const now = getZonedParts(new Date(), tz);
            year = now.year;
            mon = now.month;
        } else {
            const m = MONTH_RE.exec(month);
            if (!m) throw new SurveyError('SURVEY_INVALID');
            year = Number(m[1]);
            mon = Number(m[2]);
        }
        const next = new Date(Date.UTC(year, mon, 1));
        return {
            month: `${year}-${String(mon).padStart(2, '0')}`,
            start: zonedStartOfDay({ year, month: mon, day: 1 }, tz),
            endExclusive: zonedStartOfDay({ year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: 1 }, tz),
        };
    }

    private static async names(companyId: number, userIds: number[], branchIds: number[]) {
        const [users, branches] = await Promise.all([
            userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
            branchIds.length ? prisma.branch.findMany({ where: { companyId, id: { in: branchIds } }, select: { id: true, name: true } }) : [],
        ]);
        return {
            user: new Map(users.map((u) => [u.id, u.name])),
            branch: new Map(branches.map((b) => [b.id, b.name])),
        };
    }

    /** Monday (local calendar date) of the week containing the instant. */
    private static weekStart(date: Date, tz: string): string {
        const [y, m, d] = zonedDateKey(date, tz).split('-').map(Number);
        const day = new Date(Date.UTC(y, m - 1, d));
        day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
        return day.toISOString().slice(0, 10);
    }

    static async summary(viewer: SurveyViewer, filters: SurveyReportFilters) {
        const branchId = SurveyService.scope(viewer, filters.branchId);
        const rows = await prisma.surveyResponse.findMany({
            where: { companyId: viewer.companyId, ...(branchId ? { branchId } : {}), ...SurveyService.dateWindow(viewer, filters) },
            select: {
                nps: true, waiterRating: true, foodRating: true, waitRating: true, ambienceRating: true,
                waiterUserId: true, branchId: true, createdAt: true,
            },
            orderBy: { createdAt: 'asc' },
        });
        const tz = SurveyService.tz(viewer);
        type Row = (typeof rows)[number];
        const ratings = (key: 'waiterRating' | 'foodRating' | 'waitRating' | 'ambienceRating', list: Row[] = rows) =>
            list.map((r) => r[key]).filter((v): v is number => v !== null);
        const group = <K extends string | number>(keyOf: (r: Row) => K) => {
            const map = new Map<K, Row[]>();
            for (const r of rows) {
                const k = keyOf(r);
                const list = map.get(k);
                if (list) list.push(r); else map.set(k, [r]);
            }
            return map;
        };
        const names = await SurveyService.names(
            viewer.companyId,
            [...new Set(rows.map((r) => r.waiterUserId))],
            [...new Set(rows.map((r) => r.branchId))],
        );
        return {
            ...npsSummary(rows.map((r) => r.nps)),
            avgWaiter: meanOrNull(ratings('waiterRating')),
            avgFood: meanOrNull(ratings('foodRating')),
            avgWait: meanOrNull(ratings('waitRating')),
            avgAmbience: meanOrNull(ratings('ambienceRating')),
            trend: [...group((r) => SurveyService.weekStart(r.createdAt, tz))]
                .sort(([a], [b]) => (a < b ? -1 : 1))
                .map(([weekStart, list]) => {
                    const s = npsSummary(list.map((r) => r.nps));
                    return { weekStart, responses: s.responses, nps: s.nps };
                }),
            byWaiter: [...group((r) => r.waiterUserId)]
                .map(([userId, list]) => ({
                    userId,
                    name: names.user.get(userId) ?? '',
                    responses: list.length,
                    nps: npsSummary(list.map((r) => r.nps)).nps,
                    avgWaiter: meanOrNull(ratings('waiterRating', list)),
                }))
                .sort((a, b) => b.responses - a.responses),
            byBranch: [...group((r) => r.branchId)]
                .map(([id, list]) => ({
                    branchId: id,
                    name: names.branch.get(id) ?? '',
                    responses: list.length,
                    nps: npsSummary(list.map((r) => r.nps)).nps,
                }))
                .sort((a, b) => b.responses - a.responses),
        };
    }

    static async responses(viewer: SurveyViewer, filters: SurveyResponsesFilters) {
        const page = filters.page ?? 1;
        const pageSize = filters.pageSize ?? 20;
        if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
            throw new SurveyError('SURVEY_INVALID');
        }
        const branchId = SurveyService.scope(viewer, filters.branchId);
        const where = {
            companyId: viewer.companyId,
            ...(branchId ? { branchId } : {}),
            ...(filters.waiterUserId ? { waiterUserId: filters.waiterUserId } : {}),
            ...(filters.detractorsOnly ? { nps: { lte: 6 } } : {}),
            ...SurveyService.dateWindow(viewer, filters),
        };
        const [rows, total] = await Promise.all([
            prisma.surveyResponse.findMany({
                where,
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                skip: (page - 1) * pageSize,
                take: pageSize,
                select: {
                    id: true, createdAt: true, orderId: true, nps: true, waiterRating: true, foodRating: true,
                    waitRating: true, ambienceRating: true, comment: true, contactPhone: true,
                    branch: { select: { name: true } }, waiter: { select: { name: true } },
                },
            }),
            prisma.surveyResponse.count({ where }),
        ]);
        return {
            items: rows.map((r) => ({
                id: r.id,
                createdAt: r.createdAt,
                branchName: r.branch.name,
                waiterName: r.waiter.name,
                orderId: r.orderId,
                nps: r.nps,
                waiterRating: r.waiterRating,
                foodRating: r.foodRating,
                waitRating: r.waitRating,
                ambienceRating: r.ambienceRating,
                comment: r.comment,
                contactPhone: r.contactPhone,
            })),
            total,
            page,
            pageSize,
        };
    }

    private static async computeRanking(viewer: SurveyViewer, monthKey: string | undefined, branchScope: number | undefined) {
        const { month, start, endExclusive } = SurveyService.monthBounds(viewer, monthKey);
        const rows = await prisma.surveyResponse.findMany({
            where: {
                companyId: viewer.companyId,
                ...(branchScope ? { branchId: branchScope } : {}),
                createdAt: { gte: start, lt: endExclusive },
            },
            select: { waiterUserId: true, branchId: true, nps: true, waiterRating: true },
            orderBy: { createdAt: 'desc' },
        });
        const byWaiter = new Map<number, typeof rows>();
        for (const r of rows) {
            const list = byWaiter.get(r.waiterUserId);
            if (list) list.push(r); else byWaiter.set(r.waiterUserId, [r]);
        }
        const names = await SurveyService.names(viewer.companyId, [...byWaiter.keys()], [...new Set(rows.map((r) => r.branchId))]);
        const inputs = [...byWaiter]
            .map(([userId, list]) => {
                const rated = list.map((r) => r.waiterRating).filter((v): v is number => v !== null);
                return {
                    userId,
                    name: names.user.get(userId) ?? '',
                    // the newest response decides the branch shown for the waiter
                    branchName: names.branch.get(list[0].branchId) ?? null,
                    responses: rated.length,
                    attentionAvg: rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : 0,
                    nps: npsSummary(list.map((r) => r.nps)).nps,
                };
            })
            .filter((r) => r.responses > 0);
        return { month, ...rankWaiters(inputs, RANKING_PRIOR_WEIGHT, MIN_RANKING_RESPONSES) };
    }

    static async ranking(viewer: SurveyViewer, month: string | undefined, branchId?: number) {
        const ranked = await SurveyService.computeRanking(viewer, month, SurveyService.scope(viewer, branchId));
        return {
            month: ranked.month,
            minResponses: MIN_RANKING_RESPONSES,
            items: ranked.items.map((r) => ({
                rank: r.rank,
                userId: r.userId,
                name: r.name,
                branchName: r.branchName,
                responses: r.responses,
                attentionAvg: roundAvg(r.attentionAvg),
                score: r.score,
                nps: r.nps,
            })),
            ineligible: ranked.ineligible,
        };
    }

    /** Waiter self view: aggregates only, masked below 3 responses, never comments or phones. */
    static async mine(viewer: SurveyViewer, month: string | undefined) {
        const { month: key, start, endExclusive } = SurveyService.monthBounds(viewer, month);
        const own = await prisma.surveyResponse.findMany({
            where: { companyId: viewer.companyId, waiterUserId: viewer.userId, createdAt: { gte: start, lt: endExclusive } },
            select: { nps: true, waiterRating: true },
        });
        // The ranking position is company-wide regardless of the viewer's branch.
        const ranked = await SurveyService.computeRanking(viewer, key, undefined);
        const position = ranked.items.find((r) => r.userId === viewer.userId);
        const visible = own.length >= MIN_SELF_RESPONSES;
        return {
            month: key,
            responses: own.length,
            attentionAvg: visible ? meanOrNull(own.map((r) => r.waiterRating).filter((v): v is number => v !== null)) : null,
            nps: visible ? npsSummary(own.map((r) => r.nps)).nps : null,
            rank: position ? position.rank : null,
            rankedCount: ranked.items.length,
        };
    }

    /**
     * Stores the customer's answer for a paid order. The service tablet is
     * derived from the session tag (`op-device:<id>`); the answer is attributed
     * to the order's creator, never to whoever is logged in at payment time.
     * Idempotent per order: a repeat returns the stored row with created=false.
     */
    static async submit(
        actor: SurveyActor,
        sessionToken: string | null,
        raw: Record<string, unknown>,
    ): Promise<SurveySubmitResult> {
        const input = normalizeSurveyInput(raw);

        const tag = sessionToken ? await SessionService.deviceOf(sessionToken) : null;
        const deviceId = tag ? Number(DEVICE_TAG_RE.exec(tag)?.[1]) : NaN;
        if (!Number.isInteger(deviceId)) throw new SurveyError('SURVEY_DEVICE_REQUIRED');
        const device = await prisma.operationalDevice.findUnique({ where: { id: deviceId } });
        if (!device || device.status !== 'ACTIVE' || device.type !== 'SERVICE_TABLET' || device.companyId !== actor.companyId) {
            throw new SurveyError('SURVEY_DEVICE_REQUIRED');
        }

        const order = await prisma.order.findFirst({
            where: { id: input.orderId, companyId: actor.companyId },
            select: { id: true, branchId: true, userId: true, financialStatus: true },
        });
        if (!order) throw new SurveyError('SURVEY_ORDER_NOT_FOUND');
        assertBranchAccess(actor as Parameters<typeof assertBranchAccess>[0], order.branchId);
        if (device.branchId !== order.branchId) throw new SurveyError('SURVEY_DEVICE_REQUIRED');
        if (order.financialStatus !== 'PAID') throw new SurveyError('SURVEY_ORDER_NOT_PAID');

        const existing = await prisma.surveyResponse.findUnique({ where: { orderId: order.id }, select: { id: true } });
        if (existing) return { id: existing.id, orderId: order.id, created: false };

        try {
            const row = await prisma.surveyResponse.create({
                data: {
                    companyId: actor.companyId,
                    branchId: order.branchId,
                    orderId: order.id,
                    waiterUserId: order.userId,
                    operationalDeviceId: device.id,
                    nps: input.nps,
                    waiterRating: input.waiterRating,
                    waitRating: input.waitRating,
                    ambienceRating: input.ambienceRating,
                    foodRating: input.foodRating,
                    comment: input.comment,
                    contactPhone: input.contactPhone,
                },
                select: { id: true },
            });
            return { id: row.id, orderId: order.id, created: true };
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                const winner = await prisma.surveyResponse.findUnique({ where: { orderId: order.id }, select: { id: true } });
                if (winner) return { id: winner.id, orderId: order.id, created: false };
            }
            throw error;
        }
    }
}
