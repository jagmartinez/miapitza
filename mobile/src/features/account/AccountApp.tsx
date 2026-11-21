import { useEffect, useMemo } from 'react';
import type { Services } from '../../core/services';
import type { Session } from '../../core/session';
import { ScreenHeader } from '../../ui/ScreenHeader';
import { ToastProvider } from '../../ui/Toast';
import { AccountHome } from './AccountHome';
import { AccountNavProvider, useAccountNav, type AccountSection } from './AccountNav';
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

function Screens({ session, hr, onLogout }: { session: Session; hr: HrApi; onLogout: () => void }) {
    const { section } = useAccountNav();
    if (section === 'home') return <AccountHome session={session} hr={hr} onLogout={onLogout} />;
    return <SectionPlaceholder section={section} />;
}

/** The account screens: HR data layer, toasts and in-shell navigation. Lazy-loaded by AccountShell. */
export default function AccountApp({ session, services, onLogout }: { session: Session; services: Services; onLogout: () => void }) {
    const hr = useMemo(() => createHrApi(services.http), [services.http]);
    useEffect(() => () => hr.dispose(), [hr]);
    return (
        <ToastProvider>
            <AccountNavProvider>
                <Screens session={session} hr={hr} onLogout={onLogout} />
            </AccountNavProvider>
        </ToastProvider>
    );
}
