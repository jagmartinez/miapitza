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
        const acknowledgeSchedule = vi.fn(() => new Promise<unknown>((r) => (release = () => r({ acknowledgedAt: '2026-11-18T15:00:00Z' }))));
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

    it('Confirmado shows the server timestamp, not the device clock', async () => {
        const acknowledgeSchedule = vi.fn(async () => ({ acknowledgedAt: '2026-11-18T15:00:00Z' }));
        mount({ mySchedule: vi.fn(async (w: string) => (w === thisWeek ? sched(1, thisWeek) : null)), acknowledgeSchedule });
        fireEvent.click(await screen.findByRole('button', { name: 'Confirmar horario' }));
        expect(await screen.findByText(`Confirmado ${new Date('2026-11-18T15:00:00Z').toLocaleDateString('es-NI')}`)).toBeInTheDocument();
    });

    it('uses the server date and timezone, not the device clock, for the week', async () => {
        // 02:00Z on Mon 2026-11-23 is still Sunday 22 in Managua: week of Mon 2026-11-16.
        const mySchedule = vi.fn(async () => null);
        const attendanceToday = vi.fn(async () => ({ serverTime: '2026-11-23T02:00:00Z', timezone: 'America/Managua' }));
        mount({ mySchedule, attendanceToday });
        await screen.findAllByText('Aún no hay horario publicado para esta semana');
        expect(mySchedule).toHaveBeenCalledWith('2026-11-16');
        expect(mySchedule).toHaveBeenCalledWith('2026-11-23');
    });

    it('re-reads the week when acknowledge does not echo a timestamp', async () => {
        let acked = false;
        const mySchedule = vi.fn(async (w: string) => (w === thisWeek ? sched(1, thisWeek, { acknowledgedAt: acked ? '2026-11-18T15:00:00Z' : null }) : null));
        const acknowledgeSchedule = vi.fn(async () => {
            acked = true;
            return {};
        });
        mount({ mySchedule, acknowledgeSchedule });
        fireEvent.click(await screen.findByRole('button', { name: 'Confirmar horario' }));
        expect(await screen.findByText(/^Confirmado /)).toBeInTheDocument();
    });

    it('a failed acknowledge keeps the button enabled', async () => {
        const acknowledgeSchedule = vi.fn().mockRejectedValue(new Error('x'));
        mount({ mySchedule: vi.fn(async (w: string) => (w === thisWeek ? sched(1, thisWeek) : null)), acknowledgeSchedule });
        fireEvent.click(await screen.findByRole('button', { name: 'Confirmar horario' }));
        await waitFor(() => expect(acknowledgeSchedule).toHaveBeenCalled());
        await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar horario' })).toBeEnabled());
    });
});
