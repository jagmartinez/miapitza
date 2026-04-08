import prisma from '../utils/prisma';

/**
 * Script to fix users without companyId
 * Assigns them to the first available company
 */
async function fixUsersWithoutCompany() {
    try {
        console.log('🔍 Checking for users without companyId...');

        const usersWithoutCompany = await prisma.user.findMany({
            where: {
                companyId: null
            },
            select: {
                id: true,
                username: true,
                email: true,
                name: true
            }
        });

        if (usersWithoutCompany.length === 0) {
            console.log('✅ All users have a companyId assigned');
            return;
        }

        console.log(`⚠️  Found ${usersWithoutCompany.length} users without companyId:`);
        usersWithoutCompany.forEach((user) => {
            console.log(`   - ${user.username} (${user.name})`);
        });

        // Get the first company
        const firstCompany = await prisma.company.findFirst({
            where: { active: true }
        });

        if (!firstCompany) {
            console.error('❌ No active company found. Please create a company first.');
            return;
        }

        console.log(`\n📝 Assigning users to company: ${firstCompany.name} (ID: ${firstCompany.id})`);

        // Update all users without companyId
        const result = await prisma.user.updateMany({
            where: {
                companyId: null
            },
            data: {
                companyId: firstCompany.id
            }
        });

        console.log(`✅ Updated ${result.count} users with companyId: ${firstCompany.id}`);
        console.log('\n✨ All users now have a valid companyId!');

    } catch (error) {
        console.error('❌ Error fixing users:', error);
    } finally {
        await prisma.$disconnect();
    }
}

// Run the script
fixUsersWithoutCompany();
