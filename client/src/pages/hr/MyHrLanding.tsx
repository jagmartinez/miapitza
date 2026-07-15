import { BadgeDollarSign, Briefcase, CalendarClock, Fingerprint, MapPin, UserRound, WalletCards } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import './hr.css';

export default function MyHrLanding() {
    const navigate = useNavigate();
    const actions = [
        { to: '/rh/mi-portal/horario', icon: CalendarClock, title: 'Mi horario', text: 'Consulta tus turnos publicados y confirma que los revisaste.' },
        { to: '/rh/marcaje', icon: MapPin, title: 'Marcar asistencia', text: 'Registra entrada, descansos y salida con las validaciones configuradas.' },
        { to: '/rh/biometria', icon: Fingerprint, title: 'Mi biometría', text: 'Administra tu consentimiento y perfil de reconocimiento facial.' },
        { to: '/rh/mi-portal/gestion', icon: Briefcase, title: 'Mi gestión RH', text: 'Solicita correcciones, horas extra, permisos y consulta vacaciones.' },
        { to: '/rh/mi-portal/nomina', icon: WalletCards, title: 'Mis recibos', text: 'Consulta recibos publicados de nómina y aguinaldo con su desglose.' },
        { to: '/rh/mi-portal/prestaciones', icon: BadgeDollarSign, title: 'Mis prestaciones', text: 'Gestiona viáticos, préstamos y deducciones con trazabilidad.' },
    ];

    return (
        <div className="page-wrapper hr-my-landing-page">
            <PageHeader
                title="Mi portal RH"
                subtitle="Autoservicio del colaborador"
                icon={UserRound}
            />
            <section className="hr-landing-panel">
                <div className="hr-panel-header">
                    <h2>Accesos de autoservicio</h2>
                </div>
                <div className="hr-self-action-grid">
                    {actions.map((action) => {
                        const Icon = action.icon;
                        return (
                            <button key={action.to} type="button" className="hr-self-action" onClick={() => navigate(action.to)}>
                                <Icon size={24} aria-hidden="true" />
                                <span><strong>{action.title}</strong><small>{action.text}</small></span>
                            </button>
                        );
                    })}
                </div>
            </section>
        </div>
    );
}
