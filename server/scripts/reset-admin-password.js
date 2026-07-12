const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const username = process.argv[2];
const password = process.argv[3];
const companyId = Number(process.argv[4]);

if (!username || !password || !Number.isInteger(companyId) || companyId <= 0) {
    console.error('Usage: node scripts/reset-admin-password.js <username> <new-password> <company-id>');
    process.exit(1);
}
if (password.length < 12) {
    console.error('The new password must contain at least 12 characters.');
    process.exit(1);
}

async function main() {
    const prisma = new PrismaClient();
    try {
        const hash = await bcrypt.hash(password, 10);
        const result = await prisma.user.updateMany({
            where: { username, companyId },
            data: {
                password: hash,
                mustChangePassword: true,
                passwordChangedAt: new Date(),
            },
        });
        if (result.count === 0) {
            console.error('No user found for the specified username and company.');
            process.exit(1);
        }
        console.log('Updated users:', result.count);
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
