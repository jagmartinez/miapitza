import React, { memo, useRef } from 'react';
import type { MenuItem } from '../types';

interface POSProductCardProps {
    item: MenuItem;
    onClick: (item: MenuItem) => void;
    onContextMenu: (e: React.MouseEvent, item: MenuItem) => void;
    onQuantityEdit?: (item: MenuItem) => void;
    formatMoney: (amount: unknown) => string;
}

const LONG_PRESS_MS = 500;

const POSProductCard = memo(({ item, onClick, onContextMenu, onQuantityEdit, formatMoney }: POSProductCardProps) => {
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
            className={`product-card-new ${hasImage ? 'has-image' : ''}`}
            onClick={handleClick}
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
        prevProps.formatMoney === nextProps.formatMoney;
});

export default POSProductCard;
