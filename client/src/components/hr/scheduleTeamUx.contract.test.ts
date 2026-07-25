import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relative: string) => fs.readFileSync(path.resolve(__dirname, relative), 'utf8');
const schedulePage = read('../../pages/hr/Schedules.tsx');
const templatePage = read('../../pages/hr/ShiftTemplates.tsx');
const teamPage = read('../../pages/hr/MySchedule.tsx');
const weekView = read('./ScheduleWeekView.tsx');
const shiftForm = read('./ScheduleShiftForm.tsx');
const templateCatalog = read('./ShiftTemplateCatalog.tsx');
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

    it('keeps contextual cell creation on a compatible configured shift without redundant fields', () => {
        expect(shiftForm).toContain('const contextualCreate = !shift && Boolean(initialAssignment)');
        expect(shiftForm).toContain("contextualCreate ? 'schedule' : 'assignment'");
        expect(shiftForm).toContain('!contextualCreate && <div className="modal-tabs"');
        expect(shiftForm).toContain('label="Jornada configurada"');
        expect(shiftForm).toContain('template.branchId === null || template.branchId === initialAssignment?.branchId');
        expect(shiftForm).toContain('!template.jobPositionId || template.jobPositionId === initialAssignment?.jobPositionId');
        expect(shiftForm).toContain('No hay jornadas activas compatibles');
        expect(shiftForm).toContain('Configurar jornadas');
        expect(shiftForm).toContain('templateLoadError');
        expect(shiftForm).toContain('Reintentar jornadas');
        expect(shiftForm).toContain('template.branchId === null ? current.branchId : String(template.branchId)');
        expect(shiftForm).toContain("role={contextualCreate ? undefined : 'tabpanel'}");
        expect(shiftForm).toContain("contextualCreate ? 'Asignar jornada' : 'Agregar turno'");
        expect(schedulePage).toContain('setNewShiftDefaults(defaults ?? null)');
        expect(schedulePage).toContain("navigate('/rh/horarios/jornadas')");
        expect(schedulePage).toContain('disabled={mutationBusy || anyEditorOpen}');
        expect(schedulePage).not.toContain('> Nuevo turno</Button>');
        expect(schedulePage).not.toContain('<ShiftTemplateCatalog');
        expect(schedulePage).not.toContain('createShiftTemplate');
        expect(schedulePage).not.toContain('updateShiftTemplate');
        expect(schedulePage).not.toContain('setShiftTemplateActive');
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

    it('uses immutable template snapshots with a deterministic fallback and textual equivalent', () => {
        expect(weekView).toContain('templateColorSnapshot ?? item.shiftTemplate?.color');
        expect(weekView).toContain('templateNameSnapshot ?? item.shiftTemplate?.name');
        expect(weekView).toContain('fallbackShiftColor');
        expect(weekView).toContain("'--shift-accent': shiftColor(item)");
        expect(weekView).toContain('Leyenda de colores por franja de turno');
        expect(weekView).toContain('turno de');
        expect(styles).not.toContain('.shift-color-0');
        expect(styles).toContain('.hr-shift-color-legend');
    });

    it('exposes a revision-aware reusable shift catalog without destructive deletion', () => {
        expect(templatePage).toContain('<ShiftTemplateCatalog');
        expect(templatePage).toContain('expectedRevision: editingTemplate.revision');
        expect(templatePage).toContain('status === 409');
        expect(templatePage).not.toContain('availableCode');
        expect(templatePage).not.toContain('codeBase');
        expect(templatePage).not.toContain('branchId: editing?.branchId');
        expect(templatePage).not.toContain('paidBreak: editing?.paidBreak');
        expect(templatePage).toContain('Jornadas configuradas');
        expect(templatePage).toContain('Nueva jornada');
        expect(templateCatalog).toContain('Desactivar');
        expect(templateCatalog).toContain('Reactivar');
        expect(templateCatalog).not.toContain('Eliminar');
        expect(templateCatalog).toContain('<legend>Color</legend>');
        expect(templateCatalog).not.toContain('label="Sucursal"');
        expect(templateCatalog).not.toContain('Puesto (opcional)');
        expect(templateCatalog).not.toContain('Descanso pagado');
        expect(templateCatalog).not.toContain('hr-template-code');
    });
});
