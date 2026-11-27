// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTable, type Column } from './DataTable';
import { columnTemplate } from './columnTemplate';
import { resetUiPrefs, setUiPrefs } from '../prefs/userPrefs';

type Row = { id: number; name: string; total: number | null };
const makeRows = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `Fila ${i + 1}`, total: i + 1 }));
const cols: Column<Row>[] = [
  { key: 'name', header: 'Nombre' },
  { key: 'total', header: 'Total (C$)', type: 'money', total: true },
];
const bodyRows = () => within(screen.getAllByRole('rowgroup')[1]).getAllByRole('row');

describe('DataTable', () => {
  it('modo cliente: 25 filas y "1–25 de 60"', () => {
    render(<DataTable columns={cols} rows={makeRows(60)} rowKey={(r) => r.id} ariaLabel="T" />);
    expect(bodyRows()).toHaveLength(25);
    expect(screen.getByText('1–25 de 60')).toBeInTheDocument();
  });

  it('cambiar resetKey en la página 3 vuelve a la 1', async () => {
    const rows = makeRows(60);
    const { rerender } = render(<DataTable columns={cols} rows={rows} rowKey={(r) => r.id} ariaLabel="T" resetKey="a" />);
    await userEvent.click(screen.getByRole('button', { name: 'Página 3' }));
    expect(screen.getByText('51–60 de 60')).toBeInTheDocument();
    rerender(<DataTable columns={cols} rows={rows} rowKey={(r) => r.id} ariaLabel="T" resetKey="b" />);
    expect(screen.getByText('1–25 de 60')).toBeInTheDocument();
  });

  it('columna money formatea y alinea a la derecha', () => {
    const c: Column<Row>[] = [{ key: 'm', header: 'M', type: 'money', accessor: () => 1234.5 }];
    render(<DataTable columns={c} rows={makeRows(1)} rowKey={(r) => r.id} ariaLabel="T" />);
    const cell = screen.getByText('1,234.50');
    expect(cell).toHaveClass('ui-cell--numeric');
  });

  it('columnTemplate da a cada fr un mínimo que cabe el encabezado y respeta el resto', () => {
    expect(columnTemplate([{ width: '2.4fr' }, { width: 'minmax(8rem,1fr)' }, { width: '48px' }])).toBe(
      'minmax(160px,2.4fr) minmax(8rem,1fr) 48px',
    );
    // sin canvas (jsdom): 18 caracteres * 7.6 + 32 + 4 = 173
    expect(columnTemplate([{ header: 'Plato' }, { header: 'Vendidos (30 días)', type: 'number', width: '1fr' }])).toBe(
      'minmax(160px,1.6fr) minmax(173px,1fr)',
    );
  });

  it('0 filas: muestra empty y "0 resultados"', () => {
    render(<DataTable columns={cols} rows={[]} rowKey={(r) => r.id} ariaLabel="T" empty={<p>Nada aquí</p>} />);
    expect(within(screen.getByRole('table')).getByText('Nada aquí')).toBeInTheDocument();
    expect(screen.getByText('0 resultados')).toBeInTheDocument();
  });

  it('total: true suma solo la página visible', async () => {
    render(<DataTable columns={cols} rows={makeRows(60)} rowKey={(r) => r.id} ariaLabel="T" footerLabel="Total página" />);
    await userEvent.click(screen.getByRole('button', { name: 'Página 2' }));
    // filas 26..50 => 25 * (26 + 50) / 2 = 950
    const foot = screen.getAllByRole('rowgroup')[2];
    expect(within(foot).getByText('950.00')).toBeInTheDocument();
    expect(within(foot).getByText('Total página')).toBeInTheDocument();
  });

  it('total: true normaliza strings con comas y Decimal', () => {
    const c: Column<{ id: number; v: unknown }>[] = [{ key: 'v', header: 'V', type: 'money', total: true }];
    const rows = [
      { id: 1, v: '1,000.50' },
      { id: 2, v: { toNumber: () => 2 } },
    ];
    render(<DataTable columns={c} rows={rows} rowKey={(r) => r.id} ariaLabel="T" />);
    expect(within(screen.getAllByRole('rowgroup')[2]).getByText('1,002.50')).toBeInTheDocument();
  });

  it('columna date formatea ISO date-only sin correr el día', () => {
    const c: Column<{ id: number; d: string }>[] = [{ key: 'd', header: 'F', type: 'date' }];
    render(<DataTable columns={c} rows={[{ id: 1, d: '2026-03-05' }]} rowKey={(r) => r.id} ariaLabel="T" />);
    expect(screen.getByText(new Date(2026, 2, 5).toLocaleDateString('es-NI'))).toBeInTheDocument();
  });

  it('modo servidor: no recorta y "Página siguiente" llama onChange(2, 25)', async () => {
    const onChange = vi.fn();
    render(
      <DataTable
        columns={cols}
        rows={makeRows(30)}
        rowKey={(r) => r.id}
        ariaLabel="T"
        pagination={{ mode: 'server', page: 1, pageSize: 25, total: 100, onChange }}
      />,
    );
    expect(bodyRows()).toHaveLength(30);
    await userEvent.click(screen.getByRole('button', { name: 'Página siguiente' }));
    expect(onChange).toHaveBeenCalledWith(2, 25);
  });

  it('null en columna number se ve 0.00', () => {
    const c: Column<Row>[] = [{ key: 'total', header: 'N', type: 'number' }];
    render(<DataTable columns={c} rows={[{ id: 1, name: 'x', total: null }]} rowKey={(r) => r.id} ariaLabel="T" />);
    expect(screen.getByText('0.00')).toBeInTheDocument();
  });

  it('onRowClick ignora clics en botones internos', async () => {
    const onRowClick = vi.fn();
    const c: Column<Row>[] = [
      { key: 'name', header: 'N' },
      { key: 'a', header: 'A', type: 'actions', render: () => <button type="button">Editar</button> },
    ];
    render(<DataTable columns={c} rows={makeRows(1)} rowKey={(r) => r.id} ariaLabel="T" onRowClick={onRowClick} />);
    await userEvent.click(screen.getByRole('button', { name: 'Editar' }));
    expect(onRowClick).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText('Fila 1'));
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });
});

describe('DataTable con la preferencia "Filas por página" del usuario', () => {
  afterEach(() => resetUiPrefs());

  it('un DataTable nuevo arranca en 50 cuando el usuario eligió 50', () => {
    setUiPrefs({ rowsPerPage: 50 });
    render(<DataTable columns={cols} rows={makeRows(120)} rowKey={(r) => r.id} ariaLabel="T" />);
    expect(bodyRows()).toHaveLength(50);
    expect(screen.getByText('1–50 de 120')).toBeInTheDocument();
  });

  it('defaultPageSize explícito gana sobre la preferencia y un valor fuera de catálogo se ignora', () => {
    setUiPrefs({ rowsPerPage: 50 });
    const { unmount } = render(<DataTable columns={cols} rows={makeRows(120)} rowKey={(r) => r.id} ariaLabel="T" defaultPageSize={10} />);
    expect(bodyRows()).toHaveLength(10);
    unmount();
    setUiPrefs({ rowsPerPage: 33 });
    render(<DataTable columns={cols} rows={makeRows(120)} rowKey={(r) => r.id} ariaLabel="T" />);
    expect(bodyRows()).toHaveLength(50);
  });
});
