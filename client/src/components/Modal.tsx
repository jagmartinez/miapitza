import { ReactNode, useEffect } from 'react';
import { X } from 'lucide-react';
import './Modal.css';

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
    size?: 'sm' | 'md' | 'lg';
    variant?: 'center' | 'sidebar';
}

export default function Modal({ isOpen, onClose, title, children, size = 'md', variant = 'center' }: ModalProps) {
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }
        return () => {
            document.body.style.overflow = 'unset';
        };
    }, [isOpen]);

    if (!isOpen) return null;

    const containerClass = variant === 'sidebar'
        ? `modal-sidebar modal-${size}`
        : `modal-container modal-${size}`;

    return (
        <div className={`modal-overlay ${variant === 'sidebar' ? 'modal-overlay-sidebar' : ''}`} onClick={onClose}>
            <div
                className={containerClass}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="modal-header">
                    <h2>{title}</h2>
                    <button className="modal-close" onClick={onClose}>
                        <X size={24} />
                    </button>
                </div>
                <div className="modal-body">
                    {children}
                </div>
            </div>
        </div>
    );
}
