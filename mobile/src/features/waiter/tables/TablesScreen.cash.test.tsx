import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { cashSession } from '../../cash/testkit';
import { TablesScreen } from './TablesScreen';
import { makeApi, makeRealtime } from './testkit';

afterEach(cleanup);

function setup(role: 'MESERO' | 'CAJERO' | 'ADMIN', withHandler = true) {
    const onOpenCash = vi.fn();
    render(
        <TablesScreen
            session={cashSession(role)}
            api={makeApi()}
            realtime={makeRealtime()}
            queue={null}
            invalidate={vi.fn().mockResolvedValue(undefined)}
            onOpenOrder={vi.fn()}
            onSwitchUser={vi.fn()}
            onOpenCash={withHandler ? onOpenCash : undefined}
        />,
    );
    return onOpenCash;
}

describe('TablesScreen cash entry', () => {
    it('cash icon hidden for MESERO, shown for CAJERO', async () => {
        setup('MESERO');
        await screen.findByTestId('tile-1');
        expect(screen.queryByRole('button', { name: 'Caja' })).toBeNull();
        cleanup();
        const open = setup('CAJERO');
        await screen.findByTestId('tile-1');
        fireEvent.click(screen.getByRole('button', { name: 'Caja' }));
        expect(open).toHaveBeenCalledTimes(1);
    });

    it('cash icon is shown to ADMIN and absent without a handler', async () => {
        setup('ADMIN');
        await screen.findByTestId('tile-1');
        expect(screen.getByRole('button', { name: 'Caja' })).toBeInTheDocument();
        cleanup();
        setup('CAJERO', false);
        await screen.findByTestId('tile-1');
        expect(screen.queryByRole('button', { name: 'Caja' })).toBeNull();
    });
});
