import { useCallback, useEffect, useState } from 'react';
import { Bell, Check, CheckCheck, X } from 'lucide-react';
import { kitchenNotificationsAPI } from '../services/api';
import { initializeWebSocket, subscribeWebSocket, WS_EVENTS } from '../utils/websocket';
import type { KitchenNotification } from '../types';
import { useAppToast } from '../context/ToastContext';
import './KitchenNotificationBell.css';

export default function KitchenNotificationBell() {
    const [notifications, setNotifications] = useState<KitchenNotification[]>([]);
    const [open, setOpen] = useState(false);
    const [attendingIds, setAttendingIds] = useState<Set<number>>(new Set());
    const { error: showError } = useAppToast();

    const load = useCallback(async () => {
        try {
            const response = await kitchenNotificationsAPI.getAll();
            setNotifications(response.data.data);
        } catch (error) {
            console.error('Error loading kitchen notifications:', error);
        }
    }, []);

    useEffect(() => {
        void load();
        initializeWebSocket();
        return subscribeWebSocket((message) => {
            if (message?.type === WS_EVENTS.KITCHEN_NOTIFICATION || message?.type === WS_EVENTS.CONNECTED) {
                void load();
            }
        });
    }, [load]);

    const unread = notifications.filter((notification) => notification.status === 'UNREAD').length;

    const openPanel = async () => {
        setOpen(true);
        const pending = notifications.filter((notification) => notification.status === 'UNREAD');
        if (pending.length === 0) return;
        try {
            await Promise.all(pending.map((notification) => kitchenNotificationsAPI.markSeen(notification.id)));
            await load();
        } catch {
            showError('No se pudieron marcar los avisos como vistos.');
        }
    };

    const attend = async (id: number) => {
        setAttendingIds((current) => new Set(current).add(id));
        try {
            await kitchenNotificationsAPI.markAttended(id);
            setNotifications((current) => current.filter((notification) => notification.id !== id));
        } catch {
            showError('No se pudo marcar el aviso como atendido.');
        } finally {
            setAttendingIds((current) => {
                const next = new Set(current);
                next.delete(id);
                return next;
            });
        }
    };

    return (
        <div className="kitchen-notification-shell">
            <button
                type="button"
                className="kitchen-notification-trigger"
                aria-label={`Avisos de cocina${unread ? `, ${unread} sin ver` : ''}`}
                aria-expanded={open}
                onClick={() => open ? setOpen(false) : void openPanel()}
            >
                <Bell size={22} />
                {unread > 0 && <span className="kitchen-notification-count">{unread > 99 ? '99+' : unread}</span>}
            </button>

            {open && (
                <section className="kitchen-notification-panel" aria-label="Avisos persistentes de cocina">
                    <header>
                        <div>
                            <strong>Avisos de cocina</strong>
                            <small>{notifications.length} pendientes de atender</small>
                        </div>
                        <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar avisos"><X size={20} /></button>
                    </header>
                    <div className="kitchen-notification-list">
                        {notifications.length === 0 ? (
                            <div className="kitchen-notification-empty"><CheckCheck size={26} /> Todo atendido</div>
                        ) : notifications.map((notification) => (
                            <article key={notification.id} className={`kitchen-notification-item status-${notification.status.toLowerCase()}`}>
                                <div>
                                    <strong>{notification.tableNumber ? `Mesa ${notification.tableNumber}` : `Orden #${notification.orderId}`}</strong>
                                    <p>{notification.message}</p>
                                    <time>{new Date(notification.createdAt).toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit' })}</time>
                                </div>
                                <button type="button" disabled={attendingIds.has(notification.id)} onClick={() => void attend(notification.id)}>
                                    <Check size={18} /> {attendingIds.has(notification.id) ? 'Guardando…' : 'Atendido'}
                                </button>
                            </article>
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}
