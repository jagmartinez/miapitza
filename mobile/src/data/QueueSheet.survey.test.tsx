import { render, screen } from '@testing-library/react';
import QueueSheet from './QueueSheet';

const item = (id: number, url: string, label: string) => ({ id, url, method: 'POST', status: 'failed', timestamp: 0, lastError: 'x', operationType: 'GENERIC_MUTATION', meta: { label } });

describe('QueueSheet', () => {
    it('a customer survey can be retried but not discarded', async () => {
        const queue = { listItems: async () => [item(1, '/v1/surveys', 'Encuesta del cliente'), item(2, '/orders/1/pricing', 'Descuento')], retry: vi.fn(), discard: vi.fn(), subscribe: () => () => undefined, onSynced: () => () => undefined };
        render(<QueueSheet queue={queue as never} onClose={() => undefined} />);
        await screen.findByText('Encuesta del cliente');
        expect(screen.getAllByRole('button', { name: 'Reintentar' })).toHaveLength(2);
        expect(screen.getAllByRole('button', { name: 'Descartar' })).toHaveLength(1);
    });
});
