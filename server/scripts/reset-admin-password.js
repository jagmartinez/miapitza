const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const username = process.argv[2] || 'admin';
const password = process.argv[3] || 'admin123';

async function main() {
    const prisma = new PrismaClient();
    try {
        const hash = await bcrypt.hash(password, 10);
        const result = await prisma.user.updateMany({
            where: { username },
            data: {
                password: hash,
                mustChangePassword: false,
                passwordChangedAt: new Date(),
            },
        });
        if (result.count === 0) {
            console.error('No user found:', username);
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
