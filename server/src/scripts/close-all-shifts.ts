import prisma from '../utils/prisma';

/**
 * Script to close all open cash shifts
 * Useful for testing or cleaning up stuck shifts
 */
async function closeAllOpenShifts() {
    try {
        console.log('🔍 Looking for open cash shifts...');

        const openShifts = await prisma.cashShift.findMany({
            where: {
                endDate: null
            },
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
                movements: true
            }
        });

        if (openShifts.length === 0) {
            console.log('✅ No open shifts found');
            return;
        }

        console.log(`\n⚠️  Found ${openShifts.length} open shift(s):\n`);

        for (const shift of openShifts) {
            const movementTotal = shift.movements.reduce((sum, m) => {
                return sum + (m.type === 'IN' ? Number(m.amount) : -Number(m.amount));
            }, 0);

            const expectedBalance = Number(shift.startAmount) + movementTotal;

            console.log(`📊 Shift #${shift.id}:`);
            console.log(`   Cash Register: ${shift.cashRegister.name}`);
            console.log(`   User: ${shift.user.name}`);
            console.log(`   Started: ${shift.startDate}`);
            console.log(`   Start Amount: C$ ${Number(shift.startAmount).toFixed(2)}`);
            console.log(`   Expected Balance: C$ ${expectedBalance.toFixed(2)}`);
            console.log(`   Movements: ${shift.movements.length}`);
            console.log('');
        }

        console.log('❓ Do you want to close all these shifts? (This will set endAmount = expectedBalance)');
        console.log('   Run with --confirm flag to proceed\n');

        // Check if --confirm flag is present
        if (process.argv.includes('--confirm')) {
            console.log('🔄 Closing all open shifts...\n');

            for (const shift of openShifts) {
                const movementTotal = shift.movements.reduce((sum, m) => {
                    return sum + (m.type === 'IN' ? Number(m.amount) : -Number(m.amount));
                }, 0);

                const expectedBalance = Number(shift.startAmount) + movementTotal;

                await prisma.cashShift.update({
                    where: { id: shift.id },
                    data: {
                        endDate: new Date(),
                        endAmount: expectedBalance,
                        difference: 0,
                        notes: 'Closed automatically by cleanup script'
                    }
                });

                console.log(`✅ Closed shift #${shift.id} (${shift.cashRegister.name})`);
            }

            console.log(`\n✨ Successfully closed ${openShifts.length} shift(s)!`);
        } else {
            console.log('ℹ️  No changes made. Run with --confirm to close the shifts.');
        }

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

// Run the script
closeAllOpenShifts();
