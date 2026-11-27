import type { ReactNode } from 'react';
import { Button } from '@/ui';
import './EmptyState.css';

interface EmptyStateProps {
    icon?: ReactNode;
    title: string;
    description?: string;
    action?: {
        label: string;
        onClick: () => void;
    };
}

/** Estado vacío con icono libre (nodo). Para listas del kit usa `EmptyState` de `@/ui`. */
export default function EmptyState({ icon, title, description, action }: EmptyStateProps) {
    return (
        <div className="empty-state" role="status">
            {icon ? <div className="empty-state-icon">{icon}</div> : null}
            <p className="empty-state-title">{title}</p>
            {description && <p className="empty-state-description">{description}</p>}
            {action && (
                <Button variant="primary" onClick={action.onClick}>
                    {action.label}
                </Button>
            )}
        </div>
    );
}
