// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import POSProductCard from './POSProductCard';
import type { MenuItem } from '../types';
import type { StockBadge } from '../utils/stockAvailability';

const item = { id: 1, name: 'Pizza', price: 120, images: [] } as unknown as MenuItem;

function renderCard(stockBadge?: StockBadge | null) {
    const onClick = vi.fn();
    render(<POSProductCard item={item} onClick={onClick} onContextMenu={vi.fn()} stockBadge={stockBadge} />);
    return onClick;
}

describe('POSProductCard stock badge', () => {
    it('shows the out-of-stock badge and still lets the sale continue', () => {
        const onClick = renderCard({ tone: 'out', label: 'Agotado' });
        expect(screen.getByText('Agotado')).toBeTruthy();
        screen.getByText('Pizza').click();
        expect(onClick).toHaveBeenCalledWith(item);
    });

    it('shows the low-stock badge', () => {
        renderCard({ tone: 'low', label: 'Quedan 2' });
        expect(screen.getByText('Quedan 2')).toBeTruthy();
    });

    it('shows nothing without availability data', () => {
        renderCard(null);
        expect(document.querySelector('.pos-stock-badge')).toBeNull();
    });
});
