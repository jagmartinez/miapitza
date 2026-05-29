import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';

type Tx = Prisma.TransactionClient;

export interface ConversionResult {
    baseQuantity: number;
    conversionFactor: number;
    originalQuantity: number;
    originalUnit: string;
    baseUnit: string;
}

export interface CostConversionResult extends ConversionResult {
    baseCost: number;
    originalCost: number;
}

export class UnitConversionService {
    private static normalizeLegacyAbbreviation(raw: string): string {
        const abbr = String(raw || '').trim().toLowerCase();
        const aliasMap: Record<string, string> = {
            // Common legacy aliases
            gl: 'gal',
            galon: 'gal',
            galones: 'gal',
            lt: 'l',
            litro: 'l',
            litros: 'l',
            und: 'unidad',
            unid: 'unidad',
        };
        return aliasMap[abbr] || abbr;
    }

    private static async resolveBaseUnitFromLegacy(
        companyId: number,
        legacyUnit: string,
        db: Prisma.TransactionClient | typeof prisma
    ) {
        const normalized = this.normalizeLegacyAbbreviation(legacyUnit);
        const unit = await db.unitOfMeasure.findUnique({
            where: {
                companyId_abbreviation: {
                    companyId,
                    abbreviation: normalized
                }
            }
        });
        if (!unit || !unit.active) return null;
        return unit;
    }

    /**
     * Convert a quantity from one unit to the product's base unit.
     * Returns the converted quantity, the factor used, and traceability data.
     */
    static async convert(
        productId: number,
        companyId: number,
        quantity: number,
        unitAbbreviation: string,
        tx?: Tx
    ): Promise<ConversionResult> {
        const db = tx || prisma;

        const product = await db.product.findFirst({
            where: { id: productId, companyId },
            include: {
                baseUnit: true,
                allowedUnits: {
                    where: { active: true },
                    include: { unit: true }
                }
            }
        });

        if (!product) {
            throw new Error('Producto no encontrado');
        }

        const baseUnit = product.baseUnit;
        if (!baseUnit) {
            const inferredBase = await this.resolveBaseUnitFromLegacy(companyId, product.unit, db);
            if (!inferredBase) {
                // No unit conversion configured and no inferable base unit — legacy 1:1
                return {
                    baseQuantity: quantity,
                    conversionFactor: 1,
                    originalQuantity: quantity,
                    originalUnit: unitAbbreviation,
                    baseUnit: product.unit
                };
            }

            const requestedAbbr = this.normalizeLegacyAbbreviation(unitAbbreviation);
            if (requestedAbbr === inferredBase.abbreviation.toLowerCase()) {
                return {
                    baseQuantity: quantity,
                    conversionFactor: 1,
                    originalQuantity: quantity,
                    originalUnit: inferredBase.abbreviation,
                    baseUnit: inferredBase.abbreviation
                };
            }

            const dynamicUnit = await db.unitOfMeasure.findUnique({
                where: {
                    companyId_abbreviation: {
                        companyId,
                        abbreviation: requestedAbbr
                    }
                }
            });

            if (!dynamicUnit || !dynamicUnit.active || dynamicUnit.measurementType !== inferredBase.measurementType) {
                throw new Error(
                    `Unidad "${unitAbbreviation}" no es compatible con la base "${inferredBase.abbreviation}" ` +
                    `(${inferredBase.measurementType}).`
                );
            }

            const dynamicFactor = Number(dynamicUnit.systemFactor) / Number(inferredBase.systemFactor);
            const dynamicBaseQuantity = quantity * dynamicFactor;
            return {
                baseQuantity: dynamicBaseQuantity,
                conversionFactor: dynamicFactor,
                originalQuantity: quantity,
                originalUnit: dynamicUnit.abbreviation,
                baseUnit: inferredBase.abbreviation
            };
        }

        const abbr = this.normalizeLegacyAbbreviation(unitAbbreviation);
        if (abbr === baseUnit.abbreviation.toLowerCase()) {
            return {
                baseQuantity: quantity,
                conversionFactor: 1,
                originalQuantity: quantity,
                originalUnit: baseUnit.abbreviation,
                baseUnit: baseUnit.abbreviation
            };
        }

        const productUnit = product.allowedUnits.find(
            pu => pu.unit.abbreviation.toLowerCase() === abbr
        );

        if (!productUnit) {
            // Dynamic fallback: allow any active unit from the same measurement type
            // even if it was not explicitly configured in product.allowedUnits.
            const dynamicUnit = await db.unitOfMeasure.findUnique({
                where: {
                    companyId_abbreviation: {
                        companyId,
                        abbreviation: abbr
                    }
                }
            });

            if (!dynamicUnit || !dynamicUnit.active) {
                const allowed = product.allowedUnits.map(pu => pu.unit.abbreviation).join(', ');
                throw new Error(
                    `Unidad "${unitAbbreviation}" no permitida para ${product.name}. ` +
                    `Unidades permitidas: ${allowed || baseUnit.abbreviation}`
                );
            }

            if (dynamicUnit.measurementType !== baseUnit.measurementType) {
                throw new Error(
                    `Unidad "${unitAbbreviation}" no es compatible con la base "${baseUnit.abbreviation}" ` +
                    `(${baseUnit.measurementType}).`
                );
            }

            const dynamicFactor = Number(dynamicUnit.systemFactor) / Number(baseUnit.systemFactor);
            const dynamicBaseQuantity = quantity * dynamicFactor;

            return {
                baseQuantity: dynamicBaseQuantity,
                conversionFactor: dynamicFactor,
                originalQuantity: quantity,
                originalUnit: dynamicUnit.abbreviation,
                baseUnit: baseUnit.abbreviation
            };
        }

        const factor = Number(productUnit.conversionFactor);
        const baseQuantity = quantity * factor;

        return {
            baseQuantity,
            conversionFactor: factor,
            originalQuantity: quantity,
            originalUnit: productUnit.unit.abbreviation,
            baseUnit: baseUnit.abbreviation
        };
    }

    /**
     * Convert quantity and cost together. Returns base cost per unit.
     */
    static async convertWithCost(
        productId: number,
        companyId: number,
        quantity: number,
        unitAbbreviation: string,
        costPerUnit: number,
        tx?: Tx
    ): Promise<CostConversionResult> {
        const result = await this.convert(productId, companyId, quantity, unitAbbreviation, tx);

        // costPerUnit is per original unit. Convert to cost per base unit.
        // If 1 original unit = factor base units, then cost per base = costPerUnit / factor
        const baseCost = result.conversionFactor > 0
            ? costPerUnit / result.conversionFactor
            : costPerUnit;

        return {
            ...result,
            baseCost,
            originalCost: costPerUnit
        };
    }

    /**
     * Get all allowed units for a product, including its base unit.
     */
    static async getAllowedUnits(productId: number, companyId: number) {
        const product = await prisma.product.findFirst({
            where: { id: productId, companyId },
            include: {
                baseUnit: true,
                allowedUnits: {
                    where: { active: true },
                    include: { unit: true },
                    orderBy: { isDefault: 'desc' }
                }
            }
        });

        if (!product) {
            throw new Error('Producto no encontrado');
        }

        if (!product.baseUnit) {
            const inferredBase = await this.resolveBaseUnitFromLegacy(companyId, product.unit, prisma);
            if (!inferredBase) {
                return [{
                    unitId: 0,
                    abbreviation: product.unit,
                    name: product.unit,
                    conversionFactor: 1,
                    isBase: true,
                    isDefault: true
                }];
            }

            const compatibleUnits = await prisma.unitOfMeasure.findMany({
                where: {
                    companyId,
                    active: true,
                    measurementType: inferredBase.measurementType
                },
                orderBy: { name: 'asc' }
            });

            return compatibleUnits.map((u) => ({
                unitId: u.id,
                abbreviation: u.abbreviation,
                name: u.name,
                conversionFactor: Number(u.systemFactor) / Number(inferredBase.systemFactor),
                isBase: u.id === inferredBase.id,
                isDefault: u.id === inferredBase.id
            }));
        }

        const units = product.allowedUnits.map(pu => ({
            unitId: pu.unitId,
            abbreviation: pu.unit.abbreviation,
            name: pu.unit.name,
            conversionFactor: Number(pu.conversionFactor),
            isBase: pu.unitId === product.baseUnitId,
            isDefault: pu.isDefault
        }));

        // Ensure base unit is always included
        const hasBase = units.some(u => u.isBase);
        if (!hasBase) {
            units.unshift({
                unitId: product.baseUnit.id,
                abbreviation: product.baseUnit.abbreviation,
                name: product.baseUnit.name,
                conversionFactor: 1,
                isBase: true,
                isDefault: units.length === 0
            });
        }

        // Also expose all active units compatible with base measurement type,
        // so recipe/inventory selectors are not limited to manually configured rows.
        const compatibleUnits = await prisma.unitOfMeasure.findMany({
            where: {
                companyId,
                active: true,
                measurementType: product.baseUnit.measurementType
            },
            orderBy: { name: 'asc' }
        });

        const existingAbbr = new Set(units.map(u => u.abbreviation.toLowerCase()));
        for (const u of compatibleUnits) {
            if (existingAbbr.has(u.abbreviation.toLowerCase())) continue;
            const factor = Number(u.systemFactor) / Number(product.baseUnit.systemFactor);
            units.push({
                unitId: u.id,
                abbreviation: u.abbreviation,
                name: u.name,
                conversionFactor: factor,
                isBase: u.id === product.baseUnit.id,
                isDefault: false
            });
        }

        return units;
    }

    /**
     * Seed default units of measure for a company.
     */
    static async seedDefaultUnits(companyId: number, tx?: Tx) {
        const db = tx || prisma;

        const defaults = [
            // MASS — reference unit: gram (g)
            { name: 'Gramo', abbreviation: 'g', measurementType: 'MASS' as const, systemFactor: 1 },
            { name: 'Kilogramo', abbreviation: 'kg', measurementType: 'MASS' as const, systemFactor: 1000 },
            { name: 'Miligramo', abbreviation: 'mg', measurementType: 'MASS' as const, systemFactor: 0.001 },
            { name: 'Libra', abbreviation: 'lb', measurementType: 'MASS' as const, systemFactor: 453.592 },
            { name: 'Onza', abbreviation: 'oz', measurementType: 'MASS' as const, systemFactor: 28.3495 },
            { name: 'Quintal', abbreviation: 'qq', measurementType: 'MASS' as const, systemFactor: 45359.2 },
            { name: 'Arroba', abbreviation: 'arr', measurementType: 'MASS' as const, systemFactor: 11339.8 },
            // VOLUME — reference unit: milliliter (ml)
            { name: 'Mililitro', abbreviation: 'ml', measurementType: 'VOLUME' as const, systemFactor: 1 },
            { name: 'Litro', abbreviation: 'l', measurementType: 'VOLUME' as const, systemFactor: 1000 },
            { name: 'Onza liquida', abbreviation: 'oz_fl', measurementType: 'VOLUME' as const, systemFactor: 29.5735 },
            { name: 'Galon', abbreviation: 'gal', measurementType: 'VOLUME' as const, systemFactor: 3785.41 },
            // UNIT
            { name: 'Unidad', abbreviation: 'unidad', measurementType: 'UNIT' as const, systemFactor: 1 },
            // PACKAGE
            { name: 'Paquete', abbreviation: 'paquete', measurementType: 'PACKAGE' as const, systemFactor: 1 },
            { name: 'Caja', abbreviation: 'caja', measurementType: 'PACKAGE' as const, systemFactor: 1 },
            { name: 'Saco', abbreviation: 'saco', measurementType: 'PACKAGE' as const, systemFactor: 1 },
            { name: 'Docena', abbreviation: 'docena', measurementType: 'PACKAGE' as const, systemFactor: 12 },
        ];

        const created = [];
        for (const unit of defaults) {
            const existing = await db.unitOfMeasure.findUnique({
                where: { companyId_abbreviation: { companyId, abbreviation: unit.abbreviation } }
            });
            if (!existing) {
                const record = await db.unitOfMeasure.create({
                    data: { ...unit, companyId }
                });
                created.push(record);
            } else {
                created.push(existing);
            }
        }

        return created;
    }

    /**
     * Auto-configure allowed units for a product based on its legacy `unit` string.
     * Maps legacy unit string to base unit and adds common related units.
     */
    static async autoConfigureProduct(
        productId: number,
        companyId: number,
        legacyUnit: string,
        tx?: Tx
    ) {
        const db = tx || prisma;

        const unitMap: Record<string, { baseAbbr: string; relatedAbbrs: string[] }> = {
            'kg': { baseAbbr: 'kg', relatedAbbrs: ['g', 'lb', 'qq', 'oz'] },
            'g': { baseAbbr: 'g', relatedAbbrs: ['kg', 'lb', 'qq', 'oz'] },
            'lb': { baseAbbr: 'lb', relatedAbbrs: ['kg', 'g', 'qq', 'oz'] },
            'l': { baseAbbr: 'l', relatedAbbrs: ['ml', 'gal', 'oz_fl'] },
            'ml': { baseAbbr: 'ml', relatedAbbrs: ['l', 'gal', 'oz_fl'] },
            'unidad': { baseAbbr: 'unidad', relatedAbbrs: ['docena'] },
            'paquete': { baseAbbr: 'paquete', relatedAbbrs: [] },
        };

        const config = unitMap[legacyUnit.toLowerCase()];
        if (!config) return null;

        const baseUom = await db.unitOfMeasure.findUnique({
            where: { companyId_abbreviation: { companyId, abbreviation: config.baseAbbr } }
        });
        if (!baseUom) return null;

        await db.product.update({
            where: { id: productId },
            data: { baseUnitId: baseUom.id }
        });

        // Add base unit as allowed (factor 1)
        await db.productUnit.upsert({
            where: { productId_unitId: { productId, unitId: baseUom.id } },
            create: {
                companyId,
                productId,
                unitId: baseUom.id,
                conversionFactor: 1,
                isDefault: true,
                active: true
            },
            update: { active: true }
        });

        // Add related units
        for (const abbr of config.relatedAbbrs) {
            const relatedUom = await db.unitOfMeasure.findUnique({
                where: { companyId_abbreviation: { companyId, abbreviation: abbr } }
            });
            if (!relatedUom) continue;

            // conversionFactor = how many base units per 1 of this unit
            // systemFactor is in reference units (g for MASS, ml for VOLUME)
            // factor = relatedUom.systemFactor / baseUom.systemFactor
            const factor = Number(relatedUom.systemFactor) / Number(baseUom.systemFactor);

            await db.productUnit.upsert({
                where: { productId_unitId: { productId, unitId: relatedUom.id } },
                create: {
                    companyId,
                    productId,
                    unitId: relatedUom.id,
                    conversionFactor: factor,
                    isDefault: false,
                    active: true
                },
                update: { conversionFactor: factor, active: true }
            });
        }

        return true;
    }
}
