import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { isCompanyWide } from '../utils/branch-scope';
import {
    HrPayrollError,
    PayrollPeriodService,
    PayrollReceiptService,
    PayrollRuleService,
    PayrollRunService,
} from '../services/hr-payroll.service';

function owner(req: Request) {
    if (!isCompanyWide(req.user!)) throw new HrPayrollError('La administración de nómina requiere alcance Owner de empresa', 403, 'HR_PAYROLL_OWNER_REQUIRED');
}

function internalUser(req: Request): number {
    if (req.user!.accountType !== 'INTERNAL' || !req.user!.employeeId) {
        throw new HrPayrollError('El autoservicio de nómina requiere una cuenta INTERNAL ligada a empleado', 403, 'HR_PAYROLL_INTERNAL_REQUIRED');
    }
    return req.user!.userId;
}

function key(req: Request): string { return String(req.get('Idempotency-Key') || ''); }
function id(req: Request): number { return Number(req.params.id); }
function kind(req: Request): 'REGULAR' | 'AGUINALDO' { return req.originalUrl.includes('/aguinaldo/') ? 'AGUINALDO' : 'REGULAR'; }
function filters(req: Request) { return req.query; }
function sendList(res: Response, value: { items: unknown[]; pagination: unknown }) { res.json({ success: true, data: value.items, pagination: value.pagination }); }

function handle(error: unknown, res: Response, next: NextFunction) {
    if (error instanceof HrPayrollError) {
        res.status(error.statusCode).json({ success: false, code: error.code, message: error.message }); return;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') { res.status(409).json({ success: false, message: 'El registro ya existe o fue procesado concurrentemente' }); return; }
        if (error.code === 'P2003') { res.status(400).json({ success: false, message: 'Una referencia no pertenece al alcance permitido' }); return; }
    }
    next(error);
}

async function binary(res: Response, result: { contentType: string; filename: string; buffer: Buffer }) {
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}"`);
    res.send(result.buffer);
}

export class HrPayrollController {
    static async companyTaxProfile(req: Request, res: Response, next: NextFunction) { try { owner(req); res.json({ success: true, data: await PayrollRuleService.companyTaxProfile(req.user!.companyId) }); } catch (e) { handle(e, res, next); } }
    static async rules(req: Request, res: Response, next: NextFunction) { try { owner(req); sendList(res, await PayrollRuleService.list(req.user!.companyId, filters(req))); } catch (e) { handle(e, res, next); } }
    static async createRule(req: Request, res: Response, next: NextFunction) { try { owner(req); res.status(201).json({ success: true, data: await PayrollRuleService.create(req.user!.companyId, req.user!.userId, req.body, key(req)) }); } catch (e) { handle(e, res, next); } }
    static async cloneRule(req: Request, res: Response, next: NextFunction) { try { owner(req); res.status(201).json({ success: true, data: await PayrollRuleService.clone(id(req), req.user!.companyId, req.user!.userId, req.body, key(req)) }); } catch (e) { handle(e, res, next); } }
    static async updateRule(req: Request, res: Response, next: NextFunction) { try { owner(req); res.json({ success: true, data: await PayrollRuleService.update(id(req), req.user!.companyId, req.user!.userId, req.body, key(req)) }); } catch (e) { handle(e, res, next); } }
    static async uploadRuleConfiguration(req: Request, res: Response, next: NextFunction) { try { owner(req); res.status(201).json({ success: true, data: await PayrollRuleService.uploadConfiguration(id(req), req.user!.companyId, req.user!.userId, req.body, key(req)) }); } catch (e) { handle(e, res, next); } }
    static async ruleConfigurations(req: Request, res: Response, next: NextFunction) { try { owner(req); res.json({ success: true, data: await PayrollRuleService.listConfigurationRevisions(id(req), req.user!.companyId) }); } catch (e) { handle(e, res, next); } }
    static async reviewRuleConfiguration(req: Request, res: Response, next: NextFunction) { try { owner(req); res.json({ success: true, data: await PayrollRuleService.reviewConfiguration(id(req), req.user!.companyId, req.user!.userId, req.body, key(req)) }); } catch (e) { handle(e, res, next); } }
    static async activateRule(req: Request, res: Response, next: NextFunction) { try { owner(req); res.json({ success: true, data: await PayrollRuleService.transition(id(req), req.user!.companyId, req.user!.userId, 'activate', req.body, key(req)) }); } catch (e) { handle(e, res, next); } }
    static async retireRule(req: Request, res: Response, next: NextFunction) { try { owner(req); res.json({ success: true, data: await PayrollRuleService.transition(id(req), req.user!.companyId, req.user!.userId, 'retire', req.body, key(req)) }); } catch (e) { handle(e, res, next); } }
    static async periods(req: Request, res: Response, next: NextFunction) { try { owner(req); sendList(res, await PayrollPeriodService.list(req.user!.companyId, filters(req))); } catch (e) { handle(e, res, next); } }
    static async createPeriod(req: Request, res: Response, next: NextFunction) { try { owner(req); res.status(201).json({ success: true, data: await PayrollPeriodService.create(req.user!.companyId, req.user!.userId, req.body, key(req)) }); } catch (e) { handle(e, res, next); } }
    static async runs(req: Request, res: Response, next: NextFunction) { try { owner(req); sendList(res, await PayrollRunService.list(req.user!.companyId, kind(req), filters(req))); } catch (e) { handle(e, res, next); } }
    static async run(req: Request, res: Response, next: NextFunction) { try { owner(req); res.json({ success: true, data: await PayrollRunService.get(req.user!.companyId, id(req), kind(req)) }); } catch (e) { handle(e, res, next); } }
    static async reconcileParallelControl(req: Request, res: Response, next: NextFunction) { try { owner(req); res.json({ success: true, data: await PayrollRunService.reconcileParallelControl(req.user!.companyId, req.user!.userId, id(req), kind(req), req.body) }); } catch (e) { handle(e, res, next); } }
    static async createRun(req: Request, res: Response, next: NextFunction) { try { owner(req); res.status(201).json({ success: true, data: await PayrollRunService.createRegular(req.user!.companyId, req.user!.userId, req.body, key(req)) }); } catch (e) { handle(e, res, next); } }
    static async createAguinaldo(req: Request, res: Response, next: NextFunction) { try { owner(req); res.status(201).json({ success: true, data: await PayrollRunService.createAguinaldo(req.user!.companyId, req.user!.userId, req.body, key(req)) }); } catch (e) { handle(e, res, next); } }
    static transition(action: string) { return async (req: Request, res: Response, next: NextFunction) => { try { owner(req); res.json({ success: true, data: await PayrollRunService.transition(req.user!.companyId, req.user!.userId, id(req), kind(req), action, req.body, key(req)) }); } catch (e) { handle(e, res, next); } }; }
    static listPart(part: 'anomalies' | 'snapshots' | 'components' | 'receipts' | 'employerContributionLines' | 'statutoryCalculations') { return async (req: Request, res: Response, next: NextFunction) => { try {
        owner(req);
        const companyId = req.user!.companyId; const runId = id(req); const runKind = kind(req);
        const data = part === 'anomalies' ? await PayrollRunService.anomalies(companyId, runId, runKind)
            : part === 'snapshots' ? await PayrollRunService.snapshots(companyId, runId, runKind)
                : part === 'components' ? await PayrollRunService.components(companyId, runId, runKind)
                    : part === 'receipts' ? await PayrollRunService.receipts(companyId, runId, runKind)
                        : part === 'employerContributionLines' ? await PayrollRunService.employerContributionLines(companyId, runId, runKind)
                            : await PayrollRunService.statutoryCalculations(companyId, runId, runKind);
        res.json({ success: true, data });
    } catch (e) { handle(e, res, next); } }; }
    static async addComponent(req: Request, res: Response, next: NextFunction) { try { owner(req); res.status(201).json({ success: true, data: await PayrollRunService.addComponent(req.user!.companyId, req.user!.userId, id(req), kind(req), req.body, key(req)) }); } catch (e) { handle(e, res, next); } }
    static async export(req: Request, res: Response, next: NextFunction) { try { owner(req); const format = req.query.format === 'xlsx' ? 'xlsx' : 'csv'; await binary(res, await PayrollRunService.export(req.user!.companyId, id(req), kind(req), format)); } catch (e) { handle(e, res, next); } }
    static async runReceiptPdf(req: Request, res: Response, next: NextFunction) { try { owner(req); await PayrollRunService.get(req.user!.companyId, id(req), kind(req)); await binary(res, await PayrollReceiptService.pdf(req.user!.companyId, Number(req.params.receiptId), { runId: id(req) })); } catch (e) { handle(e, res, next); } }
    static async myReceipts(req: Request, res: Response, next: NextFunction) { try { sendList(res, await PayrollReceiptService.myList(req.user!.companyId, internalUser(req), filters(req))); } catch (e) { handle(e, res, next); } }
    static async myReceipt(req: Request, res: Response, next: NextFunction) { try { res.json({ success: true, data: await PayrollReceiptService.get(req.user!.companyId, id(req), { userId: internalUser(req), publishedOnly: true, selfSafe: true }) }); } catch (e) { handle(e, res, next); } }
    static async myReceiptPdf(req: Request, res: Response, next: NextFunction) { try { await binary(res, await PayrollReceiptService.pdf(req.user!.companyId, id(req), { userId: internalUser(req), publishedOnly: true, selfSafe: true })); } catch (e) { handle(e, res, next); } }
}
