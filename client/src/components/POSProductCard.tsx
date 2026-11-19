import React, { memo, useRef } from 'react';
import type { MenuItem } from '../types';
import type { StockBadge } from '../utils/stockAvailability';

interface POSProductCardProps {
    item: MenuItem;
    onClick: (item: MenuItem) => void;
    onContextMenu: (e: React.MouseEvent, item: MenuItem) => void;
    onQuantityEdit?: (item: MenuItem) => void;
    formatMoney: (amount: unknown) => string;
    /** Informational stock badge; never blocks selling. */
    stockBadge?: StockBadge | null;
}

const LONG_PRESS_MS = 500;

const POSProductCard = memo(({ item, onClick, onContextMenu, onQuantityEdit, formatMoney, stockBadge }: POSProductCardProps) => {
    const hasImage = item.images && item.images.length > 0;
    const backgroundImage = hasImage ? `url(${item.images?.[0]?.imageUrl})` : 'none';
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastTapRef = useRef(0);

    const handleTouchStart = () => {
        if (!onQuantityEdit) return;
        longPressTimer.current = setTimeout(() => {
            onQuantityEdit(item);
        }, LONG_PRESS_MS);
    };

    const handleTouchEnd = () => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    };

    const handleClick = (e: React.MouseEvent) => {
        if (!onQuantityEdit) {
            onClick(item);
            return;
        }
        const now = Date.now();
        if (now - lastTapRef.current < 350) {
            e.preventDefault();
            onQuantityEdit(item);
            lastTapRef.current = 0;
            return;
        }
        lastTapRef.current = now;
        onClick(item);
    };

    return (
        <div
            className={`product-card-new ${hasImage ? 'has-image' : ''} ${stockBadge ? 'has-stock-badge' : ''}`}
            onClick={handleClick}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
                // Keyboard activation adds one unit, like a single tap (no double-tap edit).
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onClick(item);
                }
            }}
            onContextMenu={(e) => onContextMenu(e, item)}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
        >
            {hasImage && (
                <div
                    className="product-image-bg"
                    style={{ backgroundImage }}
                />
            )}
            {stockBadge && (
                <span
                    className={`pos-stock-badge pos-stock-badge--${stockBadge.tone}`}
                    title="Disponibilidad estimada en la bodega de venta (no bloquea la venta)"
                >
                    {stockBadge.label}
                </span>
            )}
            <div className="product-info-overlay">
                <div className="product-name-new">{item.name}</div>
                <div className="product-price-new">{formatMoney(Number(item.price))}</div>
            </div>
        </div>
    );
}, (prevProps, nextProps) => {
    return prevProps.item.id === nextProps.item.id &&
        prevProps.item.name === nextProps.item.name &&
        prevProps.item.price === nextProps.item.price &&
        prevProps.item.images?.[0]?.imageUrl === nextProps.item.images?.[0]?.imageUrl &&
        prevProps.formatMoney === nextProps.formatMoney &&
        prevProps.stockBadge?.label === nextProps.stockBadge?.label &&
        prevProps.stockBadge?.tone === nextProps.stockBadge?.tone;
});

export default POSProductCard;
