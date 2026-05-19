import { Request, Response, NextFunction } from 'express';
import { UnitConversionService } from '../services/unit-conversion.service';
import prisma from '../utils/prisma';
import { getErrorMessage } from '../utils/error';

export class UnitConversionController {

    static async createUnit(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const {
                name,
                abbreviation,
                measurementType,
                systemFactor
            } = req.body as {
                name?: string;
                abbreviation?: string;
                measurementType?: 'MASS' | 'VOLUME' | 'UNIT' | 'PACKAGE';
                systemFactor?: number;
            };

            const safeName = String(name || '').trim();
            const safeAbbreviation = String(abbreviation || '').trim().toLowerCase();
            const safeMeasurementType = measurementType;
            const safeSystemFactor = Number(systemFactor);

            if (!safeName) {
                return next({ statusCode: 400, message: 'El nombre de la unidad es requerido' });
            }
            if (!safeAbbreviation) {
                return next({ statusCode: 400, message: 'La abreviatura de la unidad es requerida' });
            }
            if (!safeMeasurementType || !['MASS', 'VOLUME', 'UNIT', 'PACKAGE'].includes(safeMeasurementType)) {
                return next({ statusCode: 400, message: 'Tipo de medida invalido' });
            }
            if (!Number.isFinite(safeSystemFactor) || safeSystemFactor <= 0) {
                return next({ statusCode: 400, message: 'El factor del sistema debe ser mayor a 0' });
            }

            const exists = await prisma.unitOfMeasure.findUnique({
                where: { companyId_abbreviation: { companyId, abbreviation: safeAbbreviation } }
            });
            if (exists) {
                return next({
                    statusCode: 409,
                    message: `Ya existe una unidad con abreviatura "${safeAbbreviation}"`
                });
            }

            const unit = await prisma.unitOfMeasure.create({
                data: {
                    companyId,
                    name: safeName,
                    abbreviation: safeAbbreviation,
                    measurementType: safeMeasurementType,
                    systemFactor: safeSystemFactor
                }
            });

            res.status(201).json({ success: true, data: unit });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async getAllUnits(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const units = await prisma.unitOfMeasure.findMany({
                where: { companyId, active: true },
                orderBy: [{ measurementType: 'asc' }, { name: 'asc' }]
            });
            res.json({ success: true, data: units });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getProductUnits(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const productId = parseInt(req.params.productId);
            const units = await UnitConversionService.getAllowedUnits(productId, companyId);
            res.json({ success: true, data: units });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async setProductUnits(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const productId = parseInt(req.params.productId);
            const { baseUnitId, allowedUnits } = req.body as {
                baseUnitId: number;
                allowedUnits: Array<{
                    unitId: number;
                    conversionFactor: number;
                    isDefault?: boolean;
                }>;
            };

            await prisma.$transaction(async (tx) => {
                await tx.product.update({
                    where: { id: productId },
                    data: { baseUnitId }
                });

                // Deactivate all existing
                await tx.productUnit.updateMany({
                    where: { productId, companyId },
                    data: { active: false }
                });

                for (const au of allowedUnits) {
                    await tx.productUnit.upsert({
                        where: { productId_unitId: { productId, unitId: au.unitId } },
                        create: {
                            companyId,
                            productId,
                            unitId: au.unitId,
                            conversionFactor: au.conversionFactor,
                            isDefault: au.isDefault || false,
                            active: true
                        },
                        update: {
                            conversionFactor: au.conversionFactor,
                            isDefault: au.isDefault || false,
                            active: true
                        }
                    });
                }
            });

            const units = await UnitConversionService.getAllowedUnits(productId, companyId);
            res.json({ success: true, data: units });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async seedUnits(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const units = await UnitConversionService.seedDefaultUnits(companyId);
            res.json({ success: true, data: units, message: `${units.length} unidades configuradas` });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async autoConfigureProduct(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const productId = parseInt(req.params.productId);

            const product = await prisma.product.findFirst({
                where: { id: productId, companyId }
            });
            if (!product) {
                return next({ statusCode: 404, message: 'Producto no encontrado' });
            }

            await UnitConversionService.autoConfigureProduct(productId, companyId, product.unit);
            const units = await UnitConversionService.getAllowedUnits(productId, companyId);
            res.json({ success: true, data: units });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async autoConfigureAll(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;

            // Seed units first
            await UnitConversionService.seedDefaultUnits(companyId);

            // Get all products without baseUnitId
            const products = await prisma.product.findMany({
                where: { companyId, baseUnitId: null, active: true }
            });

            let configured = 0;
            for (const product of products) {
                const result = await UnitConversionService.autoConfigureProduct(
                    product.id, companyId, product.unit
                );
                if (result) configured++;
            }

            res.json({
                success: true,
                message: `${configured} de ${products.length} productos configurados automaticamente`,
                data: { total: products.length, configured }
            });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }
}
