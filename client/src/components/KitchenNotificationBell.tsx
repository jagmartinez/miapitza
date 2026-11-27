import { useCallback, useEffect, useState } from 'react';
import { getApiErrorMessage } from '../utils/apiError';
import { notifyError } from '../services/notify';
import { Bell, Check, CheckCheck, X } from 'lucide-react';
import { kitchenNotificationsAPI } from '../services/api';
import { initializeWebSocket, subscribeWebSocket, WS_EVENTS } from '../utils/websocket';
import type { KitchenNotification } from '../types';
import { useAppToast } from '../context/ToastContext';
import { initializeSound, playNotificationSound } from '../utils/sound';
import { Button, EmptyState, IconButton } from '@/ui';
import './KitchenNotificationBell.css';

export default function KitchenNotificationBell({ inline = false }: { inline?: boolean }) {
    const [notifications, setNotifications] = useState<KitchenNotification[]>([]);
    const [open, setOpen] = useState(false);
    const [attendingIds, setAttendingIds] = useState<Set<number>>(new Set());
    const { error: showError } = useAppToast();

    const load = useCallback(async () => {
        try {
            const response = await kitchenNotificationsAPI.getAll();
            setNotifications(response.data.data);
        } catch (error) {
            notifyError(error, 'No se pudieron cargar los avisos de cocina', { type: 'warning' });
        }
    }, []);

    useEffect(() => {
        initializeSound();
        void load();
        initializeWebSocket();
        return subscribeWebSocket((message) => {
            if (message?.type === WS_EVENTS.KITCHEN_NOTIFICATION) {
                playNotificationSound();
                if ('vibrate' in navigator) navigator.vibrate([180, 80, 180]);
                void load();
            } else if (message?.type === WS_EVENTS.CONNECTED) {
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
        } catch (err) {
            showError(getApiErrorMessage(err, 'No se pudieron marcar los avisos como vistos.'));
        }
    };

    const attend = async (id: number) => {
        setAttendingIds((current) => new Set(current).add(id));
        try {
            await kitchenNotificationsAPI.markAttended(id);
            setNotifications((current) => current.filter((notification) => notification.id !== id));
        } catch (err) {
            showError(getApiErrorMessage(err, 'No se pudo marcar el aviso como atendido.'));
        } finally {
            setAttendingIds((current) => {
                const next = new Set(current);
                next.delete(id);
                return next;
            });
        }
    };

    return (
        <div className={`kitchen-notification-shell ${inline ? 'is-inline' : ''}`}>
            <span className="kitchen-notification-trigger">
                <IconButton
                    icon={Bell}
                    label={`Avisos de cocina${unread ? `, ${unread} sin ver` : ''}`}
                    tooltip="Avisos de cocina"
                    aria-expanded={open}
                    onClick={() => open ? setOpen(false) : void openPanel()}
                />
                {unread > 0 && <span className="kitchen-notification-count" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
            </span>

            {open && (
                <section className="kitchen-notification-panel" aria-label="Avisos persistentes de cocina">
                    <header>
                        <div>
                            <strong>Avisos de cocina</strong>
                            <small>{notifications.length} pendientes de atender</small>
                        </div>
                        <IconButton icon={X} label="Cerrar avisos" tooltip="Cerrar" onClick={() => setOpen(false)} />
                    </header>
                    <div className="kitchen-notification-list">
                        {notifications.length === 0 ? (
                            <EmptyState icon={CheckCheck} title="Todo atendido" />
                        ) : notifications.map((notification) => (
                            <article key={notification.id} className={`kitchen-notification-item status-${notification.status.toLowerCase()}`}>
                                <div>
                                    <strong>{notification.tableNumber ? `Mesa ${notification.tableNumber}` : `Orden #${notification.orderId}`}</strong>
                                    <p>{notification.message}</p>
                                    <time>{new Date(notification.createdAt).toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit' })}</time>
                                </div>
                                <Button
                                    size="sm"
                                    icon={Check}
                                    loading={attendingIds.has(notification.id)}
                                    onClick={() => void attend(notification.id)}
                                >
                                    {attendingIds.has(notification.id) ? 'Guardando…' : 'Atendido'}
                                </Button>
                            </article>
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}
