import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { ReportExtendedService } from '../../services/report-extended.service';
import { ReportService } from '../../services/report.service';
import { UnitConversionService } from '../../services/unit-conversion.service';

type ReportWithConversionGuard = {
    recipeQuantityInBase(companyId: number, recipe: {
        quantity: number;
        unit?: string | null;
        product: { id: number; name: string; unit: string };
    }): Promise<number>;
};

describe('report recipe UOM fail-closed behavior', () => {
    afterEach(() => { jest.restoreAllMocks(); });

    it.each([
        ['extended', ReportExtendedService],
        ['standard', ReportService]
    ])('does not publish a %s report with a silent 1:1 fallback', async (_name, service) => {
        jest.spyOn(UnitConversionService, 'convert').mockRejectedValue(new Error('unidad incompatible'));
        const guarded = service as unknown as ReportWithConversionGuard;

        await expect(guarded.recipeQuantityInBase(9, {
            quantity: 2,
            unit: 'kg',
            product: { id: 4, name: 'Queso', unit: 'g' }
        })).rejects.toThrow('Queso');
        await expect(guarded.recipeQuantityInBase(9, {
            quantity: 2,
            unit: 'kg',
            product: { id: 4, name: 'Queso', unit: 'g' }
        })).rejects.toThrow('kg');
    });
});
