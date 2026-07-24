import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relative: string) => fs.readFileSync(path.resolve(__dirname, relative), 'utf8');
const schedulePage = read('../../pages/hr/Schedules.tsx');
const teamPage = read('../../pages/hr/MySchedule.tsx');
const weekView = read('./ScheduleWeekView.tsx');
const shiftForm = read('./ScheduleShiftForm.tsx');
const styles = read('../../pages/hr/schedule.css');

describe('team schedule planning UX', () => {
    it('uses schedule-scoped minimal lookups and keeps read separate from manage/publish', () => {
        expect(schedulePage).toContain('scheduleClient.getScheduleLookups(weekStart)');
        expect(schedulePage).not.toContain('hrClient.getOrganization');
        expect(schedulePage).toContain("hasPermission(user, 'hr.schedule.manage'");
        expect(schedulePage).toContain("hasPermission(user, 'hr.schedule.publish'");
        expect(schedulePage).toContain('readOnly={mutationBusy || fromCache || !canManageSchedule}');
    });

    it('renders active workers without shifts and opens an empty worker-day cell with defaults', () => {
        expect(schedulePage).toContain('workers={visibleWorkers}');
        expect(schedulePage).toContain('onCreate={openCreateForCell}');
        expect(schedulePage).toContain('userId: worker.id');
        expect(schedulePage).toContain('date,');
        expect(weekView).toContain('...workersById.keys()');
        expect(weekView).toContain('hr-schedule-empty-cell-button');
        expect(weekView).toContain('Agregar turno para');
        expect(shiftForm).toContain('initialAssignment');
        expect(shiftForm).toContain('initialAssignment?.date ?? weekStart');
    });

    it('shows only the published team endpoint in self-service', () => {
        expect(teamPage).toContain('scheduleClient.getTeamSchedule(weekStart)');
        expect(teamPage).not.toContain('scheduleClient.getSchedules');
        expect(teamPage).toContain("schedule.status === 'PUBLISHED'");
        expect(teamPage).toContain('schedule.viewerHasShift');
    });

    it('uses deterministic colors with a textual and aria equivalent', () => {
        expect(weekView).toContain('shiftColorIndex');
        expect(weekView).toContain('Leyenda de colores por franja de turno');
        expect(weekView).toContain('turno de');
        expect(styles).toContain('.shift-color-0');
        expect(styles).toContain('.shift-color-5');
        expect(styles).toContain('.hr-shift-color-legend');
    });
});
