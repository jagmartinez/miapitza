import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import prisma from '../utils/prisma';

const CONTRACT_SETTING_KEYS = ['address', 'phone', 'email', 'currency_symbol'] as const;
const CONTRACT_CLAUSE_KEYS = [
    'manifiestan',
    'objetoContrato',
    'duracionServicio',
    'gastosServicio',
    'demoraPago',
    'obligacionesProveedor',
    'obligacionesCliente',
] as const;

const CONTRACT_CLAUSE_TITLES: Record<(typeof CONTRACT_CLAUSE_KEYS)[number], string> = {
    manifiestan: 'I. MANIFIESTAN',
    objetoContrato: 'II. OBJETO DEL CONTRATO',
    duracionServicio: 'III. DURACIÓN DEL SERVICIO',
    gastosServicio: 'IV. GASTOS DURANTE EL SERVICIO',
    demoraPago: 'V. DEMORA DE PAGO',
    obligacionesProveedor: 'VI. OBLIGACIONES DEL PROVEEDOR',
    obligacionesCliente: 'VII. OBLIGACIONES DEL CLIENTE',
};

interface ContractLine {
    description: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
}

export interface CateringContractData {
    eventId: number;
    title: string;
    eventDate: Date;
    issuedAt: Date;
    peopleCount: number;
    location: string | null;
    company: {
        name: string;
        taxId: string;
        address: string;
        phone: string;
        email: string;
    };
    customer: {
        name: string;
        taxId: string;
        phone: string;
    };
    currencySymbol: string;
    fiscalSubtotal: number;
    fiscalTax: number;
    fiscalTaxRatePercent: number;
    totalAmount: number;
    balance: number;
    lines: ContractLine[];
    clauses: Record<(typeof CONTRACT_CLAUSE_KEYS)[number], string>;
}

export class CateringContractValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CateringContractValidationError';
    }
}

function requiredText(value: unknown, label: string): string {
    if (typeof value !== 'string' || !value.trim()) {
        throw new CateringContractValidationError(`No se puede generar el contrato: falta ${label}.`);
    }
    return value.trim();
}

function requiredMoney(value: unknown, label: string): number {
    if (value === null || value === undefined || value === '') {
        throw new CateringContractValidationError(`No se puede generar el contrato: falta ${label}.`);
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        throw new CateringContractValidationError(`No se puede generar el contrato: ${label} no es válido.`);
    }
    return parsed;
}

function toCents(value: number): number {
    return Math.round((value + Number.EPSILON) * 100);
}

function formatMoney(currencySymbol: string, value: number): string {
    return `${currencySymbol} ${value.toFixed(2)}`;
}

export class CateringContractService {
    static async getContractData(eventId: number, companyId: number): Promise<CateringContractData> {
        const event = await prisma.cateringEvent.findFirst({
            where: { id: eventId, companyId },
            include: {
                company: { select: { name: true, ruc: true } },
                customer: { select: { name: true, taxId: true, phone: true } },
                services: {
                    select: {
                        quantity: true,
                        unitPrice: true,
                        subtotal: true,
                        notes: true,
                        service: { select: { name: true } },
                    },
                },
                menuItems: {
                    select: {
                        quantity: true,
                        unitPrice: true,
                        subtotal: true,
                        menuItem: { select: { name: true } },
                    },
                },
            },
        });
        if (!event) {
            throw new CateringContractValidationError('Evento de catering no encontrado.');
        }
        if (event.status === 'CANCELLED') {
            throw new CateringContractValidationError('No se puede generar un contrato para un evento cancelado.');
        }

        const prefix = `${companyId}_`;
        const settingNames = CONTRACT_SETTING_KEYS.map((key) => `${prefix}${key}`);
        const settings = await prisma.setting.findMany({
            where: { companyId, name: { in: settingNames } },
            select: { name: true, value: true },
        });
        const configured = new Map(
            settings.map((setting) => [setting.name.slice(prefix.length), setting.value.trim()])
        );

        const rawClauses =
            event.clauses && typeof event.clauses === 'object' && !Array.isArray(event.clauses)
                ? (event.clauses as Record<string, unknown>)
                : {};
        const clauses = Object.fromEntries(
            CONTRACT_CLAUSE_KEYS.map((key) => [key, requiredText(rawClauses[key], `la cláusula "${CONTRACT_CLAUSE_TITLES[key]}"`)])
        ) as CateringContractData['clauses'];

        const lines: ContractLine[] = [
            ...event.services.map((line) => ({
                description: requiredText(line.service.name || line.notes, 'la descripción de un servicio'),
                quantity: requiredMoney(line.quantity, 'la cantidad de un servicio'),
                unitPrice: requiredMoney(line.unitPrice, 'el precio de un servicio'),
                subtotal: requiredMoney(line.subtotal, 'el subtotal de un servicio'),
            })),
            ...event.menuItems.map((line) => ({
                description: requiredText(line.menuItem.name, 'la descripción de un plato'),
                quantity: requiredMoney(line.quantity, 'la cantidad de un plato'),
                unitPrice: requiredMoney(line.unitPrice, 'el precio de un plato'),
                subtotal: requiredMoney(line.subtotal, 'el subtotal de un plato'),
            })),
        ];
        if (lines.length === 0) {
            throw new CateringContractValidationError('No se puede generar el contrato: no contiene servicios ni platos.');
        }
        for (const line of lines) {
            if (line.quantity <= 0 || toCents(line.quantity * line.unitPrice) !== toCents(line.subtotal)) {
                throw new CateringContractValidationError(
                    'No se puede generar el contrato: existe una línea cuyo importe no concilia.'
                );
            }
        }

        const totalAmount = requiredMoney(event.totalAmount, 'el total');
        const balance = requiredMoney(event.balance, 'el saldo');
        const fiscalSubtotal = requiredMoney(event.fiscalSubtotal, 'el subtotal fiscal persistido');
        const fiscalTax = requiredMoney(event.fiscalTax, 'el impuesto fiscal persistido');
        const fiscalTaxRatePercent = requiredMoney(event.fiscalTaxRatePercent, 'la tasa fiscal persistida');
        const lineTotal = lines.reduce((sum, line) => sum + line.subtotal, 0);
        if (
            !Number.isInteger(event.peopleCount)
            || event.peopleCount < 1
            || Number.isNaN(event.date.getTime())
            || Number.isNaN(event.createdAt.getTime())
        ) {
            throw new CateringContractValidationError(
                'No se puede generar el contrato: los datos generales del evento no son válidos.'
            );
        }
        if (
            !event.pricingSnapshotCapturedAt
            || toCents(lineTotal) !== toCents(totalAmount)
            || toCents(fiscalSubtotal + fiscalTax) !== toCents(totalAmount)
            || toCents(balance) > toCents(totalAmount)
            || fiscalTaxRatePercent > 100
        ) {
            throw new CateringContractValidationError(
                'No se puede generar el contrato: los importes persistidos no están conciliados.'
            );
        }

        return {
            eventId: event.id,
            title: requiredText(event.title, 'el título del evento'),
            eventDate: event.date,
            issuedAt: event.createdAt,
            peopleCount: event.peopleCount,
            location: event.location?.trim() || null,
            company: {
                name: requiredText(event.company.name, 'el nombre legal de la empresa'),
                taxId: requiredText(event.company.ruc, 'el RUC de la empresa'),
                address: requiredText(configured.get('address'), 'la dirección de la empresa en Configuración'),
                phone: requiredText(configured.get('phone'), 'el teléfono de la empresa en Configuración'),
                email: requiredText(configured.get('email'), 'el correo de la empresa en Configuración'),
            },
            customer: {
                name: requiredText(event.customer?.name, 'el nombre del cliente'),
                taxId: requiredText(event.customer?.taxId, 'la identificación fiscal del cliente'),
                phone: requiredText(event.customer?.phone, 'el teléfono del cliente'),
            },
            currencySymbol: requiredText(
                configured.get('currency_symbol'),
                'el símbolo de moneda en Configuración'
            ),
            fiscalSubtotal,
            fiscalTax,
            fiscalTaxRatePercent,
            totalAmount,
            balance,
            lines,
            clauses,
        };
    }

    static renderContractPdf(data: CateringContractData): Buffer {
        const doc = new jsPDF({ unit: 'mm', format: 'a4' });
        const margin = 15;
        const pageBottom = 278;
        const locale = 'es-NI';

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(18);
        doc.text(data.company.name, margin, 18);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text(`RUC: ${data.company.taxId}`, margin, 24);
        doc.text(data.company.address, margin, 29, { maxWidth: 100 });
        doc.text(`Tel: ${data.company.phone} | ${data.company.email}`, margin, 38, { maxWidth: 105 });

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.text('CONTRATO DE CATERING', 195, 18, { align: 'right' });
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text(`Orden No. EVT-${String(data.eventId).padStart(5, '0')}`, 195, 24, { align: 'right' });
        doc.text(`Fecha de emisión: ${data.issuedAt.toLocaleDateString(locale)}`, 195, 29, { align: 'right' });
        doc.setDrawColor(60, 86, 125);
        doc.line(margin, 43, 195, 43);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text('INFORMACIÓN GENERAL', margin, 51);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text(`Contratante: ${data.customer.name}`, margin, 58);
        doc.text(`Cédula/RUC: ${data.customer.taxId}`, margin, 64);
        doc.text(`Contacto: ${data.customer.phone}`, margin, 70);
        doc.text(`Evento: ${data.title}`, 110, 58, { maxWidth: 85 });
        doc.text(`Fecha: ${data.eventDate.toLocaleDateString(locale)}`, 110, 64);
        doc.text(`Asistentes: ${data.peopleCount}`, 110, 70);
        if (data.location) doc.text(`Lugar: ${data.location}`, 110, 76, { maxWidth: 85 });

        autoTable(doc, {
            head: [['Descripción', 'Cant.', 'Precio unit.', 'Importe']],
            body: data.lines.map((line) => [
                line.description,
                line.quantity.toString(),
                formatMoney(data.currencySymbol, line.unitPrice),
                formatMoney(data.currencySymbol, line.subtotal),
            ]),
            startY: data.location ? 83 : 77,
            margin: { left: margin, right: margin },
            theme: 'striped',
            headStyles: { fillColor: [41, 82, 132], textColor: 255 },
            columnStyles: {
                1: { halign: 'center' },
                2: { halign: 'right' },
                3: { halign: 'right' },
            },
        });

        let y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 7;
        const ensureSpace = (requiredHeight: number) => {
            if (y + requiredHeight > pageBottom) {
                doc.addPage();
                y = 18;
            }
        };
        const writeSummaryRow = (label: string, value: string, bold = false) => {
            ensureSpace(6);
            doc.setFont('helvetica', bold ? 'bold' : 'normal');
            doc.text(label, 135, y);
            doc.text(value, 195, y, { align: 'right' });
            y += 6;
        };
        writeSummaryRow('Subtotal:', formatMoney(data.currencySymbol, data.fiscalSubtotal));
        writeSummaryRow(
            `IVA (${data.fiscalTaxRatePercent.toFixed(2)}%):`,
            formatMoney(data.currencySymbol, data.fiscalTax)
        );
        writeSummaryRow('TOTAL:', formatMoney(data.currencySymbol, data.totalAmount), true);
        writeSummaryRow('SALDO PENDIENTE:', formatMoney(data.currencySymbol, data.balance), true);
        y += 3;

        const writeClause = (title: string, body: string) => {
            const titleLines = doc.splitTextToSize(title, 180) as string[];
            const bodyLines = doc.splitTextToSize(body, 180) as string[];
            ensureSpace((titleLines.length + 1) * 5);
            doc.setFont('helvetica', 'bold');
            doc.text(titleLines, margin, y);
            y += titleLines.length * 4.5 + 1;
            doc.setFont('helvetica', 'normal');
            for (const line of bodyLines) {
                ensureSpace(5);
                doc.text(line, margin, y);
                y += 4.5;
            }
            y += 3;
        };

        ensureSpace(10);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text('COMPROMISOS Y CLÁUSULAS', margin, y);
        y += 7;
        doc.setFontSize(9);
        for (const key of CONTRACT_CLAUSE_KEYS) {
            writeClause(CONTRACT_CLAUSE_TITLES[key], data.clauses[key]);
        }

        ensureSpace(32);
        y += 18;
        doc.setDrawColor(70);
        doc.line(margin, y, 85, y);
        doc.line(125, y, 195, y);
        doc.setFont('helvetica', 'bold');
        doc.text(data.customer.name, 50, y + 5, { align: 'center', maxWidth: 70 });
        doc.text('REPRESENTANTE LEGAL', 160, y + 5, { align: 'center' });
        doc.setFont('helvetica', 'normal');
        doc.text('CONTRATANTE', 50, y + 10, { align: 'center' });
        doc.text(data.company.name, 160, y + 10, { align: 'center', maxWidth: 70 });

        const pageCount = doc.getNumberOfPages();
        for (let page = 1; page <= pageCount; page += 1) {
            doc.setPage(page);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            doc.setTextColor(120);
            doc.text(`Página ${page} de ${pageCount}`, 105, 290, { align: 'center' });
        }

        return Buffer.from(doc.output('arraybuffer'));
    }

    static async generateContractPdf(eventId: number, companyId: number): Promise<Buffer> {
        return this.renderContractPdf(await this.getContractData(eventId, companyId));
    }
}
