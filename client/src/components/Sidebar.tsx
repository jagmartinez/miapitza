import { ReactNode, useEffect } from 'react';
import { X } from 'lucide-react';
import './Sidebar.css';

interface SidebarProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
    width?: 'normal' | 'large' | 'wide' | 'full';
}

export default function Sidebar({ isOpen, onClose, title, children, width = 'normal' }: SidebarProps) {
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

    return (
        <>
            {isOpen && <div className="sidebar-overlay" onClick={onClose} />}

            <div className={`sidebar-panel sidebar-${width} ${isOpen ? 'sidebar-open' : ''}`}>
                <div className="sidebar-header">
                    <h2>{title}</h2>
                    <button className="sidebar-close" onClick={onClose}>
                        <X size={24} />
                    </button>
                </div>
                <div className="sidebar-body">
                    {children}
                </div>
            </div>
        </>
    );
}
