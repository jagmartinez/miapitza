import { useEffect, useState, useRef } from 'react';
import { CheckCircle, Info, AlertTriangle, XCircle, X } from 'lucide-react';
import './Notification.css';

interface NotificationProps {
    message: string;
    type: 'success' | 'info' | 'warning' | 'error';
    duration?: number;
    onClose: () => void;
}

export default function Notification({ message, type, duration = 5000, onClose }: NotificationProps) {
    const [isVisible, setIsVisible] = useState(true);
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() => {
        const timer = setTimeout(() => {
            setIsVisible(false);
            setTimeout(() => onCloseRef.current(), 300);
        }, duration);

        return () => clearTimeout(timer);
    }, [duration]);

    const icons = {
        success: <CheckCircle className="icon-success" size={20} />,
        info: <Info className="icon-info" size={20} />,
        warning: <AlertTriangle className="icon-warning" size={20} />,
        error: <XCircle className="icon-error" size={20} />
    };

    return (
        <div className={`notification notification-${type} ${isVisible ? 'show' : 'hide'}`}>
            <span className="notification-icon">{icons[type]}</span>
            <span className="notification-message">{message}</span>
            <button className="notification-close" onClick={() => {
                setIsVisible(false);
                setTimeout(onClose, 300);
            }}>
                <X size={18} />
            </button>
        </div>
    );
}
