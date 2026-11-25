// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { clearGoalsCache, useGoals } from './useGoals';

const fetchResolved = vi.hoisted(() => vi.fn());
vi.mock('../services/settingsScope', () => ({ fetchResolved }));

const entry = (key: string, value: string) => ({ key, value, source: 'company', companyValue: value });

describe('useGoals', () => {
    beforeEach(() => { clearGoalsCache(); fetchResolved.mockReset(); });

    it('convierte el texto a número', async () => {
        fetchResolved.mockResolvedValue({
            version: 'v1',
            values: {
                'goal.avgTicket': entry('goal.avgTicket', '550.50'),
                'goal.foodCostPct': entry('goal.foodCostPct', '32'),
                'goal.monthlySales': entry('goal.monthlySales', '6400000.00'),
            },
        });
        const { result } = renderHook(() => useGoals(3));
        await waitFor(() => expect(result.current.avgTicket).toBe(550.5));
        expect(result.current.foodCostPct).toBe(32);
        expect(result.current.monthlySales).toBe(6400000);
        expect(result.current.laborCostMaxPct).toBe(0);
        expect(fetchResolved).toHaveBeenCalledWith(3);
    });

    it('reutiliza la respuesta durante 60 s', async () => {
        fetchResolved.mockResolvedValue({ version: 'v1', values: { 'goal.avgTicket': entry('goal.avgTicket', '600') } });
        const a = renderHook(() => useGoals(null));
        await waitFor(() => expect(a.result.current.avgTicket).toBe(600));
        const b = renderHook(() => useGoals(null));
        await waitFor(() => expect(b.result.current.avgTicket).toBe(600));
        expect(fetchResolved).toHaveBeenCalledTimes(1);
    });
});
