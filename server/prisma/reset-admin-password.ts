import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { assertStrongPassword, BCRYPT_ROUNDS } from '../src/utils/password-policy';

const username = process.argv[2];
const password = process.argv[3];
const companyId = Number(process.argv[4]);

if (!username || !password || !Number.isInteger(companyId) || companyId <= 0) {
    throw new Error('Uso: ts-node prisma/reset-admin-password.ts <usuario> <nueva-clave> <company-id>');
}
assertStrongPassword(password);

async function main() {
    const prisma = new PrismaClient();
    try {
        const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        const result = await prisma.user.updateMany({
            where: { username, companyId },
            data: {
                password: hash,
                mustChangePassword: true,
                passwordChangedAt: new Date(),
            },
        });

        if (result.count === 0) {
            console.error('No user found for the specified username and company');
            process.exit(1);
        }

        console.log(`Password updated for ${result.count} user(s) with username "${username}"`);
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
