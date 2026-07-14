import fs from 'fs';
import path from 'path';
import { resolveDemoSeedConfig } from '../../utils/demo-seed-security';

const strong = 'DemoStrong123!';

describe('demo seed security gate', () => {
    it('rejects production even when the opt-in and credentials are present', () => {
        expect(() => resolveDemoSeedConfig({
            NODE_ENV: 'production', ALLOW_DEMO_SEED: 'true', DEMO_SEED_PASSWORD: strong,
            DEMO_SEED_COMPANY_ID: '1', DEMO_SEED_BRANCH_ID: '1'
        }, 'operational')).toThrow(/prohibidos/i);
    });

    it('requires explicit opt-in, tenant, branch and a strong shared-policy password', () => {
        expect(() => resolveDemoSeedConfig({}, 'operational')).toThrow(/ALLOW_DEMO_SEED/);
        expect(() => resolveDemoSeedConfig({
            ALLOW_DEMO_SEED: 'true', DEMO_SEED_PASSWORD: 'password123',
            DEMO_SEED_COMPANY_ID: '1', DEMO_SEED_BRANCH_ID: '1'
        }, 'operational')).toThrow(/contraseña/i);
        expect(resolveDemoSeedConfig({
            ALLOW_DEMO_SEED: 'true', DEMO_SEED_PASSWORD: strong,
            DEMO_SEED_COMPANY_ID: '7', DEMO_SEED_BRANCH_ID: '9'
        }, 'operational')).toEqual({ companyId: 7, branchId: 9, password: strong });
    });

    it('requires explicit, distinct feature-fixture branch codes', () => {
        expect(() => resolveDemoSeedConfig({
            ALLOW_DEMO_SEED: 'true', DEMO_SEED_PASSWORD: strong, DEMO_SEED_COMPANY_ID: '7',
            DEMO_SEED_PRIMARY_BRANCH_CODE: 'MAIN', DEMO_SEED_SECONDARY_BRANCH_CODE: ' main '
        }, 'features')).toThrow(/diferentes/i);
    });

    it('keeps both demo scripts on the shared strong-password and explicit-scope contract', () => {
        const scripts = ['operational-seed.ts', 'seed-feature-scenarios.ts'].map((file) =>
            fs.readFileSync(path.resolve(process.cwd(), 'prisma', file), 'utf8')
        );

        for (const source of scripts) {
            expect(source).toContain('resolveDemoSeedConfig(process.env');
            expect(source).toContain('BCRYPT_ROUNDS');
            expect(source).not.toMatch(/password123/i);
            expect(source).not.toMatch(/bcrypt\.hash\([^\n]+,\s*10\s*\)/);
        }
        expect(scripts[0]).toContain('data: { password: hpwd');
        expect(scripts[1]).toContain('password: DEMO_PASSWORD_HASH');
    });
});
