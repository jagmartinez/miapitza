import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { SETTINGS_REGISTRY, SETTINGS_SECTIONS } from '../../constants/settings-registry';
import { SettingConflictError, SettingsScopeService, SettingValidationError } from '../../services/settings-scope.service';

afterEach(() => { jest.restoreAllMocks(); });

const d = (s: string) => new Date(s);

function mockReads(opts: { company?: Record<string, string>; overrides?: Record<string, string>; ruc?: string | null } = {}) {
    jest.spyOn(prisma.company, 'findUnique').mockResolvedValue({ ruc: opts.ruc ?? null } as never);
    jest.spyOn(prisma.setting, 'findMany').mockResolvedValue(
        Object.entries(opts.company ?? {}).map(([k, value], i) => ({ id: i + 1, name: `1_${k}`, value, updatedAt: d('2026-01-01T00:00:00Z') })) as never
    );
    jest.spyOn(prisma.branchSettingOverride, 'findMany').mockResolvedValue(
        Object.entries(opts.overrides ?? {}).map(([name, value], i) => ({ id: i + 1, name, value, updatedAt: d('2026-01-02T00:00:00Z') })) as never
    );
}

const fn = () => jest.fn<(arg?: unknown) => Promise<unknown>>(async () => ({}));

function mockTx(opts: Parameters<typeof mockReads>[0] = {}) {
    mockReads(opts);
    const tx = {
        setting: { findMany: prisma.setting.findMany, upsert: fn() },
        branchSettingOverride: { findMany: prisma.branchSettingOverride.findMany, upsert: fn(), delete: fn(), deleteMany: fn() },
        settingAudit: { create: fn() },
        company: { findUnique: prisma.company.findUnique, update: fn() },
        $queryRaw: fn()
    };
    jest.spyOn(prisma, '$transaction').mockImplementation((async (cb: (t: unknown) => unknown) => cb(tx)) as never);
    return tx;
}

describe('SETTINGS_REGISTRY', () => {
    it('references existing sections and has unique keys', () => {
        const sections = new Set(SETTINGS_SECTIONS.map((s) => s.id));
        for (const def of SETTINGS_REGISTRY) expect(sections.has(def.section)).toBe(true);
        const keys = SETTINGS_REGISTRY.map((d2) => d2.key);
        expect(new Set(keys).size).toBe(keys.length);
    });
});

describe('SettingsScopeService.resolve', () => {
    it('reports branch, company and default sources', async () => {
        mockReads({ company: { 'goal.foodCostPct': '32', 'goal.avgTicket': '550' }, overrides: { 'goal.foodCostPct': '34' } });
        const out = await SettingsScopeService.resolve(1, 3);
        expect(out['goal.foodCostPct']).toMatchObject({ value: '34', source: 'branch', companyValue: '32' });
        expect(out['goal.avgTicket']).toMatchObject({ value: '550', source: 'company' });
        expect(out['goal.grossMarginPct']).toMatchObject({ value: '68', source: 'default', companyValue: '68' });
    });

    it('ignores overrides for non branchable keys', async () => {
        mockReads({ company: { tax_rate: '15' }, overrides: { tax_rate: '10' } });
        const out = await SettingsScopeService.resolve(1, 3);
        expect(out.tax_rate).toMatchObject({ value: '15', source: 'company' });
    });
});

describe('SettingsScopeService.update', () => {
    it('rejects thousands separators with a per-key error and writes nothing', async () => {
        const tx = mockTx();
        await expect(SettingsScopeService.update(1, null, 9, { tax_rate: '1,5' })).rejects.toBeInstanceOf(SettingValidationError);
        await expect(SettingsScopeService.update(1, null, 9, { tax_rate: '' })).rejects.toMatchObject({ errors: { tax_rate: expect.any(String) } });
        expect(tx.setting.upsert).not.toHaveBeenCalled();
    });

    it('is atomic: one invalid key blocks the valid ones', async () => {
        const tx = mockTx();
        await expect(SettingsScopeService.update(1, null, 9, { tax_rate: 15, tipRate: 'abc' })).rejects.toBeInstanceOf(SettingValidationError);
        expect(tx.setting.upsert).not.toHaveBeenCalled();
    });

    it('refuses branch scope for non branchable keys', async () => {
        const tx = mockTx();
        await expect(SettingsScopeService.update(1, 3, 9, { tax_rate: 15 })).rejects.toMatchObject({
            errors: { tax_rate: expect.stringContaining('no se puede personalizar por sucursal') }
        });
        expect(tx.branchSettingOverride.upsert).not.toHaveBeenCalled();
    });

    it('removes the override and audits when the branch value equals the company value', async () => {
        const tx = mockTx({ company: { 'goal.avgTicket': '550' }, overrides: { 'goal.avgTicket': '600' } });
        await SettingsScopeService.update(1, 3, 9, { 'goal.avgTicket': '550.00' });
        expect(tx.branchSettingOverride.upsert).not.toHaveBeenCalled();
        expect(tx.branchSettingOverride.deleteMany).toHaveBeenCalledWith({ where: { branchId: 3, name: 'goal.avgTicket' } });
        expect(tx.settingAudit.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ companyId: 1, branchId: 3, name: 'goal.avgTicket', oldValue: '600', newValue: '550.00', userId: 9 })
        });
    });

    it('does not create an override when the value matches the company and none existed', async () => {
        const tx = mockTx({ company: { 'goal.avgTicket': '550' } });
        await SettingsScopeService.update(1, 3, 9, { 'goal.avgTicket': 550 });
        expect(tx.branchSettingOverride.upsert).not.toHaveBeenCalled();
        expect(tx.settingAudit.create).not.toHaveBeenCalled();
    });

    it('creates an override that differs and audits old (inherited) and new values', async () => {
        const tx = mockTx({ company: { 'goal.foodCostPct': '32' } });
        await SettingsScopeService.update(1, 3, 9, { 'goal.foodCostPct': '34' });
        expect(tx.branchSettingOverride.upsert).toHaveBeenCalledWith(expect.objectContaining({
            where: { branchId_name: { branchId: 3, name: 'goal.foodCostPct' } },
            create: expect.objectContaining({ companyId: 1, branchId: 3, name: 'goal.foodCostPct', value: '34.00', updatedById: 9 })
        }));
        expect(tx.settingAudit.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ branchId: 3, oldValue: '32', newValue: '34.00' })
        });
    });

    it('writes the company value under the prefixed name and leaves overrides untouched', async () => {
        const tx = mockTx({ company: { 'goal.foodCostPct': '32' }, overrides: { 'goal.foodCostPct': '34' } });
        await SettingsScopeService.update(1, null, 9, { 'goal.foodCostPct': 30 });
        expect(tx.setting.upsert).toHaveBeenCalledWith(expect.objectContaining({
            where: { companyId_name: { companyId: 1, name: '1_goal.foodCostPct' } }
        }));
        expect(tx.branchSettingOverride.deleteMany).not.toHaveBeenCalled();
        expect(tx.branchSettingOverride.upsert).not.toHaveBeenCalled();
    });

    it('throws a conflict when the expected version is stale', async () => {
        const tx = mockTx({ company: { tax_rate: '15' } });
        await expect(SettingsScopeService.update(1, null, 9, { tax_rate: 16 }, 'stale')).rejects.toBeInstanceOf(SettingConflictError);
        expect(tx.setting.upsert).not.toHaveBeenCalled();
    });

    it('accepts the current version', async () => {
        mockTx({ company: { tax_rate: '15' } });
        const { version } = await SettingsScopeService.resolveWithVersion(1, null);
        const out = await SettingsScopeService.update(1, null, 9, { tax_rate: 16 }, version);
        expect(typeof out.version).toBe('string');
    });
});

describe('SettingsScopeService.getNumber', () => {
    it('returns the resolved number', async () => {
        mockReads({ company: { 'goal.foodCostPct': '32' }, overrides: { 'goal.foodCostPct': '34.00' } });
        await expect(SettingsScopeService.getNumber(1, 3, 'goal.foodCostPct')).resolves.toBe(34);
    });
});

describe('SettingsScopeService.update review fixes', () => {
    it('registry defaults match the runtime defaults', () => {
        const def = (k: string) => SETTINGS_REGISTRY.find((x) => x.key === k)!.default;
        expect(def('password_expiry_days')).toBe('90');
        expect(def('session_timeout_minutes')).toBe('30');
        expect(def('tipRate')).toBe('0');
    });

    it('persists an explicit value equal to the default when no row exists', async () => {
        const tx = mockTx();
        await SettingsScopeService.update(1, null, 9, { password_expiry_days: 0 });
        expect(tx.setting.upsert).toHaveBeenCalledTimes(1);
        expect(tx.settingAudit.create).toHaveBeenCalledTimes(1);
        const again = mockTx({ company: { password_expiry_days: '0' } });
        await SettingsScopeService.update(1, null, 9, { password_expiry_days: 0 });
        expect(again.setting.upsert).not.toHaveBeenCalled();
    });

    it('rejects kds_warning_minutes >= kds_urgent_minutes using stored values', async () => {
        const tx = mockTx({ company: { kds_urgent_minutes: '5' } });
        await expect(SettingsScopeService.update(1, null, 9, { kds_warning_minutes: 20 })).rejects.toMatchObject({
            errors: { kds_warning_minutes: expect.any(String) }
        });
        await expect(SettingsScopeService.update(1, null, 9, { kds_warning_minutes: 20, kds_urgent_minutes: 30 })).resolves.toBeDefined();
        expect(tx.setting.upsert).toHaveBeenCalledTimes(2);
    });

    it('rejects a branch kds save that breaks warning < urgent', async () => {
        const tx = mockTx({ company: { kds_urgent_minutes: '30' } });
        await expect(SettingsScopeService.update(1, 3, 9, { kds_warning_minutes: 40 })).rejects.toMatchObject({
            errors: { kds_warning_minutes: expect.any(String) }
        });
        await expect(SettingsScopeService.update(1, 3, 9, { kds_warning_minutes: 20, kds_urgent_minutes: 20 })).rejects.toBeInstanceOf(SettingValidationError);
        await expect(SettingsScopeService.update(1, 3, 9, { kds_warning_minutes: 10 })).resolves.toBeDefined();
        expect(tx.branchSettingOverride.upsert).toHaveBeenCalledTimes(1);
    });

    it('reads ruc from Company.ruc', async () => {
        mockReads({ company: { ruc: 'OLD' }, ruc: 'J0310000000001' });
        const out = await SettingsScopeService.resolve(1, null);
        expect(out.ruc).toMatchObject({ value: 'J0310000000001', source: 'company' });
    });
});
