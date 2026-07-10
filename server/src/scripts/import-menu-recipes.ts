import { readFile, writeFile } from 'fs/promises';
import path from 'path';

import prisma from '../utils/prisma';
import {
    MenuRecipeImportError,
    MenuRecipeImportReport,
    MenuRecipeImportService
} from '../services/menu-recipe-import.service';

type CliOptions = {
    file: string;
    companyId: number | null;
    userId: number | null;
    dryRun: boolean;
    replace: boolean;
    allowReviewRequired: boolean;
    skipProductionRecipes: boolean;
    reportFile: string | null;
    help: boolean;
};

const DEFAULT_FILE = path.resolve(process.cwd(), 'prisma', 'data', 'recetas-menu.normalized.json');

const HELP = `
Importación estricta e idempotente de recetas de menú normalizadas.

Uso:
  node dist/scripts/import-menu-recipes.js --company-id <id> [opciones]

Opciones:
  --file <ruta>       JSON normalizado (default: prisma/data/recetas-menu.normalized.json)
  --company-id <id>   Empresa destino; obligatorio, nunca se infiere
  --user-id <id>      Usuario activo del tenant para AuditLog; obligatorio con --apply
  --dry-run           Solo valida/planifica (comportamiento por defecto)
  --apply             Aplica el plan completo dentro de una transacción
  --replace           Elimina líneas obsoletas solo de los platos presentes en el JSON
  --allow-review-required
                      Autoriza importar solo el subconjunto aplicable aunque existan
                      bloques reviewRequired; se conservan como WARNING en el reporte
  --skip-production-recipes
                      Excluye explícitamente las recetas DRAFT de producción cuando el
                      catálogo/unidades aún no permiten validarlas; quedan reportadas
  --report <ruta>     Guarda el mismo reporte JSON mostrado en stdout
  --help              Muestra esta ayuda

Flujo recomendado:
  1. ejecutar --dry-run y revisar que valid=true;
  2. corregir toda ambigüedad/faltante en el JSON o catálogo;
  3. repetir con --apply --user-id <id> usando exactamente los flags revisados.
`;

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

function parsePositiveId(raw: string, flag: string): number {
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} debe ser un entero positivo.`);
    return parsed;
}

function parseArgs(args: string[]): CliOptions {
    const options: CliOptions = {
        file: DEFAULT_FILE,
        companyId: null,
        userId: null,
        dryRun: true,
        replace: false,
        allowReviewRequired: false,
        skipProductionRecipes: false,
        reportFile: null,
        help: false
    };
    let explicitMode: 'dry-run' | 'apply' | null = null;

    for (let index = 0; index < args.length; index++) {
        const token = args[index];
        const flag = token.split('=')[0];
        if (flag === '--help' || flag === '-h') {
            options.help = true;
        } else if (flag === '--dry-run') {
            if (explicitMode === 'apply') throw new Error('--dry-run y --apply son mutuamente excluyentes.');
            explicitMode = 'dry-run';
            options.dryRun = true;
        } else if (flag === '--apply') {
            if (explicitMode === 'dry-run') throw new Error('--dry-run y --apply son mutuamente excluyentes.');
            explicitMode = 'apply';
            options.dryRun = false;
        } else if (flag === '--replace') {
            options.replace = true;
        } else if (flag === '--allow-review-required') {
            options.allowReviewRequired = true;
        } else if (flag === '--skip-production-recipes') {
            options.skipProductionRecipes = true;
        } else if (flag === '--file') {
            const read = readValue(args, index, '--file');
            options.file = path.resolve(read.value);
            index = read.nextIndex;
        } else if (flag === '--report') {
            const read = readValue(args, index, '--report');
            options.reportFile = path.resolve(read.value);
            index = read.nextIndex;
        } else if (flag === '--company-id') {
            const read = readValue(args, index, '--company-id');
            options.companyId = parsePositiveId(read.value, '--company-id');
            index = read.nextIndex;
        } else if (flag === '--user-id') {
            const read = readValue(args, index, '--user-id');
            options.userId = parsePositiveId(read.value, '--user-id');
            index = read.nextIndex;
        } else {
            throw new Error(`Opción desconocida: ${token}`);
        }
    }

    return options;
}

async function emitReport(report: MenuRecipeImportReport, reportFile: string | null): Promise<void> {
    const rendered = `${JSON.stringify(report, null, 2)}\n`;
    process.stdout.write(rendered);
    if (reportFile) await writeFile(reportFile, rendered, 'utf8');
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        process.stdout.write(HELP);
        return;
    }
    if (!options.companyId) throw new Error('--company-id es obligatorio; la empresa destino nunca se infiere.');
    if (!options.dryRun && !options.userId) {
        const validUsers = await MenuRecipeImportService.listValidAuditUsers(options.companyId);
        throw new Error(
            '--user-id es obligatorio con --apply. Usuarios activos válidos para auditoría: '
            + (validUsers.length > 0
                ? validUsers.map((user) => `${user.id} (${user.name})`).join(', ')
                : 'ninguno')
        );
    }

    const raw = await readFile(options.file, 'utf8');
    let document: unknown;
    try {
        document = JSON.parse(raw);
    } catch (error) {
        const detail = error instanceof Error ? error.message : 'JSON inválido';
        throw new Error(`No se pudo parsear ${options.file}: ${detail}`);
    }

    try {
        const report = await MenuRecipeImportService.importDocument(document, {
            companyId: options.companyId,
            userId: options.userId,
            dryRun: options.dryRun,
            replace: options.replace,
            allowReviewRequired: options.allowReviewRequired,
            skipProductionRecipes: options.skipProductionRecipes
        });
        await emitReport(report, options.reportFile);
        if (!report.valid) process.exitCode = 1;
    } catch (error) {
        if (error instanceof MenuRecipeImportError) {
            await emitReport(error.report, options.reportFile);
            process.exitCode = 1;
            return;
        }
        throw error;
    }
}

main()
    .catch((error) => {
        const detail = error instanceof Error ? error.message : String(error);
        process.stderr.write(`Error de importación: ${detail}\n`);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
