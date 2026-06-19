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
            const includeInactive =
                req.query.includeInactive === 'true' || req.query.includeInactive === '1';

            const units = await prisma.unitOfMeasure.findMany({
                where: {
                    companyId,
                    ...(includeInactive ? {} : { active: true })
                },
                orderBy: [{ measurementType: 'asc' }, { name: 'asc' }]
            });
            res.json({ success: true, data: units });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async updateUnit(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const unitId = parseInt(req.params.id, 10);
            const {
                name,
                abbreviation,
                measurementType,
                systemFactor,
                active
            } = req.body as {
                name?: string;
                abbreviation?: string;
                measurementType?: 'MASS' | 'VOLUME' | 'UNIT' | 'PACKAGE';
                systemFactor?: number;
                active?: boolean;
            };

            const existing = await prisma.unitOfMeasure.findFirst({
                where: { id: unitId, companyId }
            });
            if (!existing) {
                return next({ statusCode: 404, message: 'Unidad no encontrada' });
            }

            const data: {
                name?: string;
                abbreviation?: string;
                measurementType?: 'MASS' | 'VOLUME' | 'UNIT' | 'PACKAGE';
                systemFactor?: number;
                active?: boolean;
            } = {};

            if (name !== undefined) {
                const safeName = String(name).trim();
                if (!safeName) {
                    return next({ statusCode: 400, message: 'El nombre de la unidad es requerido' });
                }
                data.name = safeName;
            }

            if (abbreviation !== undefined) {
                const safeAbbreviation = String(abbreviation).trim().toLowerCase();
                if (!safeAbbreviation) {
                    return next({ statusCode: 400, message: 'La abreviatura de la unidad es requerida' });
                }
                if (safeAbbreviation !== existing.abbreviation) {
                    const duplicate = await prisma.unitOfMeasure.findUnique({
                        where: { companyId_abbreviation: { companyId, abbreviation: safeAbbreviation } }
                    });
                    if (duplicate) {
                        return next({
                            statusCode: 409,
                            message: `Ya existe una unidad con abreviatura "${safeAbbreviation}"`
                        });
                    }
                }
                data.abbreviation = safeAbbreviation;
            }

            if (measurementType !== undefined) {
                if (!['MASS', 'VOLUME', 'UNIT', 'PACKAGE'].includes(measurementType)) {
                    return next({ statusCode: 400, message: 'Tipo de medida invalido' });
                }
                data.measurementType = measurementType;
            }

            if (systemFactor !== undefined) {
                const safeSystemFactor = Number(systemFactor);
                if (!Number.isFinite(safeSystemFactor) || safeSystemFactor <= 0) {
                    return next({ statusCode: 400, message: 'El factor del sistema debe ser mayor a 0' });
                }
                data.systemFactor = safeSystemFactor;
            }

            if (active !== undefined) {
                if (active === false) {
                    const productsUsingBase = await prisma.product.count({
                        where: { companyId, baseUnitId: unitId, active: true }
                    });
                    if (productsUsingBase > 0) {
                        return next({
                            statusCode: 400,
                            message: `No se puede inhabilitar: ${productsUsingBase} producto(s) la usan como unidad base`
                        });
                    }
                }
                data.active = active;
            }

            if (Object.keys(data).length === 0) {
                return next({ statusCode: 400, message: 'No hay cambios para guardar' });
            }

            const unit = await prisma.unitOfMeasure.update({
                where: { id: unitId },
                data
            });

            res.json({ success: true, data: unit });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
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

            // El producto debe pertenecer a la empresa del usuario antes de cualquier
            // escritura: evita actualizar productos de otro tenant (product.update solo
            // filtra por id, que no incluye companyId).
            const product = await prisma.product.findFirst({
                where: { id: productId, companyId },
                select: { id: true }
            });
            if (!product) {
                return next({ statusCode: 404, message: 'Producto no encontrado' });
            }

            // La unidad base debe existir y pertenecer a la empresa: es el ancla de
            // todas las conversiones, así que validamos contra el catálogo.
            const baseUnit = await prisma.unitOfMeasure.findFirst({
                where: { id: baseUnitId, companyId }
            });
            if (!baseUnit) {
                return next({ statusCode: 400, message: 'La unidad base no existe o no pertenece a la empresa' });
            }

            const safeAllowed = Array.isArray(allowedUnits) ? allowedUnits : [];

            // Cargamos las unidades referenciadas desde el catálogo (con scope de
            // empresa) para validar compatibilidad de measurementType vs. la base.
            const unitIds = [...new Set(safeAllowed.map((au) => au.unitId))];
            const catalogUnits = await prisma.unitOfMeasure.findMany({
                where: { id: { in: unitIds }, companyId }
            });
            const catalogById = new Map(catalogUnits.map((u) => [u.id, u]));

            for (const au of safeAllowed) {
                const factor = Number(au.conversionFactor);
                // Un factor <= 0 corrompe el costeo (división por 0/negativo).
                if (!Number.isFinite(factor) || factor <= 0) {
                    return next({
                        statusCode: 400,
                        message: `El factor de conversión debe ser mayor a 0 (unidad ${au.unitId})`
                    });
                }

                const unit = catalogById.get(au.unitId);
                if (!unit) {
                    return next({
                        statusCode: 400,
                        message: `La unidad ${au.unitId} no existe o no pertenece a la empresa`
                    });
                }

                // Coherencia: si se incluye la base en allowedUnits, su factor es 1.
                if (au.unitId === baseUnitId && factor !== 1) {
                    return next({
                        statusCode: 400,
                        message: 'La unidad base debe tener factor de conversión 1'
                    });
                }

                // Las unidades alternas deben compartir el measurementType de la base.
                // Excepción: las unidades PACKAGE llevan factores específicos por
                // producto que no se derivan del catálogo, así que se permite el
                // factor explícito (ya validado > 0) aunque el tipo difiera.
                if (au.unitId !== baseUnitId
                    && unit.measurementType !== baseUnit.measurementType
                    && unit.measurementType !== 'PACKAGE') {
                    return next({
                        statusCode: 400,
                        message: `La unidad "${unit.abbreviation}" (${unit.measurementType}) no es compatible ` +
                            `con la unidad base "${baseUnit.abbreviation}" (${baseUnit.measurementType})`
                    });
                }
            }

            await prisma.$transaction(async (tx) => {
                // Sincroniza la cadena legacy `product.unit` con la abreviatura de la
                // base recién fijada (igual que autoConfigureProduct) para que listados
                // y kardex que muestran product.unit sigan coherentes.
                await tx.product.update({
                    where: { id: productId },
                    data: { baseUnitId, unit: baseUnit.abbreviation }
                });

                // Deactivate all existing
                await tx.productUnit.updateMany({
                    where: { productId, companyId },
                    data: { active: false }
                });

                for (const au of safeAllowed) {
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
