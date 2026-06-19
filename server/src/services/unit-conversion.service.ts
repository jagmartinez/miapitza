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
    private static sanitizeLegacyUnit(raw: string): string {
        return String(raw || '').trim().toLowerCase().replace(/[.\s_-]+/g, '');
    }

    private static normalizeLegacyAbbreviation(raw: string): string {
        const abbr = this.sanitizeLegacyUnit(raw);
        const aliasMap: Record<string, string> = {
            // Common legacy aliases
            gl: 'gal',
            galon: 'gal',
            galones: 'gal',
            lt: 'l',
            ltr: 'l',
            lts: 'l',
            liter: 'l',
            litro: 'l',
            litros: 'l',
            gr: 'g',
            grs: 'g',
            gramo: 'g',
            gramos: 'g',
            grams: 'g',
            kilo: 'kg',
            kilos: 'kg',
            kgs: 'kg',
            kilogram: 'kg',
            kilograms: 'kg',
            kilogramo: 'kg',
            kilogramos: 'kg',
            lbs: 'lb',
            libra: 'lb',
            libras: 'lb',
            onza: 'oz',
            onzas: 'oz',
            ml: 'ml',
            millilitro: 'ml',
            millilitros: 'ml',
            mililitro: 'ml',
            mililitros: 'ml',
            und: 'unidad',
            unid: 'unidad',
            u: 'unidad',
            unds: 'unidad',
            paq: 'paquete',
            paqte: 'paquete',
            pkg: 'paquete',
            pqt: 'paquete',
            pq: 'paquete',
            pk: 'paquete',
            cja: 'caja',
            sac: 'saco',
            doc: 'docena',
        };
        return aliasMap[abbr] || abbr;
    }

    private static buildLegacyUnitCandidates(legacyUnit: string): string[] {
        const raw = String(legacyUnit || '').trim().toLowerCase();
        if (!raw) return [];

        const sanitized = this.sanitizeLegacyUnit(raw);
        const normalized = this.normalizeLegacyAbbreviation(raw);
        const rawNoDots = raw.replace(/[.\s_-]+/g, '');

        return [...new Set([
            normalized,
            sanitized,
            rawNoDots,
            raw
        ].filter(Boolean))];
    }

    private static async resolveBaseUnitFromLegacy(
        companyId: number,
        legacyUnit: string,
        db: Prisma.TransactionClient | typeof prisma
    ) {
        const candidates = this.buildLegacyUnitCandidates(legacyUnit);
        if (candidates.length === 0) return null;

        for (const abbreviation of candidates) {
            const unit = await db.unitOfMeasure.findUnique({
                where: {
                    companyId_abbreviation: {
                        companyId,
                        abbreviation
                    }
                }
            });
            if (unit?.active) return unit;
        }

        for (const abbreviation of candidates) {
            const unit = await db.unitOfMeasure.findFirst({
                where: {
                    companyId,
                    active: true,
                    OR: [
                        { abbreviation: { startsWith: abbreviation } },
                        { name: abbreviation }
                    ]
                }
            });
            if (unit) return unit;
        }

        return null;
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
                // No base unit configured and none inferable from the legacy string.
                // A blind 1:1 here would treat e.g. 2 kg as 2 g (mis-cost ×1000), so
                // the 1:1 is only safe when the requested unit IS the product's own
                // unit. Otherwise we refuse and ask for explicit configuration.
                const requestedAbbr = this.normalizeLegacyAbbreviation(unitAbbreviation);
                const productAbbr = this.normalizeLegacyAbbreviation(product.unit);
                if (requestedAbbr === productAbbr) {
                    return {
                        baseQuantity: quantity,
                        conversionFactor: 1,
                        originalQuantity: quantity,
                        originalUnit: unitAbbreviation,
                        baseUnit: product.unit
                    };
                }
                throw new Error(
                    `El producto "${product.name}" no tiene unidades configuradas, por lo que no se puede ` +
                    `convertir la unidad "${unitAbbreviation}" a su unidad base. ` +
                    `Configure la unidad base y las conversiones del producto en "Conversiones" antes de continuar.`
                );
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

            // PACKAGE units (caja, saco, paquete, ...) all share systemFactor = 1, so a
            // dynamic fallback would silently assume 1:1 (e.g. 1 caja = 1 paquete),
            // corrupting inventory. Require an explicit per-product factor instead.
            if (inferredBase.measurementType === 'PACKAGE') {
                throw new Error(
                    `La unidad de empaque "${unitAbbreviation}" requiere un factor de conversión ` +
                    `configurado para este producto (ej. 1 ${dynamicUnit.abbreviation} = N ${inferredBase.abbreviation}). ` +
                    `Configúrelo en "Conversiones" del producto.`
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

            // PACKAGE units share systemFactor = 1; a dynamic ratio would assume
            // 1:1 between packages (1 caja = 1 paquete), silently corrupting stock.
            // Force an explicit per-product conversion factor for packaging units.
            if (baseUnit.measurementType === 'PACKAGE') {
                throw new Error(
                    `La unidad de empaque "${unitAbbreviation}" requiere un factor de conversión ` +
                    `configurado para este producto (ej. 1 ${dynamicUnit.abbreviation} = N ${baseUnit.abbreviation}). ` +
                    `Configúrelo en "Conversiones" del producto.`
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
        // A non-positive factor would corrupt costing (division by 0/negativo). Factors
        // are validated > 0 on write, so reaching here means inconsistent data: fail loud.
        if (!(result.conversionFactor > 0)) {
            throw new Error(
                `Factor de conversión inválido (${result.conversionFactor}) para la unidad ` +
                `"${unitAbbreviation}". Revise la configuración de conversiones del producto.`
            );
        }
        const baseCost = costPerUnit / result.conversionFactor;

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

        let baseUnit = product.baseUnit;
        if (!baseUnit && product.baseUnitId) {
            baseUnit = await prisma.unitOfMeasure.findFirst({
                where: { id: product.baseUnitId, companyId, active: true }
            });
        }

        if (!baseUnit) {
            let inferredBase = await this.resolveBaseUnitFromLegacy(companyId, product.unit, prisma);

            if (!inferredBase) {
                const fuzzyCandidates = this.buildLegacyUnitCandidates(product.unit);
                if (fuzzyCandidates.length > 0) {
                    inferredBase = await prisma.unitOfMeasure.findFirst({
                        where: {
                            companyId,
                            active: true,
                            OR: fuzzyCandidates.flatMap((abbr) => ([
                                { abbreviation: { contains: abbr } },
                                { name: { contains: abbr } }
                            ]))
                        },
                        orderBy: { name: 'asc' }
                    });
                }
            }

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

            if (!product.baseUnitId) {
                await this.autoConfigureProduct(productId, companyId, product.unit).catch(() => undefined);
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
                unitId: baseUnit.id,
                abbreviation: baseUnit.abbreviation,
                name: baseUnit.name,
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
                measurementType: baseUnit.measurementType
            },
            orderBy: { name: 'asc' }
        });

        const existingAbbr = new Set(units.map(u => u.abbreviation.toLowerCase()));
        for (const u of compatibleUnits) {
            if (existingAbbr.has(u.abbreviation.toLowerCase())) continue;
            const factor = Number(u.systemFactor) / Number(baseUnit.systemFactor);
            units.push({
                unitId: u.id,
                abbreviation: u.abbreviation,
                name: u.name,
                conversionFactor: factor,
                isBase: u.id === baseUnit.id,
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
            'gr': { baseAbbr: 'g', relatedAbbrs: ['kg', 'lb', 'qq', 'oz'] },
            'lb': { baseAbbr: 'lb', relatedAbbrs: ['kg', 'g', 'qq', 'oz'] },
            'oz': { baseAbbr: 'oz', relatedAbbrs: ['g', 'kg', 'lb'] },
            'l': { baseAbbr: 'l', relatedAbbrs: ['ml', 'gal', 'oz_fl'] },
            'ml': { baseAbbr: 'ml', relatedAbbrs: ['l', 'gal', 'oz_fl'] },
            'gal': { baseAbbr: 'gal', relatedAbbrs: ['l', 'ml', 'oz_fl'] },
            'gl': { baseAbbr: 'gal', relatedAbbrs: ['l', 'ml', 'oz_fl'] },
            'unidad': { baseAbbr: 'unidad', relatedAbbrs: ['docena'] },
            'paquete': { baseAbbr: 'paquete', relatedAbbrs: ['caja', 'saco', 'docena'] },
            'caja': { baseAbbr: 'caja', relatedAbbrs: ['paquete', 'saco', 'docena'] },
            'saco': { baseAbbr: 'saco', relatedAbbrs: ['paquete', 'caja', 'docena'] },
            'docena': { baseAbbr: 'docena', relatedAbbrs: ['unidad', 'paquete'] },
        };

        const config = unitMap[this.normalizeLegacyAbbreviation(legacyUnit)] ?? unitMap[legacyUnit.toLowerCase()];
        if (!config) return null;

        const baseUom = await db.unitOfMeasure.findUnique({
            where: { companyId_abbreviation: { companyId, abbreviation: config.baseAbbr } }
        });
        if (!baseUom) return null;

        // Pin baseUnitId and align the legacy `unit` string to the resolved base
        // abbreviation so listings/kardex (which still display `product.unit`)
        // stay consistent with the configured base unit (e.g. "gr" -> "g").
        await db.product.update({
            where: { id: productId },
            data: { baseUnitId: baseUom.id, unit: baseUom.abbreviation }
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

            // Skip PACKAGE-type related units (caja, saco, paquete, ...). Their
            // systemFactor is 1, so an auto-derived factor would be a bogus 1:1
            // conversion (e.g. 1 caja = 1 base). Packaging factors are product
            // specific and must be configured manually in "Conversiones".
            if (relatedUom.measurementType === 'PACKAGE') continue;

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
