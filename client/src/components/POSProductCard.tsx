import React, { memo } from 'react';
import type { MenuItem } from '../types';

interface POSProductCardProps {
    item: MenuItem;
    onClick: (item: MenuItem) => void;
    onContextMenu: (e: React.MouseEvent, item: MenuItem) => void;
}

const POSProductCard = memo(({ item, onClick, onContextMenu }: POSProductCardProps) => {
    const hasImage = item.images && item.images.length > 0;
    const backgroundImage = hasImage ? `url(${item.images?.[0]?.imageUrl})` : 'none';

    return (
        <div
            className={`product-card-new ${hasImage ? 'has-image' : ''}`}
            onClick={() => onClick(item)}
            onContextMenu={(e) => onContextMenu(e, item)}
        >
            {hasImage && (
                <div
                    className="product-image-bg"
                    style={{ backgroundImage }}
                />
            )}
            <div className="product-info-overlay">
                <div className="product-name-new">{item.name}</div>
                <div className="product-price-new">${Number(item.price).toFixed(2)}</div>
            </div>
        </div>
    );
}, (prevProps, nextProps) => {
    return prevProps.item.id === nextProps.item.id &&
        prevProps.item.name === nextProps.item.name &&
        prevProps.item.price === nextProps.item.price &&
        prevProps.item.images?.[0]?.imageUrl === nextProps.item.images?.[0]?.imageUrl;
});

export default POSProductCard;
