// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTable, type Column } from './DataTable';
import { columnTemplate, measuredTemplate } from './columnTemplate';
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

  it('sin empty propio muestra EmptyState "Sin resultados"; un string también usa EmptyState', () => {
    const { unmount } = render(<DataTable columns={cols} rows={[]} rowKey={(r) => r.id} ariaLabel="T" />);
    expect(within(screen.getByRole('table')).getByRole('status')).toHaveTextContent('Sin resultados');
    unmount();
    render(<DataTable columns={cols} rows={[]} rowKey={(r) => r.id} ariaLabel="T" empty="No hay platos" />);
    expect(within(screen.getByRole('table')).getByRole('status')).toHaveTextContent('No hay platos');
  });

  it('error muestra LoadErrorState con reintentar y oculta totales y paginación', async () => {
    const onRetry = vi.fn();
    render(<DataTable columns={cols} rows={makeRows(3)} rowKey={(r) => r.id} ariaLabel="T" error="No se pudo cargar" onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cargar');
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.getAllByRole('rowgroup')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('align right en columna con render propio y variant flat', () => {
    const c: Column<Row>[] = [{ key: 'x', header: 'X', align: 'right', render: () => 'C$ 10.00' }];
    const { container } = render(<DataTable columns={c} rows={makeRows(1)} rowKey={(r) => r.id} ariaLabel="T" variant="flat" />);
    expect(screen.getByText('C$ 10.00')).toHaveClass('ui-cell--align-right');
    expect(container.firstChild).toHaveClass('ui-datatable--flat');
  });

  it('hidePaginationIfSinglePage oculta la paginación si todo cabe en una página', () => {
    render(<DataTable columns={cols} rows={makeRows(3)} rowKey={(r) => r.id} ariaLabel="T" hidePaginationIfSinglePage />);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
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

  describe('measuredTemplate (anchos por contenido)', () => {
    const frSum = (t: string) => [...t.matchAll(/,\s*([\d.]+)fr\)/g)].reduce((a, m) => a + Number(m[1]), 0);

    it('columnas cortas: mínimo = su contenido y peso pequeño (no se parten ni acaparan espacio)', () => {
      const r = measuredTemplate([
        { type: 'date', headerPx: 70, contentPx: 110 },
        { type: 'time', headerPx: 60, contentPx: 90 },
        { type: 'money', headerPx: 80, contentPx: 130 },
        { type: 'status', headerPx: 70, contentPx: 120 },
      ]);
      expect(r.template).toBe('minmax(110px,0.24fr) minmax(90px,0.2fr) minmax(130px,0.29fr) minmax(120px,0.27fr)');
      expect(r.minWidth).toBe(450);
    });

    it('los mínimos nunca bajan del mínimo por tipo ni del encabezado (inputs al 100 % miden ~0)', () => {
      const r = measuredTemplate([
        { type: 'text', headerPx: 0, contentPx: 300 },
        { type: 'money', headerPx: 0, contentPx: 4 },
        { type: 'number', headerPx: 150, contentPx: 60 },
      ]);
      expect(r.template.split(' ').slice(1)).toEqual(['minmax(104px,0.1fr)', 'minmax(150px,0.31fr)']);
    });

    it('texto corto (≤ 140 px de contenido) se trata como corto', () => {
      expect(measuredTemplate([{ type: 'text', headerPx: 60, contentPx: 150 }]).template).toBe('minmax(150px,1fr)');
    });

    it('texto largo: mínimo 160 (o el encabezado) y peso proporcional al contenido con tope', () => {
      const r = measuredTemplate([
        { headerPx: 80, contentPx: 360 },
        { headerPx: 200, contentPx: 2000 },
        { type: 'date', headerPx: 60, contentPx: 110 },
      ]);
      expect(r.template).toBe('minmax(160px,3fr) minmax(200px,4fr) minmax(110px,0.23fr)');
      expect(r.minWidth).toBe(470);
    });

    it('respeta anchos fijos (px, rem, minmax) e ignora los pesos fr; acciones = su contenido', () => {
      const r = measuredTemplate([
        { width: '2fr', headerPx: 60, contentPx: 120 },
        { width: '48px', headerPx: 0, contentPx: 40 },
        { width: 'minmax(8rem,1fr)', headerPx: 0, contentPx: 300 },
        { type: 'actions', headerPx: 0, contentPx: 92 },
      ]);
      expect(r.template).toBe('minmax(120px,0.25fr) 48px minmax(8rem,1fr) 92px');
      expect(r.minWidth).toBe(120 + 48 + 128 + 92);
    });

    it('la suma de pesos fr es siempre ≥ 1 para que la fila llene el ancho', () => {
      for (const cols of [
        [{ type: 'date' as const, headerPx: 50, contentPx: 90 }],
        [{ headerPx: 50, contentPx: 170 }, { type: 'qty' as const, headerPx: 40, contentPx: 60 }],
        [{ headerPx: 50, contentPx: 900 }],
      ]) {
        expect(frSum(measuredTemplate(cols).template)).toBeGreaterThanOrEqual(1);
      }
    });
  });
});
