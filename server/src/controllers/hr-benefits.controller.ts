import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { isCompanyWide } from '../utils/branch-scope';
import {
  assertBenefitsSelf,
  HrBenefitsError,
  HrDeductionService,
  HrLoanService,
  HrTravelService,
} from '../services/hr-benefits.service';
import {
  HrBenefitPolicyService,
  HrEmploymentSettlementService,
} from '../services/hr-benefits-governance.service';

function owner(req: Request): void {
  if (!isCompanyWide(req.user!))
    throw new HrBenefitsError(
      'La administracion de beneficios requiere alcance Owner de empresa',
      403,
      'HR_BENEFITS_OWNER_REQUIRED'
    );
}

async function selfScope(req: Request) {
  if (req.user!.accountType !== 'INTERNAL' || !req.user!.employeeId)
    throw new HrBenefitsError(
      'El autoservicio requiere una cuenta INTERNAL ligada a empleado',
      403,
      'HR_BENEFITS_INTERNAL_REQUIRED'
    );
  await assertBenefitsSelf(req.user!.companyId, req.user!.userId);
  return {
    companyId: req.user!.companyId,
    actorId: req.user!.userId,
    selfUserId: req.user!.userId,
  };
}

function ownerScope(req: Request) {
  owner(req);
  return { companyId: req.user!.companyId, actorId: req.user!.userId };
}
function key(req: Request): string {
  return String(req.get('Idempotency-Key') || '');
}
function id(req: Request): number {
  return Number(req.params.id);
}
function sendList(res: Response, value: { items: unknown[]; pagination: unknown }) {
  res.json({ success: true, data: value.items, pagination: value.pagination });
}

function handle(error: unknown, res: Response, next: NextFunction) {
  if (error instanceof HrBenefitsError) {
    res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
    return;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      res
        .status(409)
        .json({
          success: false,
          code: 'HR_BENEFITS_DUPLICATE',
          message: 'La operacion ya existe o fue procesada concurrentemente',
        });
      return;
    }
    if (error.code === 'P2003') {
      res
        .status(400)
        .json({
          success: false,
          code: 'HR_BENEFITS_SCOPE_INVALID',
          message: 'Una referencia no pertenece al alcance permitido',
        });
      return;
    }
    if (error.code === 'P2034') {
      res
        .status(409)
        .json({
          success: false,
          code: 'HR_BENEFITS_CONCURRENT_RETRY',
          message: 'La operacion encontro concurrencia; reintente con la misma clave idempotente',
        });
      return;
    }
  }
  next(error);
}

export class HrBenefitsController {
  static async policyList(req: Request, res: Response, next: NextFunction) {
    try {
      sendList(res, await HrBenefitPolicyService.list(ownerScope(req), req.query));
    } catch (e) {
      handle(e, res, next);
    }
  }
  static async policyCreate(req: Request, res: Response, next: NextFunction) {
    try {
      res
        .status(201)
        .json({
          success: true,
          data: await HrBenefitPolicyService.create(ownerScope(req), req.body, key(req)),
        });
    } catch (e) {
      handle(e, res, next);
    }
  }
  static async policyUpdate(req: Request, res: Response, next: NextFunction) {
    try {
      res.json({
        success: true,
        data: await HrBenefitPolicyService.update(ownerScope(req), id(req), req.body, key(req)),
      });
    } catch (e) {
      handle(e, res, next);
    }
  }
  static async policyActivate(req: Request, res: Response, next: NextFunction) {
    try {
      res.json({
        success: true,
        data: await HrBenefitPolicyService.activate(ownerScope(req), id(req), req.body, key(req)),
      });
    } catch (e) {
      handle(e, res, next);
    }
  }
  static async settlementList(req: Request, res: Response, next: NextFunction) {
    try {
      sendList(res, await HrEmploymentSettlementService.list(ownerScope(req), req.query));
    } catch (e) {
      handle(e, res, next);
    }
  }
  static async settlementGet(req: Request, res: Response, next: NextFunction) {
    try {
      res.json({
        success: true,
        data: await HrEmploymentSettlementService.get(ownerScope(req), id(req)),
      });
    } catch (e) {
      handle(e, res, next);
    }
  }
  static async settlementCreate(req: Request, res: Response, next: NextFunction) {
    try {
      res
        .status(201)
        .json({
          success: true,
          data: await HrEmploymentSettlementService.create(ownerScope(req), req.body, key(req)),
        });
    } catch (e) {
      handle(e, res, next);
    }
  }
  static async settlementUpdate(req: Request, res: Response, next: NextFunction) {
    try {
      res.json({
        success: true,
        data: await HrEmploymentSettlementService.update(
          ownerScope(req),
          id(req),
          req.body,
          key(req)
        ),
      });
    } catch (e) {
      handle(e, res, next);
    }
  }
  static async settlementPreview(req: Request, res: Response, next: NextFunction) {
    try {
      res.json({
        success: true,
        data: await HrEmploymentSettlementService.preview(ownerScope(req), req.body),
      });
    } catch (e) {
      handle(e, res, next);
    }
  }
  static settlementTransition(action: string) {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        res.json({
          success: true,
          data: await HrEmploymentSettlementService.transition(
            ownerScope(req),
            id(req),
            action,
            req.body,
            key(req)
          ),
        });
      } catch (e) {
        handle(e, res, next);
      }
    };
  }
  static async settlementPdf(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await HrEmploymentSettlementService.pdf(ownerScope(req), id(req));
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${result.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}"`
      );
      res.send(result.buffer);
    } catch (e) {
      handle(e, res, next);
    }
  }
  static async travelList(req: Request, res: Response, next: NextFunction) {
    try {
      sendList(res, await HrTravelService.list(ownerScope(req), req.query));
    } catch (e) {
      handle(e, res, next);
    }
  }
  static async travelGet(req: Request, res: Response, next: NextFunction) {
    try {
      res.json({ success: true, data: await HrTravelService.get(ownerScope(req), id(req)) });
    } catch (e) {
      handle(e, res, next);
    }
  }
  static async travelCreate(req: Request, res: Response, next: NextFunction) {
    try {
      res
        .status(201)
        .json({
          success: true,
          data: await HrTravelService.create(ownerScope(req), req.body, key(req)),
        });
    } catch (e) {
      handle(e, res, next);
    }
  }
  static async travelUpdate(req: Request, res: Response, next: NextFunction) {
    try {
      res.json({
        success: true,
        data: await HrTravelService.update(ownerScope(req), id(req), req.body, key(req)),
      });
    } catch (e) {
      handle(e, res, next);
    }
  }
  static async travelExpense(req: Request, res: Response, next: NextFunction) {
    try {
      res
        .status(201)
        .json({
          success: true,
          data: await HrTravelService.addExpense(ownerScope(req), id(req), req.body, key(req)),
        });
    } catch (e) {
      handle(e, res, next);
    }
  }
  static travelTransition(action: string) {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        res.json({
          success: true,
          data: await HrTravelService.transition(
            ownerScope(req),
            id(req),
            action,
            req.body,
            key(req)
          ),
        });
      } catch (e) {
        handle(e, res, next);
      }
    };
  }

  static async loanList(req: Request, res: Response, next: NextFunction) {
    try {
      sendList(res, await HrLoanService.list(ownerScope(req), req.query));
    } catch (e) {
      handle(e, res, next);
    }
  }
  static async loanGet(req: Request, res: Response, next: NextFunction) {
    try {
      res.json({ success: true, data: await HrLoanService.get(ownerScope(req), id(req)) });
    } catch (e) {
      handle(e, res, next);
    }
  }
  static async loanCreate(req: Request, res: Response, next: NextFunction) {
    try {
      res
        .status(201)
        .json({
          success: true,
          data: await HrLoanService.create(ownerScope(req), req.body, key(req)),
        });
    } catch (e) {
      handle(e, res, next);
    }
  }
  static loanTransition(action: string) {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        res.json({
          success: true,
          data: await HrLoanService.transition(
            ownerScope(req),
            id(req),
            action,
            req.body,
            key(req)
          ),
        });
      } catch (e) {
        handle(e, res, next);
      }
    };
  }

  static async deductionList(req: Request, res: Response, next: NextFunction) {
    try {
      sendList(res, await HrDeductionService.list(ownerScope(req), req.query));
    } catch (e) {
      handle(e, res, next);
    }
  }
  static async deductionGet(req: Request, res: Response, next: NextFunction) {
    try {
      res.json({ success: true, data: await HrDeductionService.get(ownerScope(req), id(req)) });
    } catch (e) {
      handle(e, res, next);
    }
  }
  static async deductionCreate(req: Request, res: Response, next: NextFunction) {
    try {
      res
        .status(201)
        .json({
          success: true,
          data: await HrDeductionService.create(ownerScope(req), req.body, key(req)),
        });
    } catch (e) {
      handle(e, res, next);
    }
  }
  static async deductionUpdate(req: Request, res: Response, next: NextFunction) {
    try {
      res.json({
        success: true,
        data: await HrDeductionService.update(ownerScope(req), id(req), req.body, key(req)),
      });
    } catch (e) {
      handle(e, res, next);
    }
  }
  static deductionTransition(action: string) {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        res.json({
          success: true,
          data: await HrDeductionService.transition(
            ownerScope(req),
            id(req),
            action,
            req.body,
            key(req)
          ),
        });
      } catch (e) {
        handle(e, res, next);
      }
    };
  }

  static async myTravelList(req: Request, res: Response, next: NextFunction) {
    try {
      sendList(res, await HrTravelService.list(await selfScope(req), req.query));
    } catch (e) {
      handle(e, res, next);
    }
  }
  static async myTravelGet(req: Request, res: Response, next: NextFunction) {
    try {
      res.json({ success: true, data: await HrTravelService.get(await selfScope(req), id(req)) });
    } catch (e) {
      handle(e, res, next);
    }
  }
  static async myTravelCreate(req: Request, res: Response, next: NextFunction) {
    try {
      res
        .status(201)
        .json({
          success: true,
          data: await HrTravelService.create(await selfScope(req), req.body, key(req)),
        });
    } catch (e) {
      handle(e, res, next);
    }
  }
  static async myTravelExpense(req: Request, res: Response, next: NextFunction) {
    try {
      res
        .status(201)
        .json({
          success: true,
          data: await HrTravelService.addExpense(await selfScope(req), id(req), req.body, key(req)),
        });
    } catch (e) {
      handle(e, res, next);
    }
  }
  static myTravelTransition(action: string) {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        res.json({
          success: true,
          data: await HrTravelService.transition(
            await selfScope(req),
            id(req),
            action,
            req.body,
            key(req)
          ),
        });
      } catch (e) {
        handle(e, res, next);
      }
    };
  }
  static async myLoanList(req: Request, res: Response, next: NextFunction) {
    try {
      sendList(res, await HrLoanService.list(await selfScope(req), req.query));
    } catch (e) {
      handle(e, res, next);
    }
  }
  static async myLoanGet(req: Request, res: Response, next: NextFunction) {
    try {
      res.json({ success: true, data: await HrLoanService.get(await selfScope(req), id(req)) });
    } catch (e) {
      handle(e, res, next);
    }
  }
  static async myLoanCreate(req: Request, res: Response, next: NextFunction) {
    try {
      res
        .status(201)
        .json({
          success: true,
          data: await HrLoanService.create(await selfScope(req), req.body, key(req)),
        });
    } catch (e) {
      handle(e, res, next);
    }
  }
  static async myDeductionList(req: Request, res: Response, next: NextFunction) {
    try {
      sendList(res, await HrDeductionService.list(await selfScope(req), req.query));
    } catch (e) {
      handle(e, res, next);
    }
  }
  static async myDeductionGet(req: Request, res: Response, next: NextFunction) {
    try {
      res.json({
        success: true,
        data: await HrDeductionService.get(await selfScope(req), id(req)),
      });
    } catch (e) {
      handle(e, res, next);
    }
  }
}
