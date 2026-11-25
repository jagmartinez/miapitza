// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import SettingsPage from './SettingsPage';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), showToast: vi.fn() }));
const mocks = vi.hoisted(() => ({ saveResolved: vi.fn() }));

vi.mock('../../context/ToastContext', () => ({ useAppToast: () => toast }));
vi.mock('../../services/api', () => ({ branchesAPI: { getAll: vi.fn().mockResolvedValue({ data: { data: [{ id: 3, name: 'Centro' }] } }) } }));
vi.mock('../../components/hr/payrollClient', () => ({ payrollClient: { getRules: vi.fn().mockResolvedValue({ items: [] }) } }));
vi.mock('../../services/settingsScope', () => ({
    fetchRegistry: vi.fn().mockResolvedValue({
        sections: [
            { id: 'facturacion', group: 'ventas', title: 'Facturación e impuestos', description: 'Impuesto.' },
            { id: 'metas', group: 'metas', title: 'Metas del negocio', description: 'Objetivos.' }
        ],
        definitions: [
            { key: 'tax_rate', type: 'number', default: '15', group: 'ventas', section: 'facturacion', label: 'Impuesto (IVA)', description: 'Tasa aplicada.', min: 0, max: 100, suffix: '%', branchable: false },
            { key: 'goal.avgTicket', type: 'number', default: '550', group: 'metas', section: 'metas', label: 'Ticket promedio objetivo', description: 'Venta por cuenta.', min: 0, prefix: 'C$', branchable: true }
        ]
    }),
    fetchResolved: vi.fn().mockResolvedValue({
        version: 'v1',
        values: {
            tax_rate: { key: 'tax_rate', value: '15', source: 'company', companyValue: '15' },
            'goal.avgTicket': { key: 'goal.avgTicket', value: '550', source: 'company', companyValue: '550' }
        }
    }),
    fetchHistory: vi.fn().mockResolvedValue([{ name: 'tax_rate', branchId: null, oldValue: '14', newValue: '15', userName: 'Ana', createdAt: '2026-11-20T10:00:00Z' }]),
    saveResolved: mocks.saveResolved
}));

const renderPage = () => render(<MemoryRouter><SettingsPage /></MemoryRouter>);

describe('SettingsPage', () => {
    beforeEach(() => { mocks.saveResolved.mockReset(); toast.error.mockReset(); });

    it('buscar "iva" muestra tax_rate aunque la sección activa sea otra', async () => {
        renderPage();
        await screen.findByText('Impuesto (IVA)');
        await userEvent.click(screen.getByRole('button', { name: /Metas del negocio/ }));
        expect(screen.queryByText('Impuesto (IVA)')).toBeNull();
        await userEvent.type(screen.getByLabelText('Buscar configuración'), 'iva');
        expect(await screen.findByText('Impuesto (IVA)')).toBeInTheDocument();
    });

    it('cambiar un número muestra "1 cambio sin guardar" y guarda solo lo cambiado con la versión', async () => {
        mocks.saveResolved.mockResolvedValue({ version: 'v2', values: {
            tax_rate: { key: 'tax_rate', value: '16', source: 'company', companyValue: '16' },
            'goal.avgTicket': { key: 'goal.avgTicket', value: '550', source: 'company', companyValue: '550' } } });
        renderPage();
        const input = await screen.findByLabelText('Impuesto (IVA)');
        await userEvent.clear(input);
        await userEvent.type(input, '16');
        expect(await screen.findByText(/1 cambio sin guardar/)).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
        await waitFor(() => expect(mocks.saveResolved).toHaveBeenCalledWith(null, 'v1', { tax_rate: '16' }));
    });

    it('409 muestra el aviso y conserva el borrador', async () => {
        mocks.saveResolved.mockRejectedValue({ response: { status: 409 } });
        renderPage();
        const input = await screen.findByLabelText('Impuesto (IVA)');
        await userEvent.clear(input);
        await userEvent.type(input, '17');
        await userEvent.click(await screen.findByRole('button', { name: 'Guardar' }));
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Otro usuario guardó cambios; recarga para continuar'));
        expect(screen.getByText(/1 cambio sin guardar/)).toBeInTheDocument();
    });
});
