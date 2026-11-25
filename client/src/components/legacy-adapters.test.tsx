// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CatalogTable from './CatalogTable';
import Sidebar from './Sidebar';
import Modal from './Modal';
import LegacyPagination from './Pagination';
import ConfirmDialog from './ConfirmDialog';

const rows = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `Fila ${i + 1}`, amount: i * 10 }));
const columns = [
  { key: 'name', header: 'Nombre', render: (r: (typeof rows)[number]) => r.name },
  { key: 'amount', header: 'Monto', align: 'right' as const, render: (r: (typeof rows)[number]) => <b>{r.amount}</b> },
];

describe('adaptadores heredados', () => {
  it('CatalogTable pagina en cliente con pageSize y conserva render', async () => {
    render(<CatalogTable columns={columns} rows={rows} rowKey={(r) => r.id} pageSize={10} />);
    expect(screen.getAllByRole('row')).toHaveLength(11);
    expect(screen.getByText('Fila 1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Página siguiente' }));
    expect(screen.getByText('Fila 11')).toBeInTheDocument();
  });

  it('CatalogTable con paginación de servidor llama onPageChange(2)', async () => {
    const onPageChange = vi.fn();
    render(
      <CatalogTable
        columns={columns}
        rows={rows.slice(0, 10)}
        rowKey={(r) => r.id}
        pagination={{ page: 1, pageSize: 10, total: 30, onPageChange }}
      />,
    );
    expect(screen.getAllByRole('row')).toHaveLength(11);
    await userEvent.click(screen.getByRole('button', { name: 'Página siguiente' }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('Sidebar abierto renderiza un diálogo a pantalla completa con el título', () => {
    render(<Sidebar isOpen onClose={() => {}} title="Nuevo cliente"><p>contenido</p></Sidebar>);
    const dialog = screen.getByRole('dialog', { name: 'Nuevo cliente' });
    expect(dialog).toHaveClass('ui-fsm');
    expect(document.body.contains(dialog)).toBe(true);
  });

  it('Modal md usa pantalla completa y sm sigue centrado', () => {
    const { rerender } = render(<Modal isOpen onClose={() => {}} title="Grande" size="md" footer={<button>Guardar</button>}>x</Modal>);
    expect(screen.getByRole('dialog', { name: 'Grande' })).toHaveClass('ui-fsm');
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeInTheDocument();
    rerender(<Modal isOpen onClose={() => {}} title="Chico" size="sm">x</Modal>);
    const sm = screen.getByRole('dialog', { name: 'Chico' });
    expect(sm).not.toHaveClass('ui-fsm');
    expect(sm).toHaveClass('modal-container');
  });

  it('Pagination heredada convierte onChange(page, size) a onPageChange(page)', async () => {
    const onPageChange = vi.fn();
    render(<LegacyPagination page={1} totalPages={3} totalItems={30} pageSize={10} onPageChange={onPageChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Página siguiente' }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('Pagination heredada no se muestra con una sola página salvo alwaysShow', () => {
    const { container, rerender } = render(<LegacyPagination page={1} totalPages={1} onPageChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<LegacyPagination page={1} totalPages={1} alwaysShow emptyLabel="Sin datos" totalItems={0} pageSize={10} onPageChange={() => {}} />);
    expect(screen.getByText('Sin datos')).toBeInTheDocument();
  });

  it('ConfirmDialog heredado conserva props y callbacks', async () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog isOpen title="Eliminar" message="¿Seguro?" confirmText="Sí" onConfirm={onConfirm} onCancel={() => {}} />);
    expect(screen.getByRole('alertdialog', { name: 'Eliminar' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sí' }));
    expect(onConfirm).toHaveBeenCalled();
  });
});
