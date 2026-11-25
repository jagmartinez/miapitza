// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { useSettingsDraft, validateSettingValue } from './useSettingsDraft';
import type { ResolvedSetting, SettingDef } from '../../services/settingsScope';

const def = (over: Partial<SettingDef>): SettingDef => ({
    key: 'goal.avgTicket', type: 'number', default: '550', group: 'metas', section: 'metas',
    label: 'Ticket', description: '', min: 0, branchable: true, ...over
});
const res = (key: string, value: string, source: ResolvedSetting['source'], companyValue = value): ResolvedSetting =>
    ({ key, value, source, companyValue });

describe('useSettingsDraft', () => {
    const defs = [def({}), def({ key: 'goal.laborCostMaxPct' })];
    const resolved = {
        'goal.avgTicket': res('goal.avgTicket', '550', 'company'),
        'goal.laborCostMaxPct': res('goal.laborCostMaxPct', '30', 'branch', '25')
    };

    it('volver al valor original deja dirtyKeys vacío', () => {
        const { result } = renderHook(() => useSettingsDraft(defs, resolved));
        act(() => result.current.set('goal.avgTicket', '600'));
        expect(result.current.dirtyKeys).toEqual(['goal.avgTicket']);
        act(() => result.current.set('goal.avgTicket', '550'));
        expect(result.current.dirtyKeys).toEqual([]);
    });

    it('número inválido reporta el error', () => {
        const { result } = renderHook(() => useSettingsDraft(defs, resolved));
        act(() => result.current.set('goal.avgTicket', 'abc'));
        expect(result.current.errors['goal.avgTicket']).toBe('Ingresa un número válido, mayor o igual a 0');
    });

    it('reset en una clave con override envía el valor de empresa', () => {
        const { result } = renderHook(() => useSettingsDraft(defs, resolved));
        act(() => result.current.reset('goal.laborCostMaxPct'));
        expect(result.current.dirtyKeys).toEqual(['goal.laborCostMaxPct']);
        expect(result.current.changes()).toEqual({ 'goal.laborCostMaxPct': '25' });
        act(() => result.current.discard());
        expect(result.current.dirtyKeys).toEqual([]);
    });

    it('validateSettingValue rechaza vacío y comas de miles', () => {
        expect(validateSettingValue(def({}), '')).not.toBeNull();
        expect(validateSettingValue(def({}), '1,234.50')).not.toBeNull();
        expect(validateSettingValue(def({}), '1234.50')).toBeNull();
    });
});
