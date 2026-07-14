import { CateringCashLedgerAuditService } from '../services/catering-cash-ledger-audit.service';
import prisma from '../utils/prisma';

async function main() {
    const rawCompanyId = process.env.AUDIT_COMPANY_ID?.trim();
    const companyId = rawCompanyId ? Number(rawCompanyId) : undefined;
    if (companyId !== undefined && (!Number.isInteger(companyId) || companyId <= 0)) {
        throw new Error('AUDIT_COMPANY_ID debe ser un entero positivo');
    }
    await CateringCashLedgerAuditService.assertClean(companyId);
    console.log(`Catering cash ledger OK (${companyId ? `company ${companyId}` : 'all companies'})`);
}

main()
    .catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(async () => prisma.$disconnect());
