import type { ReactNode } from 'react';
import { FullScreenModal } from '@/ui';

interface SidebarProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
    /** Ignorado: el panel ahora es a pantalla completa. */
    width?: 'normal' | 'medium' | 'large' | 'wide' | 'full';
    /** Ignorado: el modal a pantalla completa no tiene fondo clicable. */
    closeOnBackdrop?: boolean;
    /** Ignorado: Esc siempre pide confirmación si hay cambios y cierra si no. */
    closeOnEscape?: boolean;
    description?: ReactNode;
    footer?: ReactNode;
}

/** Adaptador heredado sobre `FullScreenModal`. */
export default function Sidebar({ isOpen, onClose, title, children, description, footer }: SidebarProps) {
    return (
        <FullScreenModal isOpen={isOpen} onClose={onClose} title={title} footer={footer}>
            {description ? <div className="modal-description">{description}</div> : null}
            {children}
        </FullScreenModal>
    );
}
