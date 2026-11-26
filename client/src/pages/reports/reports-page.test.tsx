// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Reports from '../Reports';

const api = vi.hoisted(() => ({
    getSalesByCategory: vi.fn(),
    exportSalesByCategory: vi.fn(),
    branches: vi.fn(),
}));

vi.mock('../../services/api', () => ({
    branchesAPI: { getAll: api.branches },
    categoriesAPI: { getAll: vi.fn().mockResolvedValue({ data: { data: [{ id: 1, name: 'Bebidas' }] } }) },
    suppliersAPI: { getAll: vi.fn().mockResolvedValue({ data: { data: [] } }) },
    warehousesAPI: { getAll: vi.fn().mockResolvedValue({ data: { data: [] } }) },
    menuBrandsAPI: { getAll: vi.fn().mockResolvedValue({ data: { data: [] } }) },
    productionReportsAPI: {},
    reportsAPI: {
        getSalesByCategory: api.getSalesByCategory,
        exportSalesByCategory: api.exportSalesByCategory,
    },
}));

const renderAt = (path: string) =>
    render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route path="/reporteria" element={<Reports />} />
                <Route path="/reporteria/:reportId" element={<Reports />} />
            </Routes>
        </MemoryRouter>,
    );

beforeEach(() => {
    api.branches.mockResolvedValue({ data: { data: [{ id: 1, name: 'Centro' }] } });
    api.getSalesByCategory.mockResolvedValue({
        data: {
            data: {
                summary: { totalSales: 1500, totalCategories: 3 },
                items: [
                    { categoryName: 'Bebidas', unitsSold: 10, totalSales: 1000, percentOfTotal: 66.6667 },
                    { categoryName: 'Postres', unitsSold: 5, totalSales: 500, percentOfTotal: 33.3333 },
                    { categoryName: 'Sin dato', unitsSold: 1, totalSales: null, percentOfTotal: null },
                ],
            },
        },
    });
});

describe('Reports page', () => {
    it('sin reporte elegido muestra el catálogo lateral por grupo y un estado vacío', () => {
        renderAt('/reporteria');
        expect(screen.getByRole('heading', { level: 1, name: 'Reportería' })).toBeInTheDocument();
        const catalog = screen.getByRole('complementary', { name: 'Catálogo de reportes' });
        expect(within(catalog).getByRole('heading', { name: 'Inventario' })).toBeInTheDocument();
        expect(within(catalog).getByRole('heading', { name: 'Ventas' })).toBeInTheDocument();
        expect(screen.getAllByText('Elige un reporte').length).toBeGreaterThan(0);
    });

    it('el visor trae PageHeader, lectura rápida, gráfico, DataTable y marca N/D sin convertir a 0', async () => {
        renderAt('/reporteria/sales-by-category');
        expect(await screen.findByRole('heading', { level: 1, name: 'Ventas por Categoría' })).toBeInTheDocument();
        expect(await screen.findByRole('table', { name: 'Ventas por Categoría' })).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Lectura rápida' })).toHaveTextContent('3 registros');
        expect(screen.getByRole('region', { name: 'Lectura rápida' })).toHaveTextContent('Bebidas');
        expect(screen.getByRole('region', { name: 'Lectura rápida' })).toHaveTextContent('1 fila sin dato');
        expect(screen.getByRole('region', { name: /Top 2 por/ })).toBeInTheDocument();
        expect(screen.getAllByText('N/D').length).toBeGreaterThan(0);
        // La paginación del DataTable existe y los números salen con 2 decimales.
        expect(screen.getByRole('navigation', { name: 'Paginación de Ventas por Categoría' })).toBeInTheDocument();
        expect(screen.getAllByText('66.67').length).toBeGreaterThan(0);
    });

    it('un filtro que no cargó avisa y permite reintentar', async () => {
        api.branches.mockRejectedValueOnce(new Error('x'));
        renderAt('/reporteria/sales-by-category');
        const warning = await screen.findByText(/No se pudieron cargar filtros: sucursales/);
        expect(warning).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Reintentar filtros' }));
        await waitFor(() => expect(screen.queryByText(/No se pudieron cargar filtros/)).not.toBeInTheDocument());
    });

    it('si el reporte falla muestra el error con reintento y no una tabla vacía', async () => {
        api.getSalesByCategory.mockRejectedValueOnce({ response: { data: { message: 'Servidor caído' } } });
        renderAt('/reporteria/sales-by-category');
        expect(await screen.findByText('Servidor caído')).toBeInTheDocument();
        expect(screen.queryByRole('table')).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
        expect(await screen.findByRole('table', { name: 'Ventas por Categoría' })).toBeInTheDocument();
    });

    it('conserva la exportación a Excel con los mismos parámetros del filtro', async () => {
        api.exportSalesByCategory.mockResolvedValue({ data: new ArrayBuffer(1) });
        URL.createObjectURL = vi.fn(() => 'blob:x');
        URL.revokeObjectURL = vi.fn();
        renderAt('/reporteria/sales-by-category');
        await screen.findByRole('table');
        await userEvent.click(screen.getByRole('button', { name: /Excel/ }));
        await waitFor(() => expect(api.exportSalesByCategory).toHaveBeenCalled());
        const params = api.exportSalesByCategory.mock.calls[0][0];
        expect(params).toHaveProperty('dateFrom');
        expect(params).toHaveProperty('dateTo');
    });
});
