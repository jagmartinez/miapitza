import prisma from '../utils/prisma';

/**
 * Script to list all cash shifts
 */
async function listAllShifts() {
    try {
        console.log('🔍 Listing all cash shifts...\n');

        const shifts = await prisma.cashShift.findMany({
            include: {
                cashRegister: {
                    select: {
                        name: true
                    }
                },
                user: {
                    select: {
                        name: true
                    }
                },
                company: {
                    select: {
                        name: true
                    }
                }
            },
            orderBy: {
                id: 'desc'
            },
            take: 20
        });

        if (shifts.length === 0) {
            console.log('❌ No shifts found');
            return;
        }

        console.log(`Found ${shifts.length} shift(s):\n`);

        shifts.forEach((shift) => {
            const status = shift.endDate ? '🔴 CLOSED' : '🟢 OPEN';
            console.log(`${status} Shift #${shift.id}`);
            console.log(`   Company: ${shift.company.name}`);
            console.log(`   Cash Register: ${shift.cashRegister.name}`);
            console.log(`   User: ${shift.user.name}`);
            console.log(`   Started: ${shift.startDate}`);
            console.log(`   Ended: ${shift.endDate || 'Still open'}`);
            console.log(`   Start Amount: C$ ${Number(shift.startAmount).toFixed(2)}`);
            if (shift.endAmount) {
                console.log(`   End Amount: C$ ${Number(shift.endAmount).toFixed(2)}`);
                console.log(`   Difference: C$ ${Number(shift.difference || 0).toFixed(2)}`);
            }
            console.log('');
        });

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

// Run the script
listAllShifts();
