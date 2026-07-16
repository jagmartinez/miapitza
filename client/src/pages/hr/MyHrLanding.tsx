import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BadgeDollarSign,
  Briefcase,
  CalendarClock,
  ChevronRight,
  Clock3,
  Fingerprint,
  MapPin,
  FileText,
  RefreshCw,
  UserRound,
  WalletCards,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import Button from '../../components/Button';
import LoadingSpinner from '../../components/LoadingSpinner';
import PageHeader from '../../components/PageHeader';
import MyHrNav from '../../components/hr/MyHrNav';
import { benefitsClient } from '../../components/hr/benefitsClient';
import { payrollClient } from '../../components/hr/payrollClient';
import { scheduleClient } from '../../components/hr/scheduleClient';
import { weekStartFor } from '../../components/hr/scheduleDates';
import { workforceClient } from '../../components/hr/workforceClient';
import { useAuth } from '../../hooks/useAuth';
import type { HrLoan, HrTravelRequest } from '../../types/hr-benefits';
import type { HrPayrollReceiptSummary } from '../../types/hr-payroll';
import type { HrScheduleShift } from '../../types/hr-schedule';
import type { HrMyWorkforce } from '../../types/hr-workforce';
import { formatHrMoney, formatHrNumber } from '../../utils/hrFormat';
import './hr.css';

interface PortalSummary {
  nextShift: HrScheduleShift | null;
  workforce: HrMyWorkforce | null;
  latestReceipt: HrPayrollReceiptSummary | null;
  travel: HrTravelRequest[];
  loans: HrLoan[];
  scheduleAvailable: boolean;
  payrollAvailable: boolean;
  benefitsComplete: boolean;
  unavailableSections: number;
}

const EMPTY_SUMMARY: PortalSummary = {
  nextShift: null,
  workforce: null,
  latestReceipt: null,
  travel: [],
  loans: [],
  scheduleAvailable: true,
  payrollAvailable: true,
  benefitsComplete: true,
  unavailableSections: 0,
};

const PENDING_WORKFLOW = new Set(['DRAFT', 'PENDING', 'REQUESTED', 'SUBMITTED']);
const ACTIVE_BENEFIT = new Set(['REQUESTED', 'SUBMITTED', 'APPROVED', 'ADVANCED', 'IN_SETTLEMENT', 'DISBURSED', 'ACTIVE']);

function dateOnlyToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function shortDate(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('es-NI', { weekday: 'short', day: 'numeric', month: 'short' }).format(date);
}

async function outcome<T>(promise: Promise<T>): Promise<{ data: T | null; failed: boolean }> {
  try {
    return { data: await promise, failed: false };
  } catch {
    return { data: null, failed: true };
  }
}

export default function MyHrLanding() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [summary, setSummary] = useState<PortalSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const today = dateOnlyToday();
    const [schedule, workforce, receipts, travel, loans] = await Promise.all([
      outcome(scheduleClient.getMySchedule(weekStartFor())),
      outcome(workforceClient.getMyWorkforce({ dateFrom: today, dateTo: today, limit: 20 })),
      outcome(payrollClient.getMyReceipts({ year: new Date().getFullYear(), limit: 20 })),
      outcome(benefitsClient.getMyTravelRequests({ limit: 50 })),
      outcome(benefitsClient.getMyLoans({ limit: 50 })),
    ]);

    const shifts = (schedule.data?.schedules ?? [])
      .filter((item) => item.status === 'PUBLISHED')
      .flatMap((item) => item.shifts)
      .filter((shift) => shift.date >= today)
      .sort((left, right) => `${left.date} ${left.startTime}`.localeCompare(`${right.date} ${right.startTime}`));

    setSummary({
      nextShift: shifts[0] ?? null,
      workforce: workforce.data,
      latestReceipt: receipts.data?.items[0] ?? null,
      travel: travel.data?.items ?? [],
      loans: loans.data?.items ?? [],
      scheduleAvailable: !schedule.failed,
      payrollAvailable: !receipts.failed,
      benefitsComplete: !travel.failed && !loans.failed,
      unavailableSections: [schedule, workforce, receipts, travel, loans].filter((item) => item.failed).length,
    });
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const pendingRequests = useMemo(() => {
    const workforce = summary.workforce;
    if (!workforce) return null;
    return [
      ...workforce.corrections,
      ...workforce.overtimeRequests,
      ...workforce.leaveRequests,
    ].filter((item) => PENDING_WORKFLOW.has(item.status)).length;
  }, [summary.workforce]);

  const vacation = summary.workforce?.vacationBalances[0] ?? null;
  const activeBenefits = [...summary.travel, ...summary.loans].filter((item) => ACTIVE_BENEFIT.has(item.status)).length;

  const actions = [
    { to: '/rh/mi-portal/horario', icon: CalendarClock, title: 'Horario y turnos', text: 'Consulta tu calendario semanal y confirma los horarios publicados.' },
    { to: '/rh/marcaje', icon: MapPin, title: 'Marcar asistencia', text: 'Registra entrada, descansos y salida según la política de tu sucursal.' },
    { to: '/rh/mi-portal/gestion', icon: Briefcase, title: 'Solicitudes y asistencia', text: 'Vacaciones, permisos, correcciones de marcaje y horas extra en un solo lugar.' },
    { to: '/rh/mi-portal/nomina', icon: FileText, title: 'Recibos de pago', text: 'Abre o descarga tus colillas publicadas con ingresos y deducciones.' },
    { to: '/rh/mi-portal/prestaciones', icon: BadgeDollarSign, title: 'Viáticos y préstamos', text: 'Solicita, revisa estados, cuotas, gastos y deducciones asignadas.' },
    { to: '/rh/biometria', icon: Fingerprint, title: 'Biometría', text: 'Consulta tu consentimiento y administra el perfil de marcaje facial.' },
  ];

  return (
    <div className="page-wrapper hr-my-landing-page">
      <PageHeader title="Mi portal RH" subtitle="Tu jornada, solicitudes y pagos en un solo lugar" icon={UserRound} />
      <MyHrNav />

      <section className="hr-my-welcome" aria-labelledby="my-hr-welcome-title">
        <div>
          <span>EXPEDIENTE PERSONAL</span>
          <h2 id="my-hr-welcome-title">Hola, {user?.name ?? 'colaborador'}</h2>
          <p>
            {user?.employee?.employeeCode || user?.employee?.employeeNumber
              ? `Código ${user.employee.employeeCode ?? user.employee.employeeNumber} · `
              : ''}
            {user?.branch?.name ?? 'Sucursal no asignada'}
          </p>
        </div>
        <Link to="/profile">Ver perfil de cuenta <ChevronRight size={17} aria-hidden="true" /></Link>
      </section>

      {loading ? (
        <LoadingSpinner text="Preparando tu resumen RH…" />
      ) : (
        <>
          {summary.unavailableSections > 0 && (
            <div className="hr-inline-alert warning hr-my-summary-warning" role="status">
              <AlertTriangle size={18} aria-hidden="true" />
              <span>
                {summary.unavailableSections === 5
                  ? 'No pudimos cargar el resumen. Tus secciones siguen disponibles desde los accesos de abajo.'
                  : 'Parte del resumen no está disponible. Puedes abrir cada sección para reintentarla.'}
              </span>
              <Button size="sm" variant="ghost" onClick={() => void load()}>
                <RefreshCw size={15} aria-hidden="true" /> Reintentar
              </Button>
            </div>
          )}

          <section className="hr-my-summary-grid" aria-label="Resumen personal de recursos humanos">
            <button type="button" onClick={() => navigate('/rh/mi-portal/horario')}>
              <CalendarClock size={20} aria-hidden="true" />
              <span>Próximo turno</span>
              <strong>{!summary.scheduleAvailable ? 'No disponible' : summary.nextShift ? `${shortDate(summary.nextShift.date)} · ${summary.nextShift.startTime}` : 'Sin turno publicado'}</strong>
              <small>{summary.nextShift?.branch?.name ?? 'Consulta tu calendario'}</small>
            </button>
            <button type="button" onClick={() => navigate('/rh/mi-portal/gestion')}>
              <Clock3 size={20} aria-hidden="true" />
              <span>Solicitudes abiertas</span>
              <strong>{pendingRequests ?? '—'}</strong>
              <small>{vacation ? `${formatHrNumber(vacation.available)} ${vacation.unit.toLowerCase()} disponibles` : 'Vacaciones, permisos y horas extra'}</small>
            </button>
            <button type="button" onClick={() => navigate('/rh/mi-portal/nomina')}>
              <FileText size={20} aria-hidden="true" />
              <span>Último recibo</span>
              <strong>{!summary.payrollAvailable ? 'No disponible' : summary.latestReceipt ? formatHrMoney(summary.latestReceipt.currency, summary.latestReceipt.netPay) : 'Sin recibos publicados'}</strong>
              <small>{summary.latestReceipt?.periodLabel ?? 'Consulta tus colillas de pago'}</small>
            </button>
            <button type="button" onClick={() => navigate('/rh/mi-portal/prestaciones')}>
              <WalletCards size={20} aria-hidden="true" />
              <span>Beneficios en curso</span>
              <strong>{summary.benefitsComplete ? activeBenefits : '—'}</strong>
              <small>Viáticos y préstamos activos o en revisión</small>
            </button>
          </section>
        </>
      )}

      <section className="hr-landing-panel">
        <div className="hr-panel-header">
          <div>
            <h2>¿Qué necesitas hacer?</h2>
            <p>Selecciona una opción para consultar información o iniciar una solicitud.</p>
          </div>
        </div>
        <div className="hr-self-action-grid">
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <button key={action.to} type="button" className="hr-self-action" onClick={() => navigate(action.to)}>
                <Icon size={24} aria-hidden="true" />
                <span><strong>{action.title}</strong><small>{action.text}</small></span>
                <ChevronRight size={18} className="hr-self-action-chevron" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
