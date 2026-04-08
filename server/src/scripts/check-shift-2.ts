import prisma from '../utils/prisma';
import { getErrorMessage } from '../utils/error';

/**
 * Script to check shift #2 details
 */
async function checkShift() {
    try {
        const shift = await prisma.cashShift.findFirst({
            where: { id: 2 },
            include: {
                cashRegister: true,
                user: true,
                company: true,
                movements: true,
                counts: true
            }
        });

        if (!shift) {
            console.log('❌ Shift #2 not found');
            return;
        }

        console.log('📊 Shift #2 Details:\n');
        console.log(JSON.stringify(shift, null, 2));

    } catch (error: unknown) {
        console.error('❌ Error:', getErrorMessage(error));
        if (error instanceof Error && error.stack) {
            console.error('Stack:', error.stack);
        }
    } finally {
        await prisma.$disconnect();
    }
}

checkShift();
