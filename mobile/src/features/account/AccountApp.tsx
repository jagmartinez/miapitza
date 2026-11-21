import { useEffect, useMemo } from 'react';
import type { Services } from '../../core/services';
import type { Session } from '../../core/session';
import { ScreenHeader } from '../../ui/ScreenHeader';
import { ToastProvider } from '../../ui/Toast';
import { AccountHome } from './AccountHome';
import { AccountNavProvider, useAccountNav, type AccountSection } from './AccountNav';
import { PunchScreen } from './attendance/PunchScreen';
import { PayrollScreen } from './payroll/PayrollScreen';
import { ProfileScreen } from './profile/ProfileScreen';
import { CorrectionForm } from './requests/CorrectionForm';
import { LeaveForm } from './requests/LeaveForm';
import { MyRequests } from './requests/MyRequests';
import { OvertimeForm } from './requests/OvertimeForm';
import { PendingForYou } from './requests/PendingForYou';
import { SwapForm } from './requests/SwapForm';
import { ScheduleScreen } from './schedule/ScheduleScreen';
import type { AccountApi } from './accountApi';
import { createHrApi, type HrApi } from './hrApi';

const TITLES: Record<Exclude<AccountSection, 'home'>, string> = {
    punch: 'Marcar',
    schedule: 'Mi horario',
    payroll: 'Mi nómina',
    info: 'Mi información',
    leave: 'Permiso / vacaciones',
    overtime: 'Horas extra',
    correction: 'Corregir marcaje',
    swap: 'Cambio de turno',
    loanRequest: 'Solicitar préstamo',
    loans: 'Préstamos',
    approvals: 'Por aprobar',
    requests: 'Mis solicitudes',
    pending: 'Pendiente para ti',
};

/** Shown for sections whose screen a later task provides. */
function SectionPlaceholder({ section }: { section: Exclude<AccountSection, 'home'> }) {
    const { back } = useAccountNav();
    return (
        <main>
            <ScreenHeader title={TITLES[section]} onBack={back} />
            <p className="muted" style={{ padding: 16 }}>Próximamente</p>
        </main>
    );
}

function Screens({ session, hr, accountApi, onLogout, onPasswordChanged }: { session: Session; hr: HrApi; accountApi: Pick<AccountApi, 'changePassword'>; onLogout: () => void; onPasswordChanged: () => void }) {
    const { section } = useAccountNav();
    if (section === 'home') return <AccountHome session={session} hr={hr} onLogout={onLogout} />;
    if (section === 'punch') return <PunchScreen hr={hr} />;
    if (section === 'schedule') return <ScheduleScreen hr={hr} />;
    if (section === 'payroll') return <PayrollScreen hr={hr} userId={session.user.id} />;
    if (section === 'info') return <ProfileScreen hr={hr} accountApi={accountApi} onPasswordChanged={onPasswordChanged} onLogout={onLogout} />;
    if (section === 'leave') return <LeaveForm hr={hr} />;
    if (section === 'overtime') return <OvertimeForm hr={hr} />;
    if (section === 'correction') return <CorrectionForm hr={hr} />;
    if (section === 'swap') return <SwapForm hr={hr} userId={session.user.id} />;
    if (section === 'requests') return <MyRequests hr={hr} userId={session.user.id} />;
    if (section === 'pending') return <PendingForYou hr={hr} userId={session.user.id} />;
    return <SectionPlaceholder section={section} />;
}

/** The account screens: HR data layer, toasts and in-shell navigation. Lazy-loaded by AccountShell. */
export default function AccountApp({ session, services, onLogout, onPasswordChanged }: { session: Session; services: Services; onLogout: () => void; onPasswordChanged?: () => void }) {
    const hr = useMemo(() => createHrApi(services.http), [services.http]);
    useEffect(() => () => hr.dispose(), [hr]);
    return (
        <ToastProvider>
            <AccountNavProvider>
                <Screens session={session} hr={hr} accountApi={services.accountApi} onLogout={onLogout} onPasswordChanged={onPasswordChanged ?? onLogout} />
            </AccountNavProvider>
        </ToastProvider>
    );
}
