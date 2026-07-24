import { describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import {
    CateringContractData,
    CateringContractService,
} from '../../services/catering-contract.service';

const clauses = {
    manifiestan: 'Ambas partes manifiestan su capacidad para contratar.',
    objetoContrato: 'El proveedor prestará el servicio descrito.',
    duracionServicio: 'El servicio se prestará en la fecha acordada.',
    gastosServicio: 'Los gastos incluidos son los detallados en este contrato.',
    demoraPago: 'Los pagos se realizarán conforme al calendario acordado.',
    obligacionesProveedor: 'El proveedor entregará los servicios contratados.',
    obligacionesCliente: 'El cliente facilitará el acceso y pagará el saldo.',
};

const contractData: CateringContractData = {
    eventId: 41,
    title: 'Boda',
    eventDate: new Date('2026-08-20T18:00:00.000Z'),
    issuedAt: new Date('2026-07-23T12:00:00.000Z'),
    peopleCount: 80,
    location: 'Salón Principal',
    company: {
        name: 'Restaurante Legal S.A.',
        taxId: 'J0310000123456',
        address: 'Managua, Nicaragua',
        phone: '2222-2222',
        email: 'legal@example.test',
    },
    customer: {
        name: 'Cliente Contratante',
        taxId: '001-010190-0001A',
        phone: '8888-8888',
    },
    currencySymbol: 'C$',
    fiscalSubtotal: 100,
    fiscalTax: 15,
    fiscalTaxRatePercent: 15,
    totalAmount: 115,
    balance: 115,
    lines: [{ description: 'Paquete de catering', quantity: 1, unitPrice: 115, subtotal: 115 }],
    clauses,
};

describe('CateringContractService', () => {
    it('renders a server-side PDF from reconciled persisted contract data', () => {
        const pdf = CateringContractService.renderContractPdf(contractData);
        expect(pdf.subarray(0, 4).toString('ascii')).toBe('%PDF');
        expect(pdf.byteLength).toBeGreaterThan(1_000);
    });

    it('fails closed when required company configuration is not persisted', async () => {
        jest.spyOn(prisma.cateringEvent, 'findFirst').mockResolvedValue({
            id: 41,
            companyId: 7,
            status: 'QUOTED',
            title: 'Boda',
            date: new Date('2026-08-20T18:00:00.000Z'),
            createdAt: new Date('2026-07-23T12:00:00.000Z'),
            peopleCount: 80,
            location: null,
            totalAmount: 115,
            balance: 115,
            fiscalSubtotal: 100,
            fiscalTax: 15,
            fiscalTaxRatePercent: 15,
            pricingSnapshotCapturedAt: new Date('2026-07-23T12:00:00.000Z'),
            clauses,
            company: { name: 'Restaurante Legal S.A.', ruc: 'J0310000123456' },
            customer: { name: 'Cliente', taxId: '001-010190-0001A', phone: '8888-8888' },
            services: [{
                quantity: 1,
                unitPrice: 115,
                subtotal: 115,
                notes: null,
                service: { name: 'Paquete' },
            }],
            menuItems: [],
        } as never);
        const settings = jest.spyOn(prisma.setting, 'findMany').mockResolvedValue([
            { name: '7_phone', value: '2222-2222' },
            { name: '7_email', value: 'legal@example.test' },
            { name: '7_currency_symbol', value: 'C$' },
        ] as never);

        await expect(CateringContractService.getContractData(41, 7)).rejects.toThrow(
            /dirección de la empresa/
        );
        expect(prisma.cateringEvent.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 41, companyId: 7 } })
        );
        expect(settings).toHaveBeenCalled();
    });

    it('rejects a contract whose stored line totals do not reconcile', async () => {
        jest.spyOn(prisma.cateringEvent, 'findFirst').mockResolvedValue({
            id: 41,
            companyId: 7,
            status: 'QUOTED',
            title: 'Boda',
            date: new Date('2026-08-20T18:00:00.000Z'),
            createdAt: new Date('2026-07-23T12:00:00.000Z'),
            peopleCount: 80,
            location: null,
            totalAmount: 115,
            balance: 115,
            fiscalSubtotal: 100,
            fiscalTax: 15,
            fiscalTaxRatePercent: 15,
            pricingSnapshotCapturedAt: new Date('2026-07-23T12:00:00.000Z'),
            clauses,
            company: { name: 'Restaurante Legal S.A.', ruc: 'J0310000123456' },
            customer: { name: 'Cliente', taxId: '001-010190-0001A', phone: '8888-8888' },
            services: [{
                quantity: 1,
                unitPrice: 100,
                subtotal: 100,
                notes: null,
                service: { name: 'Paquete' },
            }],
            menuItems: [],
        } as never);
        jest.spyOn(prisma.setting, 'findMany').mockResolvedValue([
            { name: '7_address', value: 'Managua' },
            { name: '7_phone', value: '2222-2222' },
            { name: '7_email', value: 'legal@example.test' },
            { name: '7_currency_symbol', value: 'C$' },
        ] as never);

        await expect(CateringContractService.getContractData(41, 7)).rejects.toThrow(
            /importes persistidos no están conciliados/
        );
    });
});
