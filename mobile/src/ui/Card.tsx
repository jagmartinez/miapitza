import type { ReactNode } from 'react';
import './ui-kit.css';

interface Props {
    title?: ReactNode;
    /** Small status text on the right of the title. */
    badge?: ReactNode;
    badgeTone?: 'pending' | 'rejected' | 'neutral';
    /** Makes the whole card a button. */
    onClick?: () => void;
    disabled?: boolean;
    children?: ReactNode;
    className?: string;
}

export function Card({ title, badge, badgeTone = 'neutral', onClick, disabled, children, className }: Props) {
    const inner = (
        <>
            {(title || badge) && (
                <div className="ui-card-head">
                    <span className="ui-card-title">{title}</span>
                    {badge && <span className={`ui-badge ui-badge-${badgeTone}`}>{badge}</span>}
                </div>
            )}
            {children && <div className="ui-card-body">{children}</div>}
        </>
    );
    const cls = `ui-card ${onClick ? 'ui-card-tap' : ''} ${className ?? ''}`.trim();
    return onClick ? (
        <button type="button" className={cls} onClick={onClick} disabled={disabled}>
            {inner}
        </button>
    ) : (
        <section className={cls}>{inner}</section>
    );
}
