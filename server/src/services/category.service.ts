import prisma from '../utils/prisma';

const IMPORT_CATEGORY_DEFS: Record<string, {
    name: string;
    codePrefix: string;
    description: string;
    sortOrder: number;
}> = {
    congelados: { name: 'Congelados', codePrefix: 'CON', description: 'Productos congelados y refrigerados', sortOrder: 8 },
    empaques: { name: 'Empaques', codePrefix: 'EMP', description: 'Empaques, envases y desechables', sortOrder: 6 },
    limpieza: { name: 'Limpieza', codePrefix: 'LIM', description: 'Productos de limpieza y aseo', sortOrder: 5 },
    miscelaneo: { name: 'Misceláneo', codePrefix: 'MIS', description: 'Productos varios y misceláneos', sortOrder: 7 },
    vegetales: { name: 'Vegetales', codePrefix: 'VEG', description: 'Vegetales, verduras y hortalizas', sortOrder: 4 },
    bebidas: { name: 'Bebidas', codePrefix: 'BEB', description: 'Bebidas y líquidos', sortOrder: 2 },
    carnes: { name: 'Carnes', codePrefix: 'CAR', description: 'Carnes rojas, blancas y embutidos', sortOrder: 1 },
    lacteos: { name: 'Lácteos', codePrefix: 'LAC', description: 'Productos lácteos y derivados', sortOrder: 3 },
};

const INVENTORY_ONLY_DEFAULTS = {
    showInMenu: false,
    showInInventory: true,
};

export class CategoryService {
    private static normalizeCodePrefix(codePrefix?: string | null): string | null {
        if (codePrefix == null || String(codePrefix).trim() === '') return null;
        const normalized = String(codePrefix).toUpperCase().replace(/[^A-Z]/g, '').substring(0, 10);
        return normalized || null;
    }

    private static assertVisibility(data: { active?: boolean; showInMenu?: boolean; showInInventory?: boolean }) {
        if (data.active === false) return;

        const showInMenu = data.showInMenu ?? true;
        const showInInventory = data.showInInventory ?? true;
        if (!showInMenu && !showInInventory) {
            throw new Error('La categoría debe ser visible en menú, inventario o ambos.');
        }
    }
    private static normalizeCategoryKey(name: string): string {
        return name
            .trim()
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
    }

    private static buildCategoryMap(categories: Array<{ id: number; name: string }>): Map<string, number> {
        const map = new Map<string, number>();
        for (const category of categories) {
            map.set(category.name.toLowerCase(), category.id);
            map.set(this.normalizeCategoryKey(category.name), category.id);
        }
        return map;
    }

    static resolveCategoryId(categoryMap: Map<string, number>, categoryName: string): number | null {
        const trimmed = categoryName.trim();
        if (!trimmed) return null;

        return categoryMap.get(trimmed.toLowerCase())
            ?? categoryMap.get(this.normalizeCategoryKey(trimmed))
            ?? null;
    }

    static async ensureImportCategories(companyId: number, requestedNames: string[]): Promise<Map<string, number>> {
        await this.ensureDefaultCategories(companyId);

        const reload = async () => {
            const categories = await prisma.category.findMany({
                where: { companyId, active: true },
                select: { id: true, name: true },
            });
            return this.buildCategoryMap(categories);
        };

        let categoryMap = await reload();

        for (const rawName of requestedNames) {
            const trimmed = rawName.trim();
            if (!trimmed) continue;
            if (this.resolveCategoryId(categoryMap, trimmed)) continue;

            const normalized = this.normalizeCategoryKey(trimmed);
            const def = IMPORT_CATEGORY_DEFS[normalized];
            const canonicalName = def?.name || trimmed;

            const existing = await prisma.category.findFirst({
                where: { companyId, name: canonicalName },
            });
            if (existing) {
                categoryMap.set(existing.name.toLowerCase(), existing.id);
                categoryMap.set(this.normalizeCategoryKey(existing.name), existing.id);
                continue;
            }

            try {
                const created = await this.create(companyId, {
                    name: canonicalName,
                    codePrefix: def?.codePrefix,
                    description: def?.description,
                    sortOrder: def?.sortOrder,
                    active: true,
                    ...INVENTORY_ONLY_DEFAULTS,
                });
                categoryMap.set(created.name.toLowerCase(), created.id);
                categoryMap.set(this.normalizeCategoryKey(created.name), created.id);
            } catch {
                categoryMap = await reload();
            }
        }

        return categoryMap;
    }
    static async getAll(companyId: number) {
        return await prisma.category.findMany({
            where: { companyId },
            include: {
                _count: {
                    select: {
                        menuItems: true,
                        products: { where: { active: true } }
                    }
                }
            },
            orderBy: {
                sortOrder: 'asc'
            }
        });
    }

    static async getById(id: number, companyId: number) {
        const category = await prisma.category.findFirst({
            where: { id, companyId },
            include: {
                menuItems: true,
                products: true
            }
        });

        if (!category) {
            throw new Error('Category not found');
        }

        return category;
    }

    static async create(companyId: number, data: {
        name: string;
        description?: string;
        codePrefix?: string;
        sortOrder?: number;
        active?: boolean;
        showInMenu?: boolean;
        showInInventory?: boolean;
    }) {
        const name = data.name?.trim();
        if (!name) throw new Error('El nombre de la categoría es requerido');
        this.assertVisibility(data);

        const codePrefix = this.normalizeCodePrefix(data.codePrefix);
        if (codePrefix) {
            const existing = await prisma.category.findFirst({
                where: { companyId, codePrefix }
            });
            if (existing) {
                throw new Error(`El prefijo "${codePrefix}" ya está en uso por la categoría "${existing.name}"`);
            }
        }

        return await prisma.category.create({
            data: {
                name,
                description: data.description,
                codePrefix,
                sortOrder: data.sortOrder,
                active: data.active,
                showInMenu: data.showInMenu,
                showInInventory: data.showInInventory,
                companyId
            }
        });
    }

    static async update(id: number, companyId: number, data: {
        name?: string;
        description?: string;
        codePrefix?: string | null;
        sortOrder?: number;
        active?: boolean;
        showInMenu?: boolean;
        showInInventory?: boolean;
    }) {
        const category = await this.getById(id, companyId);
        const normalizedName = data.name === undefined ? undefined : data.name.trim();
        if (normalizedName !== undefined && !normalizedName) throw new Error('El nombre de la categoría es requerido');
        this.assertVisibility({
            active: data.active ?? category.active,
            showInMenu: data.showInMenu ?? category.showInMenu,
            showInInventory: data.showInInventory ?? category.showInInventory,
        });

        const updateData = {
            ...(normalizedName !== undefined ? { name: normalizedName } : {}),
            ...(data.description !== undefined ? { description: data.description } : {}),
            ...(data.codePrefix !== undefined ? { codePrefix: data.codePrefix } : {}),
            ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
            ...(data.active !== undefined ? { active: data.active } : {}),
            ...(data.showInMenu !== undefined ? { showInMenu: data.showInMenu } : {}),
            ...(data.showInInventory !== undefined ? { showInInventory: data.showInInventory } : {})
        };
        if ('codePrefix' in data) {
            updateData.codePrefix = this.normalizeCodePrefix(data.codePrefix);
        }

        if (updateData.codePrefix) {
            const duplicate = await prisma.category.findFirst({
                where: { companyId, codePrefix: updateData.codePrefix, NOT: { id } }
            });
            if (duplicate) {
                throw new Error(`El prefijo "${updateData.codePrefix}" ya está en uso por la categoría "${duplicate.name}"`);
            }
        }

        return await prisma.category.update({
            where: { id },
            data: updateData
        });
    }

    static async delete(id: number, companyId: number) {
        const category = await prisma.category.findFirst({
            where: { id, companyId },
            include: {
                _count: {
                    select: {
                        menuItems: true,
                        products: true
                    }
                }
            }
        });

        if (!category) {
            throw new Error('Category not found');
        }

        if (category._count.menuItems > 0 || category._count.products > 0) {
            throw new Error('Cannot delete category with associated items');
        }

        return await prisma.category.delete({
            where: { id }
        });
    }

    static async ensureDefaultCategories(companyId: number) {
        const defaults = [
            { name: 'Carnes', codePrefix: 'CAR', description: 'Carnes rojas, blancas y embutidos', sortOrder: 1 },
            { name: 'Bebidas', codePrefix: 'BEB', description: 'Bebidas y líquidos', sortOrder: 2 },
            { name: 'Lácteos', codePrefix: 'LAC', description: 'Productos lácteos y derivados', sortOrder: 3 },
            { name: 'Vegetales', codePrefix: 'VEG', description: 'Vegetales, verduras y hortalizas', sortOrder: 4 },
            { name: 'Limpieza', codePrefix: 'LIM', description: 'Productos de limpieza y aseo', sortOrder: 5 },
            { name: 'Empaques', codePrefix: 'EMP', description: 'Empaques, envases y desechables', sortOrder: 6 },
            { name: 'Misceláneo', codePrefix: 'MIS', description: 'Productos varios y misceláneos', sortOrder: 7 },
            { name: 'Congelados', codePrefix: 'CON', description: 'Productos congelados y refrigerados', sortOrder: 8 },
        ];

        const created: string[] = [];
        const existing: string[] = [];

        for (const cat of defaults) {
            const byName = await prisma.category.findFirst({
                where: { companyId, name: cat.name },
            });
            const byPrefix = cat.codePrefix
                ? await prisma.category.findFirst({
                    where: { companyId, codePrefix: cat.codePrefix },
                })
                : null;

            if (byName) {
                if (!byName.codePrefix && cat.codePrefix && !byPrefix) {
                    await prisma.category.update({
                        where: { id: byName.id },
                        data: { codePrefix: cat.codePrefix },
                    });
                    existing.push(`${cat.name} (prefijo actualizado: ${cat.codePrefix})`);
                } else {
                    existing.push(cat.name);
                }
                continue;
            }

            if (byPrefix) {
                existing.push(`${cat.name} (prefijo ${cat.codePrefix} ya usado por "${byPrefix.name}")`);
                continue;
            }

            try {
                await prisma.category.create({
                    data: { ...cat, companyId, ...INVENTORY_ONLY_DEFAULTS },
                });
                created.push(cat.name);
            } catch {
                existing.push(`${cat.name} (no se pudo crear)`);
            }
        }

        return { created, existing };
    }
}
