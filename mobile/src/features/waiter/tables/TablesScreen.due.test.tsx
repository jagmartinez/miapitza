import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TablesScreen } from './TablesScreen';
import { activeOrders, makeApi, planData, makeRealtime, result, userSession } from './testkit';

afterEach(cleanup);

function setup(api = makeApi()) {
    const realtime = makeRealtime();
    render(
        <TablesScreen
            session={userSession(['orders.view'])}
            api={api}
            realtime={realtime}
            queue={null}
            invalidate={vi.fn().mockResolvedValue(undefined)}
            onOpenOrder={vi.fn()}
            onSwitchUser={vi.fn()}
        />,
    );
    return { api, realtime };
}

describe('Por cobrar filter', () => {
    it('turns itself off when the last due table is gone, so free tables come back', async () => {
        const { api, realtime } = setup();
        await screen.findByTestId('tile-1');
        fireEvent.click(screen.getByRole('button', { name: 'Por cobrar 1' }));
        expect(screen.queryByTestId('tile-1')).toBeNull();
        api.floorPlan.mockResolvedValue(result({ ...planData, tables: planData.tables.map((t) => (t.id === 4 ? { ...t, operationalState: 'AVAILABLE', status: 'AVAILABLE' } : t)) }));
        api.activeOrders.mockResolvedValue(result(activeOrders.filter((o) => o.id !== 104)));
        await act(async () => {
            realtime.emit('ORDER_UPDATE', {});
            await new Promise((r) => setTimeout(r, 400));
        });
        await waitFor(() => expect(screen.queryByRole('button', { name: /Por cobrar/ })).toBeNull());
        expect(screen.getByTestId('tile-1')).toBeInTheDocument();
    });

    it('counts only the due tables of the current area', async () => {
        setup();
        await screen.findByTestId('tile-1');
        fireEvent.click(screen.getByRole('tab', { name: 'Terraza 2' }));
        expect(screen.queryByRole('button', { name: /Por cobrar/ })).toBeNull();
    });
});
