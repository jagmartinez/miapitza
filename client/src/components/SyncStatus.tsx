import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, RefreshCw, Trash2, X, ChevronDown, ChevronUp } from 'lucide-react';
import { offlineManager } from '../services/offlineManager';
import type { SyncItem } from '../services/db';

export default function SyncStatus() {
    const [failedItems, setFailedItems] = useState<SyncItem[]>([]);
    const [pendingCount, setPendingCount] = useState(0);
    const [expanded, setExpanded] = useState(false);
    const [retrying, setRetrying] = useState(false);

    const refresh = useCallback(async () => {
        const failed = await offlineManager.getFailedItems();
        const pending = await offlineManager.getPendingCount();
        setFailedItems(failed);
        setPendingCount(pending);
    }, []);

    useEffect(() => {
        refresh();
        const interval = setInterval(refresh, 10000);
        return () => clearInterval(interval);
    }, [refresh]);

    const handleRetry = async () => {
        setRetrying(true);
        try {
            await offlineManager.retryFailed();
            await refresh();
        } finally {
            setRetrying(false);
        }
    };

    const handleClear = async () => {
        await offlineManager.clearFailed();
        await refresh();
        setExpanded(false);
    };

    if (failedItems.length === 0 && pendingCount === 0) return null;

    return (
        <div className="sync-status-panel">
            <button
                className="sync-status-header"
                onClick={() => setExpanded(!expanded)}
            >
                <div className="sync-status-summary">
                    {failedItems.length > 0 && (
                        <span className="sync-badge sync-badge-error">
                            <AlertTriangle size={14} />
                            {failedItems.length} fallido{failedItems.length !== 1 ? 's' : ''}
                        </span>
                    )}
                    {pendingCount > 0 && (
                        <span className="sync-badge sync-badge-pending">
                            <RefreshCw size={14} className={retrying ? 'animate-spin' : ''} />
                            {pendingCount} pendiente{pendingCount !== 1 ? 's' : ''}
                        </span>
                    )}
                </div>
                {failedItems.length > 0 && (
                    expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />
                )}
            </button>

            {expanded && failedItems.length > 0 && (
                <div className="sync-status-details">
                    <div className="sync-failed-list">
                        {failedItems.slice(0, 10).map((item) => (
                            <div key={item.id} className="sync-failed-item">
                                <div className="sync-failed-info">
                                    <span className="sync-failed-type">{item.operationType}</span>
                                    <span className="sync-failed-method">{item.method} {item.url.replace('/api/', '')}</span>
                                    {item.lastError && (
                                        <span className="sync-failed-error">{item.lastError}</span>
                                    )}
                                </div>
                                <span className="sync-failed-retries">×{item.retryCount}</span>
                            </div>
                        ))}
                        {failedItems.length > 10 && (
                            <div className="sync-failed-more">
                                +{failedItems.length - 10} más...
                            </div>
                        )}
                    </div>
                    <div className="sync-status-actions">
                        <button
                            className="sync-action-btn sync-retry-btn"
                            onClick={handleRetry}
                            disabled={retrying}
                        >
                            <RefreshCw size={14} className={retrying ? 'animate-spin' : ''} />
                            Reintentar todo
                        </button>
                        <button
                            className="sync-action-btn sync-clear-btn"
                            onClick={handleClear}
                        >
                            <Trash2 size={14} />
                            Descartar
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
