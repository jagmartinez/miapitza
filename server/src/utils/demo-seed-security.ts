import { assertStrongPassword } from './password-policy';

export type DemoSeedMode = 'operational' | 'features';

export interface DemoSeedConfig {
    companyId: number;
    password: string;
    branchId?: number;
    primaryBranchCode?: string;
    secondaryBranchCode?: string;
}

function positiveInteger(value: string | undefined, name: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${name} debe ser un entero positivo explicito`);
    }
    return parsed;
}

function requiredText(value: string | undefined, name: string): string {
    const normalized = value?.trim();
    if (!normalized) throw new Error(`${name} es obligatorio`);
    return normalized;
}

export function resolveDemoSeedConfig(env: NodeJS.ProcessEnv, mode: DemoSeedMode): DemoSeedConfig {
    if (env.NODE_ENV === 'production') {
        throw new Error('Los seeds demo estan prohibidos cuando NODE_ENV=production');
    }
    if (env.ALLOW_DEMO_SEED !== 'true') {
        throw new Error('Defina ALLOW_DEMO_SEED=true para confirmar la carga de fixtures demo');
    }

    const password = requiredText(env.DEMO_SEED_PASSWORD, 'DEMO_SEED_PASSWORD');
    assertStrongPassword(password);
    const companyId = positiveInteger(env.DEMO_SEED_COMPANY_ID, 'DEMO_SEED_COMPANY_ID');

    if (mode === 'operational') {
        return {
            companyId,
            password,
            branchId: positiveInteger(env.DEMO_SEED_BRANCH_ID, 'DEMO_SEED_BRANCH_ID')
        };
    }

    const primaryBranchCode = requiredText(env.DEMO_SEED_PRIMARY_BRANCH_CODE, 'DEMO_SEED_PRIMARY_BRANCH_CODE');
    const secondaryBranchCode = requiredText(env.DEMO_SEED_SECONDARY_BRANCH_CODE, 'DEMO_SEED_SECONDARY_BRANCH_CODE');
    if (primaryBranchCode.toLocaleUpperCase() === secondaryBranchCode.toLocaleUpperCase()) {
        throw new Error('Las sucursales primaria y secundaria de demo deben usar codigos diferentes');
    }
    return { companyId, password, primaryBranchCode, secondaryBranchCode };
}
