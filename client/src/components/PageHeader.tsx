import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

interface PageHeaderProps {
    title: string;
    subtitle?: string;
    icon?: LucideIcon;
    actions?: ReactNode;
    backButton?: ReactNode;
}

export default function PageHeader({ title, subtitle, icon: Icon, actions, backButton }: PageHeaderProps) {
    return (
        <header className="page-header-bar">
            <div className="header-title-section">
                {backButton}
                <h1>
                    {Icon && <Icon size={28} aria-hidden="true" />}
                    {title}
                </h1>
                {subtitle && <p className="header-subtitle">{subtitle}</p>}
            </div>
            {actions && <div className="page-header-actions">{actions}</div>}
        </header>
    );
}
