import { readFile, writeFile } from 'fs/promises';
import path from 'path';

import {
    RecipeCatalogPreparationError,
    RecipeCatalogPreparationReport,
    RecipeCatalogPreparationService
} from '../services/recipe-catalog-preparation.service';
import prisma from '../utils/prisma';

type Options = {
    file: string;
    companyId: number | null;
    userId: number | null;
    dryRun: boolean;
    reportFile: string | null;
    help: boolean;
};

const DEFAULT_FILE = path.resolve(process.cwd(), 'prisma', 'data', 'recetas-menu.catalog-map.json');

const HELP = `
Prepara de forma estricta e idempotente el catálogo usado por las recetas.

Uso:
  node dist/scripts/prepare-recipe-catalog.js --company-id <id> [opciones]

Opciones:
  --file <ruta>       Mapa revisado (default: prisma/data/recetas-menu.catalog-map.json)
  --company-id <id>   Empresa destino; obligatorio, nunca se infiere
  --user-id <id>      Usuario activo del tenant para AuditLog; obligatorio con --apply
  --dry-run           Solo valida/planifica (comportamiento por defecto)
  --apply             Aplica en una transacción y verifica que la segunda pasada sea no-op
  --report <ruta>     Guarda el reporte JSON mostrado en stdout
  --help              Muestra esta ayuda

Este comando no crea existencias ni movimientos. Los productos RCP-* nuevos
parten con stock cero y costo referencial del archivo; compras/producción deben
alimentar sus existencias antes de operar ventas reales.
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
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) throw new Error(`${flag} debe ser un entero positivo.`);
    return value;
}

function parseArgs(args: string[]): Options {
    const options: Options = {
        file: DEFAULT_FILE,
        companyId: null,
        userId: null,
        dryRun: true,
        reportFile: null,
        help: false
    };
    let explicitMode: 'dry-run' | 'apply' | null = null;
    for (let index = 0; index < args.length; index++) {
        const token = args[index];
        const flag = token.split('=')[0];
        if (flag === '--help' || flag === '-h') options.help = true;
        else if (flag === '--dry-run') {
            if (explicitMode === 'apply') throw new Error('--dry-run y --apply son mutuamente excluyentes.');
            explicitMode = 'dry-run';
            options.dryRun = true;
        } else if (flag === '--apply') {
            if (explicitMode === 'dry-run') throw new Error('--dry-run y --apply son mutuamente excluyentes.');
            explicitMode = 'apply';
            options.dryRun = false;
        } else if (flag === '--file' || flag === '--report' || flag === '--company-id' || flag === '--user-id') {
            const read = readValue(args, index, flag);
            if (flag === '--file') options.file = path.resolve(read.value);
            else if (flag === '--report') options.reportFile = path.resolve(read.value);
            else if (flag === '--company-id') options.companyId = parsePositiveId(read.value, flag);
            else options.userId = parsePositiveId(read.value, flag);
            index = read.nextIndex;
        } else throw new Error(`Opción desconocida: ${token}`);
    }
    return options;
}

async function emit(report: RecipeCatalogPreparationReport, reportFile: string | null): Promise<void> {
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
    if (!options.companyId) throw new Error('--company-id es obligatorio; la empresa nunca se infiere.');
    if (!options.dryRun && !options.userId) {
        const users = await RecipeCatalogPreparationService.listValidAuditUsers(options.companyId);
        throw new Error(
            '--user-id es obligatorio con --apply. Usuarios activos válidos: '
            + (users.length > 0 ? users.map((user) => `${user.id} (${user.name})`).join(', ') : 'ninguno')
        );
    }
    const raw = await readFile(options.file, 'utf8');
    let input: unknown;
    try {
        input = JSON.parse(raw);
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`No se pudo parsear ${options.file}: ${detail}`);
    }
    try {
        const report = await RecipeCatalogPreparationService.prepare(input, {
            companyId: options.companyId,
            userId: options.userId,
            dryRun: options.dryRun
        });
        await emit(report, options.reportFile);
        if (!report.valid) process.exitCode = 1;
    } catch (error) {
        if (error instanceof RecipeCatalogPreparationError) {
            await emit(error.report, options.reportFile);
            process.exitCode = 1;
            return;
        }
        throw error;
    }
}

main()
    .catch((error) => {
        const detail = error instanceof Error ? error.message : String(error);
        process.stderr.write(`Error preparando catálogo de recetas: ${detail}\n`);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
