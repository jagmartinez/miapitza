import { ChefHat, Calendar, Clock, MapPin } from 'lucide-react';
import './EmptyState.css';

interface EmptyStateProps {
    icon?: React.ReactNode;
    title: string;
    description?: string;
    action?: {
        label: string;
        onClick: () => void;
    };
}

export default function EmptyState({ icon, title, description, action }: EmptyStateProps) {
    const defaultIcon = <ChefHat size={64} />;

    return (
        <div className="empty-state">
            <div className="empty-state-icon">
                {icon || defaultIcon}
            </div>
            <h3 className="empty-state-title">{title}</h3>
            {description && <p className="empty-state-description">{description}</p>}
            {action && (
                <button className="empty-state-action" onClick={action.onClick}>
                    {action.label}
                </button>
            )}
        </div>
    );
}

export function NoOrdersEmptyState() {
    return (
        <EmptyState
            icon={<ChefHat size={64} />}
            title="No hay ordenes"
            description="Las nuevas ordenes apareceran aqui automaticamente"
        />
    );
}

export function NoReservationsEmptyState() {
    return (
        <EmptyState
            icon={<Calendar size={64} />}
            title="No hay reservaciones"
            description="Crea una nueva reservacion para comenzar"
        />
    );
}

export function NoResultsEmptyState() {
    return (
        <EmptyState
            icon={<Clock size={64} />}
            title="No se encontraron resultados"
            description="Intenta ajustar los filtros de busqueda"
        />
    );
}

export function NoLocationEmptyState() {
    return (
        <EmptyState
            icon={<MapPin size={64} />}
            title="No hay ubicaciones"
            description="Agrega una nueva ubicacion para organizar tus mesas"
        />
    );
}
