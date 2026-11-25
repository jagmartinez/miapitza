// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProductionOrders from './ProductionOrders';

const mocks = vi.hoisted(() => ({ role: 'ADMIN', getAll: vi.fn(), getById: vi.fn() }));

vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1, role: mocks.role, roles: [mocks.role] } }) }));
vi.mock('../context/ToastContext', () => ({ useAppToast: () => ({ error: vi.fn(), warning: vi.fn(), success: vi.fn() }) }));
vi.mock('../services/api', () => {
  const ok = (data: unknown) => Promise.resolve({ data: { success: true, data } });
  return {
    productionOrdersAPI: { getAll: () => mocks.getAll(), getById: (id: number) => mocks.getById(id) },
    productsAPI: { getAll: () => ok([]) },
    warehousesAPI: { getAll: () => ok([]) },
    branchesAPI: { getAll: () => ok([]) },
  };
});

const thisMonth = new Date().toISOString();
const order = (over: Record<string, unknown>) => ({
  id: 1, code: 'OP-1', status: 'FINISHED', plannedQuantity: 10, producedQuantity: 10, estimatedCost: 100, estimatedUnitCost: 10,
  realCost: 100, realUnitCost: 10, date: thisMonth, finishedAt: thisMonth, items: [],
  product: { id: 1, name: 'Salsa', sku: 'S1', unit: 'kg' }, ...over,
});

describe('ProductionOrders', () => {
  beforeEach(() => {
    mocks.role = 'ADMIN';
    mocks.getAll.mockReset().mockResolvedValue({ data: { data: [
      order({ id: 1, code: 'OP-1', estimatedCost: 100, realCost: 130 }),
      order({ id: 2, code: 'OP-2', estimatedCost: 0, realCost: 80, plannedQuantity: 20, producedQuantity: 15 }),
      order({ id: 3, code: 'OP-3', status: 'DRAFT', producedQuantity: 0, realCost: 0 }),
    ] } });
    mocks.getById.mockReset();
  });

  it('muestra costo estimado, real y variación, y N/D cuando falta un costo', async () => {
    render(<MemoryRouter><ProductionOrders /></MemoryRouter>);
    const table = await screen.findByRole('table', { name: 'Órdenes de producción' });
    const row1 = within(table).getByText('OP-1').closest('tr') as HTMLElement;
    expect(within(row1).getByText('100.00')).toBeInTheDocument();
    expect(within(row1).getByText('130.00')).toBeInTheDocument();
    expect(within(row1).getByText('+30.00 (30.00 %)')).toBeInTheDocument();
    const row2 = within(table).getByText('OP-2').closest('tr') as HTMLElement;
    expect(within(row2).getAllByText('N/D').length).toBeGreaterThanOrEqual(2); // costo estimado y variación
    expect(within(row2).queryByText('0.00')).toBeNull();
  });

  it('las tarjetas calculan sobrecosto y rendimiento del mes sin las órdenes sin costo', async () => {
    render(<MemoryRouter><ProductionOrders /></MemoryRouter>);
    const overrun = await screen.findByRole('region', { name: 'Sobrecosto del mes' });
    expect(overrun).toHaveTextContent('+C$ 30.00');
    expect(overrun).toHaveTextContent('1 sin costo estimado o real quedan fuera');
    const yieldCard = screen.getByRole('region', { name: 'Rendimiento real vs estándar' });
    expect(yieldCard).toHaveTextContent('87.50 %');
    expect(yieldCard).toHaveTextContent('OP-2');
  });

  it('el administrador ve la excepción de inventario negativo al finalizar; otros roles no', async () => {
    mocks.getAll.mockResolvedValue({ data: { data: [order({ id: 9, code: 'OP-9', status: 'IN_PROGRESS', producedQuantity: 0, realCost: 0 })] } });
    mocks.getById.mockResolvedValue({ data: { data: order({ id: 9, code: 'OP-9', status: 'IN_PROGRESS', producedQuantity: 0, realCost: 0 }) } });
    render(<MemoryRouter><ProductionOrders /></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: 'Finalizar producción' }));
    expect(await screen.findByLabelText(/Permitir inventario negativo/)).toBeInTheDocument();
  });

  it('un rol de bodega no ve la excepción de inventario negativo', async () => {
    mocks.role = 'BODEGA';
    mocks.getAll.mockResolvedValue({ data: { data: [order({ id: 9, code: 'OP-9', status: 'IN_PROGRESS', producedQuantity: 0, realCost: 0 })] } });
    mocks.getById.mockResolvedValue({ data: { data: order({ id: 9, code: 'OP-9', status: 'IN_PROGRESS', producedQuantity: 0, realCost: 0 }) } });
    render(<MemoryRouter><ProductionOrders /></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: 'Finalizar producción' }));
    expect(await screen.findByLabelText('Cantidad realmente producida *')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Permitir inventario negativo/)).toBeNull();
  });
});
