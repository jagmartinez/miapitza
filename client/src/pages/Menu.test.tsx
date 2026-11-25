// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Menu from './Menu';

const mocks = vi.hoisted(() => ({
  role: 'ADMIN',
  getAll: vi.fn(),
  engineering: vi.fn(),
}));

vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1, role: mocks.role, roles: [mocks.role] } }) }));
vi.mock('../context/ConfirmContext', () => ({ useConfirmDialog: () => ({ confirm: vi.fn() }) }));
vi.mock('../context/ToastContext', () => ({ useAppToast: () => ({ error: vi.fn(), warning: vi.fn(), success: vi.fn() }) }));
vi.mock('../services/api', () => {
  const ok = (data: unknown) => Promise.resolve({ data: { success: true, data } });
  return {
    menuAPI: { getAll: (...a: unknown[]) => mocks.getAll(...a) },
    productsAPI: { getAll: () => ok([]) },
    categoriesAPI: { getAll: () => ok([{ id: 1, name: 'Platos', active: true, showInMenu: true }]) },
    branchesAPI: { getAll: () => ok([]) },
    menuBrandsAPI: { getAll: () => ok([]) },
    unitsAPI: { getAll: () => ok([]), getProductUnits: () => ok([]) },
    modifiersAPI: {},
    branchPricingAPI: {},
    reportsAPI: { getMenuEngineering: (...a: unknown[]) => mocks.engineering(...a) },
  };
});

const dish = (id: number, name: string, price: number, recipes: number) => ({
  id, name, price, categoryId: 1, active: true, category: { id: 1, name: 'Platos' }, _count: { recipes }, recipes: [],
});
const eng = (menuItemId: number, price: number, cost: number, qtySold: number) => ({
  menuItemId, price, cost, margin: price - cost, qtySold, revenue: price * qtySold,
});

describe('Menu', () => {
  beforeEach(() => {
    localStorage.setItem('view_mode_menu', 'table');
    mocks.role = 'ADMIN';
    mocks.getAll.mockReset();
    mocks.engineering.mockReset();
    mocks.getAll.mockResolvedValue({ data: { data: [
      dish(1, 'Pizza', 100, 2), dish(2, 'Pasta', 50, 2), dish(3, 'Tacos', 120, 2),
      dish(4, 'Sopa', 40, 2), dish(5, 'Agua', 30, 0), dish(6, 'Café', 30, 1),
    ] } });
  });

  it('clasifica los platos en los 4 cuadrantes y muestra N/D donde falta el costo', async () => {
    mocks.engineering.mockResolvedValue({ data: { data: { items: [
      eng(1, 100, 30, 90), eng(2, 50, 40, 80), eng(3, 120, 40, 10), eng(4, 40, 35, 5), eng(5, 30, 0, 12),
    ] } } });
    render(<MemoryRouter><Menu /></MemoryRouter>);
    const table = await screen.findByRole('table', { name: 'Platos del menú' });
    await waitFor(() => expect(within(table).getAllByText('Estrella').length).toBeGreaterThan(0));
    const rowOf = (name: string) => within(table).getByText(name).closest('tr') as HTMLElement;
    expect(within(rowOf('Pizza')).getByText('Estrella')).toBeInTheDocument();
    expect(within(rowOf('Pasta')).getByText('Caballo de batalla')).toBeInTheDocument();
    expect(within(rowOf('Tacos')).getByText('Rompecabezas')).toBeInTheDocument();
    expect(within(rowOf('Sopa')).getByText('Perro')).toBeInTheDocument();
    expect(within(rowOf('Agua')).getByText('Sin receta')).toBeInTheDocument();
    expect(within(rowOf('Café')).getByText('Sin ventas')).toBeInTheDocument();
    // Sin receta: costo N/D, nunca 0.00.
    expect(within(rowOf('Agua')).getAllByText('N/D').length).toBeGreaterThan(0);
    expect(within(rowOf('Agua')).queryByText('0.00')).toBeNull();
    // Food cost = costo / precio.
    expect(within(rowOf('Pizza')).getByText('30.00 %')).toBeInTheDocument();
    expect(mocks.engineering).toHaveBeenCalledWith(expect.objectContaining({ dateFrom: expect.any(String), dateTo: expect.any(String) }));
  });

  it('si fallan los costos avisa con reintento y no muestra ceros', async () => {
    mocks.engineering.mockRejectedValue(new Error('boom'));
    render(<MemoryRouter><Menu /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('N/D');
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Platos del menú' });
    expect(within(table).queryByText('0.00')).toBeNull();
  });

  it('un rol sin acceso a reportes no pide ni muestra costos', async () => {
    mocks.role = 'CHEF';
    render(<MemoryRouter><Menu /></MemoryRouter>);
    const table = await screen.findByRole('table', { name: 'Platos del menú' });
    expect(within(table).queryByText('Food cost')).toBeNull();
    expect(mocks.engineering).not.toHaveBeenCalled();
  });
});
