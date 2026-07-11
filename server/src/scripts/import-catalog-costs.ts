import { readFile, writeFile } from 'fs/promises';
import path from 'path';

import prisma from '../utils/prisma';
import {
    CatalogCostImportError,
    CatalogCostImportReport,
    CatalogCostImportService
} from '../services/catalog-cost-import.service';

type CliOptions = {
    file: string;
    companyId: number | null;
    userId: number | null;
    dryRun: boolean;
    allowPartial: boolean;
    reportFile: string | null;
    help: boolean;
};

const DEFAULT_FILE = path.resolve(__dirname, '../../prisma/data/recetas-menu.cost-map.json');

const HELP = `Importación segura de catálogo y costos de referencia

Uso:
  npm exec ts-node -- src/scripts/import-catalog-costs.ts --company-id <id> [opciones]

Opciones:
  --file <ruta>       Mapa JSON (default: prisma/data/recetas-menu.cost-map.json)
  --company-id <id>   Empresa destino; obligatorio
  --dry-run           Solo valida y planifica (modo predeterminado)
  --apply             Aplica dentro de una transacción
  --user-id <id>      Usuario de auditoría; obligatorio con --apply
  --allow-partial     Permite aplicar filas APPLY aunque existan filas BLOCK
  --report <ruta>     Guarda el reporte JSON además de imprimirlo
  --help              Muestra esta ayuda

Garantías:
  - usa exactamente el precio evaluado del Excel; si la fórmula ya tiene *1.15 no lo suma otra vez;
  - actualiza únicamente Product.cost;
  - preserva currentAverageCost y lastPurchaseCost;
  - no crea compras, stock, movimientos ni ProductCostHistory.
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

function positiveId(raw: string, flag: string): number {
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) throw new Error(`${flag} debe ser entero positivo.`);
    return value;
}

export function parseCatalogCostImportArgs(args: string[]): CliOptions {
    const options: CliOptions = {
        file: DEFAULT_FILE,
        companyId: null,
        userId: null,
        dryRun: true,
        allowPartial: false,
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
        } else if (flag === '--allow-partial') {
            options.allowPartial = true;
        } else if (flag === '--file') {
            const read = readValue(args, index, '--file');
            options.file = path.resolve(read.value);
            index = read.nextIndex;
        } else if (flag === '--company-id') {
            const read = readValue(args, index, '--company-id');
            options.companyId = positiveId(read.value, '--company-id');
            index = read.nextIndex;
        } else if (flag === '--user-id') {
            const read = readValue(args, index, '--user-id');
            options.userId = positiveId(read.value, '--user-id');
            index = read.nextIndex;
        } else if (flag === '--report') {
            const read = readValue(args, index, '--report');
            options.reportFile = path.resolve(read.value);
            index = read.nextIndex;
        } else {
            throw new Error(`Opción desconocida: ${token}`);
        }
    }
    return options;
}

async function emit(report: CatalogCostImportReport, reportFile: string | null): Promise<void> {
    const rendered = `${JSON.stringify(report, null, 2)}\n`;
    process.stdout.write(rendered);
    if (reportFile) await writeFile(reportFile, rendered, 'utf8');
}

async function main(): Promise<void> {
    const options = parseCatalogCostImportArgs(process.argv.slice(2));
    if (options.help) {
        process.stdout.write(HELP);
        return;
    }
    if (!options.companyId) throw new Error('--company-id es obligatorio; nunca se infiere.');
    if (!options.dryRun && !options.userId) {
        const users = await CatalogCostImportService.listValidAuditUsers(options.companyId);
        throw new Error(
            '--user-id es obligatorio con --apply. Usuarios válidos: '
            + (users.length > 0 ? users.map((user) => `${user.id} (${user.name})`).join(', ') : 'ninguno')
        );
    }

    const raw = await readFile(options.file, 'utf8');
    let map: unknown;
    try {
        map = JSON.parse(raw);
    } catch (error) {
        throw new Error(`JSON inválido en ${options.file}: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
        const report = await CatalogCostImportService.importMap(map, {
            companyId: options.companyId,
            userId: options.userId,
            dryRun: options.dryRun,
            allowPartial: options.allowPartial
        });
        await emit(report, options.reportFile);
        if (!report.valid) process.exitCode = 1;
    } catch (error) {
        if (error instanceof CatalogCostImportError) {
            await emit(error.report, options.reportFile);
            process.exitCode = 1;
            return;
        }
        throw error;
    }
}

if (require.main === module) {
    main()
        .catch((error) => {
            process.stderr.write(`Error de importación: ${error instanceof Error ? error.message : String(error)}\n`);
            process.exitCode = 1;
        })
        .finally(async () => {
            await prisma.$disconnect();
        });
}
