import { createHash } from 'crypto';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';

type CatalogMapEntry = {
    sourceName: string;
    productSku: string;
    catalogName: string;
    recipeUnitOverride?: { from: string; to: string; evidence: string };
};

type CatalogMap = {
    schemaVersion: number;
    source: { file: string; sha256: string };
    entries: CatalogMapEntry[];
};

type RecipeIngredient = {
    name: string;
    sku?: string | null;
    productSku?: string | null;
    unit: string;
    unitNormalization?: string | null;
    issues?: unknown[];
    productionCatalogMatch?: Record<string, unknown>;
};

type NormalizedDocument = {
    schemaVersion: number;
    source: { file: string; sha256?: string | null };
    recipes: Array<{ ingredients: RecipeIngredient[] }>;
    productionCatalogMap?: Record<string, unknown>;
};

type Options = { file: string; mapFile: string; write: boolean; help: boolean };

const DEFAULT_FILE = path.resolve(process.cwd(), 'prisma', 'data', 'recetas-menu.normalized.json');
const DEFAULT_MAP = path.resolve(process.cwd(), 'prisma', 'data', 'recetas-menu.catalog-map.json');

const HELP = `
Aplica al JSON normalizado el mapeo SKU revisado para el catálogo productivo.

Uso:
  node dist/scripts/apply-recipe-catalog-map.js [--write] [opciones]

Sin --write solo valida y muestra cuántas líneas cambiarían.

Opciones:
  --file <ruta>   JSON normalizado
  --map <ruta>    Mapa de catálogo revisado
  --write         Escribe el JSON normalizado de forma determinista
  --help          Muestra esta ayuda
`;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readValue(args: string[], index: number, flag: string): { value: string; nextIndex: number } {
    const token = args[index];
    const equalIndex = token.indexOf('=');
    if (equalIndex >= 0) {
        const value = token.slice(equalIndex + 1).trim();
        if (!value) throw new Error(`${flag} requiere un valor.`);
        return { value, nextIndex: index };
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requiere un valor.`);
    return { value, nextIndex: index + 1 };
}

function parseArgs(args: string[]): Options {
    const options: Options = { file: DEFAULT_FILE, mapFile: DEFAULT_MAP, write: false, help: false };
    for (let index = 0; index < args.length; index++) {
        const flag = args[index].split('=')[0];
        if (flag === '--help' || flag === '-h') options.help = true;
        else if (flag === '--write') options.write = true;
        else if (flag === '--file' || flag === '--map') {
            const read = readValue(args, index, flag);
            if (flag === '--file') options.file = path.resolve(read.value);
            else options.mapFile = path.resolve(read.value);
            index = read.nextIndex;
        } else throw new Error(`Opción desconocida: ${args[index]}`);
    }
    return options;
}

function parseJson<T>(raw: string, label: string): T {
    try {
        return JSON.parse(raw) as T;
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`${label} no es JSON válido: ${detail}`);
    }
}

function validateInput(document: NormalizedDocument, map: CatalogMap): Map<string, CatalogMapEntry> {
    if (!isRecord(document) || document.schemaVersion !== 1 || !Array.isArray(document.recipes)) {
        throw new Error('El documento normalizado no cumple schemaVersion=1/recipes[].');
    }
    if (!isRecord(map) || map.schemaVersion !== 1 || !Array.isArray(map.entries) || map.entries.length === 0) {
        throw new Error('El mapa no cumple schemaVersion=1/entries[].');
    }
    if (!document.source || document.source.sha256 !== map.source?.sha256) {
        throw new Error('El SHA-256 de la fuente no coincide entre el documento y el mapa; se rehúsa aplicar un mapa ajeno.');
    }

    const byName = new Map<string, CatalogMapEntry>();
    const skus = new Set<string>();
    map.entries.forEach((entry, index) => {
        if (!entry || typeof entry.sourceName !== 'string' || !entry.sourceName.trim()
            || typeof entry.productSku !== 'string' || !entry.productSku.trim()
            || typeof entry.catalogName !== 'string' || !entry.catalogName.trim()) {
            throw new Error(`Mapa inválido en entries[${index}].`);
        }
        if (byName.has(entry.sourceName)) throw new Error(`sourceName duplicado en el mapa: ${entry.sourceName}.`);
        if (skus.has(entry.productSku)) throw new Error(`productSku duplicado en el mapa: ${entry.productSku}.`);
        byName.set(entry.sourceName, entry);
        skus.add(entry.productSku);
    });
    return byName;
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        process.stdout.write(HELP);
        return;
    }

    const [documentRaw, mapRaw] = await Promise.all([
        readFile(options.file, 'utf8'),
        readFile(options.mapFile, 'utf8')
    ]);
    const document = parseJson<NormalizedDocument>(documentRaw, options.file);
    const map = parseJson<CatalogMap>(mapRaw, options.mapFile);
    const byName = validateInput(document, map);
    const usedNames = new Set<string>();
    let ingredientLines = 0;
    let skuChanges = 0;
    let unitCorrections = 0;

    for (const recipe of document.recipes) {
        if (!recipe || !Array.isArray(recipe.ingredients)) throw new Error('Una receta no contiene ingredients[].');
        for (const ingredient of recipe.ingredients) {
            ingredientLines++;
            const entry = byName.get(ingredient.name);
            if (!entry) throw new Error(`Ingrediente aplicable sin mapeo revisado: ${ingredient.name}.`);
            usedNames.add(entry.sourceName);

            if (ingredient.sku !== entry.productSku || ingredient.productSku !== entry.productSku) skuChanges++;
            ingredient.sku = entry.productSku;
            ingredient.productSku = entry.productSku;
            ingredient.productionCatalogMatch = {
                matchType: 'reviewed_production_sku',
                catalogName: entry.catalogName,
                productSku: entry.productSku,
                source: {
                    file: path.basename(options.mapFile),
                    schemaVersion: map.schemaVersion,
                    sourceSha256: map.source.sha256
                }
            };

            const override = entry.recipeUnitOverride;
            if (override) {
                if (ingredient.unit !== override.from && ingredient.unit !== override.to) {
                    throw new Error(
                        `No se puede aplicar la corrección de unidad a ${ingredient.name}: `
                        + `se esperaba ${override.from} o ${override.to}, se obtuvo ${ingredient.unit}.`
                    );
                }
                if (ingredient.unit === override.from) unitCorrections++;
                ingredient.unit = override.to;
                ingredient.unitNormalization = 'historical_template_correction';
                const issues = Array.isArray(ingredient.issues) ? ingredient.issues : [];
                if (!issues.includes('SOURCE_UNIT_CONFLICT_RESOLVED_FROM_TEMPLATE')) {
                    issues.push('SOURCE_UNIT_CONFLICT_RESOLVED_FROM_TEMPLATE');
                }
                ingredient.issues = issues;
                ingredient.productionCatalogMatch.unitOverride = override;
            }
        }
    }

    const unused = [...byName.keys()].filter((name) => !usedNames.has(name));
    if (unused.length > 0) throw new Error(`El mapa contiene ingredientes no usados por el subconjunto aplicable: ${unused.join(', ')}.`);

    const mapFingerprint = createHash('sha256').update(mapRaw).digest('hex');
    document.productionCatalogMap = {
        file: path.basename(options.mapFile),
        sha256: mapFingerprint,
        sourceSha256: map.source.sha256,
        entries: map.entries.length
    };
    const rendered = `${JSON.stringify(document, null, 2)}\n`;
    if (options.write) await writeFile(options.file, rendered, 'utf8');

    process.stdout.write(`${JSON.stringify({
        valid: true,
        written: options.write,
        file: options.file,
        mapFile: options.mapFile,
        ingredientLines,
        mappedIngredients: usedNames.size,
        skuChanges,
        unitCorrections,
        mapFingerprint
    }, null, 2)}\n`);
}

main().catch((error) => {
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error aplicando mapa de catálogo: ${detail}\n`);
    process.exitCode = 1;
});
