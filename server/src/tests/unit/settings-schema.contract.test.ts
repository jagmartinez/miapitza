import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

describe('settings schema contract', () => {
    const schema = fs.readFileSync(path.resolve(__dirname, '../../../prisma/schema.prisma'), 'utf8');
    const block = (name: string) => {
        const start = schema.indexOf(`model ${name} {`);
        expect(start).toBeGreaterThan(-1);
        return schema.slice(start, schema.indexOf('\n}', start));
    };

    it('declares BranchSettingOverride with unique branch+name', () => {
        const m = block('BranchSettingOverride');
        expect(m).toContain('@@unique([branchId, name])');
        expect(m).toContain('@@index([companyId, name])');
        expect(m).toMatch(/branch\s+Branch\s+@relation\(fields: \[branchId\], references: \[id\], onDelete: Cascade\)/);
        expect(m).toMatch(/company\s+Company\s+@relation/);
    });

    it('declares SettingAudit', () => {
        const m = block('SettingAudit');
        expect(m).toContain('@@index([companyId, name, createdAt])');
        expect(m).toMatch(/oldValue\s+String\?/);
        expect(m).toMatch(/newValue\s+String\?/);
    });

    it('adds inverse relations on Company and Branch', () => {
        expect(block('Company')).toMatch(/branchSettingOverrides\s+BranchSettingOverride\[\]/);
        expect(block('Branch')).toMatch(/settingOverrides\s+BranchSettingOverride\[\]/);
    });
});
