import { useState, useEffect } from 'react';
import { Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { offlineManager } from '../services/offlineManager';
import { db } from '../services/db';

export default function NetworkStatus() {
    const [isOnline, setIsOnline] = useState(offlineManager.getStatus());
    const [pendingCount, setPendingCount] = useState(0);

    useEffect(() => {
        const unsubscribe = offlineManager.onStatusChange((status) => {
            setIsOnline(status);
        });

        const checkPending = async () => {
            const count = await db.syncQueue.count();
            setPendingCount(count);
        };

        checkPending();
        const interval = setInterval(checkPending, 5000);

        return () => {
            unsubscribe();
            clearInterval(interval);
        };
    }, []);

    return (
        <div className={`network-status-box ${isOnline ? 'online' : 'offline'}`} title={isOnline ? 'En línea' : 'Sin conexión'}>
            {isOnline ? (
                <Wifi size={18} />
            ) : (
                <WifiOff size={18} />
            )}

            {pendingCount > 0 && (
                <div className="pending-badge" title={`${pendingCount} pendientes`}>
                    <RefreshCw size={12} className="animate-spin" />
                </div>
            )}
        </div>
    );
}
