// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import POSProductCard from './POSProductCard';
import type { MenuItem } from '../types';

const item = { id: 1, name: 'Pizza', price: 120, images: [] } as unknown as MenuItem;

function renderCard(availability?: 'OK' | 'LOW' | 'OUT' | null) {
    const onClick = vi.fn();
    render(<POSProductCard item={item} onClick={onClick} onContextMenu={vi.fn()} availability={availability} />);
    return onClick;
}

describe('POSProductCard availability notice', () => {
    it('shows Agotado and still lets the sale continue', () => {
        const onClick = renderCard('OUT');
        expect(screen.getByText('Agotado')).toBeTruthy();
        screen.getByText('Pizza').click();
        expect(onClick).toHaveBeenCalledWith(item);
    });

    it('shows Pocas when stock is low', () => {
        renderCard('LOW');
        expect(screen.getByText('Pocas')).toBeTruthy();
    });

    it('shows nothing when stock is fine or the data is missing', () => {
        renderCard('OK');
        expect(screen.queryByText('Agotado')).toBeNull();
        expect(screen.queryByText('Pocas')).toBeNull();
    });

    it('shows nothing when there is no availability data', () => {
        renderCard(null);
        expect(screen.queryByText('Agotado')).toBeNull();
        expect(screen.queryByText('Pocas')).toBeNull();
    });
});
