import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Services } from '../../core/services';
import type { Session } from '../../core/session';
import { KitchenHome } from './KitchenHome';

const services = () =>
    ({
        http: {
            get: vi.fn(async (url: string) => ({
                data: {
                    data: url.endsWith('/queue')
                        ? [{ id: 1, kitchenBatchId: 1, status: 'SENT_TO_KITCHEN', table: { number: 1 }, user: { id: 1, name: 'Ana' }, orderType: 'DINE_IN', createdAt: new Date().toISOString(), items: [{ id: 1, quantity: 1, sentAt: new Date().toISOString(), menuItem: { name: 'Taco' } }] }]
                        : url.endsWith('/config')
                          ? { warningMinutes: 5, urgentMinutes: 10 }
                          : [],
                },
            })),
            post: vi.fn(),
        },
        realtime: { subscribe: vi.fn(() => () => {}) },
    }) as unknown as Services;
const session = (permissions: string[]) => ({ token: 't', user: { id: 3, name: 'Cocina', roles: ['COCINA'], permissions } }) as unknown as Session;

describe('KitchenHome permissions', () => {
    it('without kds.manage the buttons are disabled with a reason', async () => {
        render(<KitchenHome session={session([])} services={services()} />);
        expect(await screen.findByRole('button', { name: 'Iniciar' })).toBeDisabled();
        expect(screen.getByText('Sin permiso para marcar')).toBeInTheDocument();
    });

    it('with kds.manage the button is enabled', async () => {
        render(<KitchenHome session={session(['kds.manage'])} services={services()} />);
        expect(await screen.findByRole('button', { name: 'Iniciar' })).toBeEnabled();
    });
});
