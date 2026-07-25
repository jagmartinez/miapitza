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

    it('keeps contextual cell creation on Jornada while global creation and editing retain the full form', () => {
        expect(shiftForm).toContain('const contextualCreate = !shift && Boolean(initialAssignment)');
        expect(shiftForm).toContain("contextualCreate ? 'schedule' : 'assignment'");
        expect(shiftForm).toContain('!contextualCreate && <div className="modal-tabs"');
        expect(shiftForm).toContain('!contextualCreate && <div className="modal-input-group"');
        expect(shiftForm).toContain("role={contextualCreate ? undefined : 'tabpanel'}");
        expect(shiftForm).toContain("shift ? 'Guardar turno' : 'Agregar turno'");
        expect(schedulePage).toContain('setNewShiftDefaults(defaults ?? null)');
        expect(schedulePage).toContain('setNewShiftDefaults(null)');
        expect(schedulePage).toContain('disabled={mutationBusy || editorOpen}');
    });

    it('fails before opening a locked contextual editor when branch or position is missing', () => {
        expect(schedulePage).toContain('if (!defaultBranchId || !defaultJobPositionId)');
        expect(schedulePage).toContain('No se puede agregar un turno para');
        expect(schedulePage).toContain('falta ${missing} en su expediente laboral');
        expect(schedulePage.indexOf('if (!defaultBranchId || !defaultJobPositionId)'))
            .toBeLessThan(schedulePage.indexOf('openCreate({', schedulePage.indexOf('const openCreateForCell')));
    });

    it('removes the generic info alert without hiding real failures or offline warnings', () => {
        expect(schedulePage).not.toContain('hr-schedule-alert info');
        expect(shiftForm).not.toContain('hr-schedule-alert info');
        expect(teamPage).not.toContain('hr-schedule-alert info');
        expect(styles).not.toContain('.hr-schedule-alert.info');
        expect(schedulePage).toContain('hr-schedule-alert danger');
        expect(schedulePage).toContain('hr-schedule-alert warning');
        expect(teamPage).toContain('hr-schedule-alert warning');
        expect(shiftForm).toContain('hr-schedule-form-conflicts');
        expect(shiftForm).toContain('hr-shift-overnight-note');
    });

    it('raises matrix typography by one pixel without changing global type tokens', () => {
        expect(styles).toContain('font-size: calc(var(--font-size-xs) + 1px)');
        expect(styles).toContain('font-size: calc(var(--font-size-sm) + 1px)');
        expect(styles).toContain('font-size: 13px');
        expect(styles).toContain('font-size: 11px');
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
