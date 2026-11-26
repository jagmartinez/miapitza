import type { ReactNode } from 'react';
import './ui-kit.css';

interface Props {
    title: string;
    onBack?: () => void;
    right?: ReactNode;
}

export function ScreenHeader({ title, onBack, right }: Props) {
    return (
        <header className="ui-header">
            {onBack ? (
                <button type="button" className="ui-header-back" onClick={onBack} aria-label="Volver">
                    ‹
                </button>
            ) : (
                <span className="ui-header-back" aria-hidden="true" />
            )}
            <h1 className="ui-header-title">{title}</h1>
            <span className="ui-header-right">{right}</span>
        </header>
    );
}
