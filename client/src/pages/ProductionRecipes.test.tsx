// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProductionRecipes from './ProductionRecipes';

const mocks = vi.hoisted(() => ({ getAll: vi.fn(), getById: vi.fn() }));

vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1, role: 'ADMIN', roles: ['ADMIN'] } }) }));
vi.mock('../context/ConfirmContext', () => ({ useConfirmDialog: () => ({ confirm: vi.fn() }) }));
vi.mock('../context/ToastContext', () => ({ useAppToast: () => ({ error: vi.fn(), warning: vi.fn(), success: vi.fn() }) }));
vi.mock('../services/api', () => {
  const ok = (data: unknown) => Promise.resolve({ data: { success: true, data } });
  return {
    productionRecipesAPI: { getAll: () => mocks.getAll(), getById: (id: number) => mocks.getById(id) },
    productsAPI: { getAll: () => ok([]) },
    unitsAPI: { getAll: () => ok([]) },
  };
});

const line = (componentProductId: number, componentName: string, totalCost: number) => ({
  componentProductId, componentName, componentType: 'INGREDIENT', unit: 'kg', baseUnit: 'kg', quantity: 1, baseQuantity: 1, unitCost: totalCost, totalCost,
});
const recipe = (id: number, productId: number, version: number, status: string, lines: ReturnType<typeof line>[] | null, componentIds: number[]) => ({
  id, companyId: 1, productId, name: '', version, status, yieldQuantity: 10, yieldUnitAbbreviation: 'kg', yieldUnitSource: 'RECIPE',
  product: { id: productId, name: `Producto ${productId}`, sku: `SKU${productId}`, type: 'INTERMEDIATE', unit: 'kg' },
  createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
  components: componentIds.map((c) => ({ id: c, componentProductId: c, quantity: 1, componentProduct: { name: `Insumo ${c}`, unit: 'kg' } })),
  cost: lines ? { batchCost: lines.reduce((s, l) => s + l.totalCost, 0), yieldBaseQuantity: 10, yieldBaseUnit: 'kg', unitCost: lines.reduce((s, l) => s + l.totalCost, 0) / 10, lines } : null,
  costError: lines ? null : 'Unidad sin conversión',
});

describe('ProductionRecipes', () => {
  const v1 = recipe(1, 100, 1, 'INACTIVE', [line(1, 'Harina', 50), line(2, 'Aceite', 30)], [1, 2]);
  const v2 = recipe(2, 100, 2, 'ACTIVE', [line(1, 'Harina', 50), line(2, 'Aceite', 60)], [1, 2]);
  const parent = recipe(3, 200, 1, 'ACTIVE', [line(100, 'Masa', 20)], [100]);
  const broken = recipe(4, 300, 1, 'DRAFT', null, [1]);

  beforeEach(() => {
    mocks.getAll.mockReset().mockResolvedValue({ data: { data: [v1, v2, parent, broken] } });
    mocks.getById.mockReset().mockImplementation((id: number) => Promise.resolve({ data: { data: [v1, v2, parent, broken].find((r) => r.id === id) } }));
  });

  it('muestra N/D en vez de 0 cuando una receta no tiene costo y avisa con tarjeta accionable', async () => {
    render(<MemoryRouter><ProductionRecipes /></MemoryRouter>);
    const table = await screen.findByRole('table', { name: 'Recetas de producción' });
    const brokenRow = within(table).getByText('Producto 300').closest('tr') as HTMLElement;
    expect(within(brokenRow).getAllByText('Revisar UOM').length).toBeGreaterThan(0);
    expect(screen.getByRole('region', { name: 'Recetas sin costo calculable' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Recetas activas con costo al alza' })).toBeInTheDocument();
  });

  it('el detalle avisa la variación contra la versión anterior, el insumo causante y dónde se usa', async () => {
    render(<MemoryRouter><ProductionRecipes /></MemoryRouter>);
    const table = await screen.findByRole('table', { name: 'Recetas de producción' });
    const row = within(table).getAllByText('Producto 100').map((el) => el.closest('tr') as HTMLElement).find((tr) => within(tr).queryByText(/· v2/))!;
    await userEvent.click(within(row).getByText(/· v2/));
    const panel = await screen.findByTestId('production-recipe-detail');
    await waitFor(() => expect(within(panel).getByRole('status')).toHaveTextContent('subió'));
    expect(within(panel).getByRole('status')).toHaveTextContent('Aceite');
    expect(within(panel).getByText('Producto 200 · v1')).toBeInTheDocument();
    // Peso de cada insumo: Aceite 60 de 110.
    expect(within(panel).getByText('54.55 %')).toBeInTheDocument();
  });
});
