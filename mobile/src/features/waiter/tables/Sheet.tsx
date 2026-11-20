import type { ReactNode } from 'react';

/** Bottom sheet over the plan: flat surface, tap outside to close. */
export function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
    return (
        <div className="sheet-backdrop" onClick={onClose}>
            <div className="sheet" role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
                {children}
            </div>
        </div>
    );
}
