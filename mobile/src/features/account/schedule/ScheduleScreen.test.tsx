import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { addDaysDateOnly, weekDates, weekStartFor } from '@web/components/hr/scheduleDates';
import { AccountNavProvider } from '../AccountNav';
import { ToastProvider } from '../../../ui/Toast';
import type { HrApi } from '../hrApi';
import { ScheduleScreen } from './ScheduleScreen';

const thisWeek = weekStartFor();
const nextWeek = addDaysDateOnly(thisWeek, 7);
const shift = (id: number, date: string, startTime: string, endTime: string) => ({ id, userId: 7, branchId: 1, date, startTime, endTime, branch: { id: 1, name: 'Matriz' } });
const sched = (id: number, weekStart: string, over = {}) => ({
    id,
    weekStart,
    status: 'PUBLISHED',
    version: 1,
    revision: 1,
    shifts: [shift(id * 10, weekDates(weekStart)[0], '08:00:00', '16:00:00'), shift(id * 10 + 1, weekDates(weekStart)[1], '22:00:00', '06:00:00')],
    acknowledgedAt: null,
    ...over,
});

function mount(hr: Record<string, unknown>) {
    return render(
        <ToastProvider>
            <AccountNavProvider>
                <ScheduleScreen hr={hr as unknown as HrApi} />
            </AccountNavProvider>
        </ToastProvider>,
    );
}

describe('ScheduleScreen', () => {
    it('schedule shows two weeks and confirm when unacknowledged', async () => {
        const mySchedule = vi.fn(async (w: string) => (w === thisWeek ? sched(1, thisWeek) : sched(2, nextWeek, { acknowledgedAt: '2026-11-19T10:00:00Z' })));
        mount({ mySchedule });
        expect(await screen.findByText('Esta semana')).toBeInTheDocument();
        expect(screen.getByText('Próxima semana')).toBeInTheDocument();
        expect(mySchedule).toHaveBeenCalledWith(thisWeek);
        expect(mySchedule).toHaveBeenCalledWith(nextWeek);
        expect(screen.getAllByText('08:00 – 16:00')).toHaveLength(2);
        // the night shift crosses midnight
        expect(screen.getAllByText('+1')).toHaveLength(2);
        expect(screen.getAllByRole('button', { name: 'Confirmar horario' })).toHaveLength(1);
        expect(screen.getByText(/^Confirmado /)).toBeInTheDocument();
    });

    it('confirm calls acknowledge once and shows Confirmado', async () => {
        let release!: () => void;
        const acknowledgeSchedule = vi.fn(() => new Promise<unknown>((r) => (release = () => r({}))));
        const mySchedule = vi.fn(async (w: string) => (w === thisWeek ? sched(1, thisWeek) : null));
        mount({ mySchedule, acknowledgeSchedule });
        const btn = await screen.findByRole('button', { name: 'Confirmar horario' });
        fireEvent.click(btn);
        fireEvent.click(btn);
        expect(acknowledgeSchedule).toHaveBeenCalledTimes(1);
        expect(acknowledgeSchedule).toHaveBeenCalledWith(1);
        release();
        expect(await screen.findByText(/^Confirmado /)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Confirmar horario' })).toBeNull();
    });

    it('no schedule message', async () => {
        mount({ mySchedule: vi.fn(async () => null) });
        expect(await screen.findAllByText('Aún no hay horario publicado para esta semana')).toHaveLength(2);
    });

    it('a failed acknowledge keeps the button enabled', async () => {
        const acknowledgeSchedule = vi.fn().mockRejectedValue(new Error('x'));
        mount({ mySchedule: vi.fn(async (w: string) => (w === thisWeek ? sched(1, thisWeek) : null)), acknowledgeSchedule });
        fireEvent.click(await screen.findByRole('button', { name: 'Confirmar horario' }));
        await waitFor(() => expect(acknowledgeSchedule).toHaveBeenCalled());
        await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar horario' })).toBeEnabled());
    });
});
