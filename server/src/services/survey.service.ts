import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { assertBranchAccess } from '../utils/branch-scope';
import { SessionService } from './session.service';
import { SurveyError } from './survey-errors';

export interface SurveyActor {
    userId: number;
    companyId: number;
    branchId?: number | null;
    role?: string;
    roles?: string[];
}

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
        serviceRating: optionalRating(raw.serviceRating),
        foodRating: optionalRating(raw.foodRating),
        comment: optionalText(raw.comment, 500),
        contactPhone,
    };
}

export class SurveyService {
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
                    serviceRating: input.serviceRating,
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
