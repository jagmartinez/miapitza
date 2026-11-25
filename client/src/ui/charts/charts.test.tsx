// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DonutChart } from './DonutChart';
import { Heatmap } from './Heatmap';
import { InsightList } from './InsightList';
import { ParetoBars } from './ParetoBars';
import { Sparkline } from './Sparkline';
import { TrendChart } from './TrendChart';
import { WaterfallChart } from './WaterfallChart';
import type { BridgeStep } from './types';

const fmt = (v: number) => `C$ ${v}`;

describe('gráficos', () => {
  it('TrendChart sin datos muestra "Sin datos en el periodo"', () => {
    render(<TrendChart buckets={[]} current={[]} format={fmt} ariaLabel="Ventas" previousLabel="Anterior" />);
    expect(screen.getByText('Sin datos en el periodo')).toBeInTheDocument();
  });

  it('TrendChart con solo ceros (sucursal nueva) muestra el mensaje y no NaN', () => {
    const { container } = render(
      <TrendChart buckets={['1', '2']} current={[0, 0]} previous={[0, 0]} format={fmt} ariaLabel="Ventas" previousLabel="Anterior" />,
    );
    expect(screen.getByText('Sin datos en el periodo')).toBeInTheDocument();
    expect(container.innerHTML).not.toContain('NaN');
  });

  it('TrendChart con datos tiene role img, tabla accesible, leyenda y meta', () => {
    render(
      <TrendChart buckets={['1', '2', '3']} current={[10, 20, 30]} previous={[5, 10, 15]} goal={25} format={fmt} ariaLabel="Venta neta" previousLabel="Periodo anterior" />,
    );
    expect(screen.getByRole('img', { name: 'Venta neta' })).toBeInTheDocument();
    expect(screen.getAllByText('Periodo anterior').length).toBeGreaterThan(0);
    expect(screen.getByText(/Meta/)).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(4);
  });

  it('WaterfallChart muestra N/D para personal sin nómina y no lo dibuja como cero', () => {
    const steps: BridgeStep[] = [
      { key: 'net', label: 'Venta neta', amount: 100, kind: 'total' },
      { key: 'labor', label: 'Personal', amount: 0, kind: 'negative', quality: 'unavailable' },
      { key: 'operating', label: 'Utilidad operativa', amount: 100, kind: 'total' },
    ];
    render(<WaterfallChart steps={steps} />);
    expect(screen.getAllByText('N/D').length).toBeGreaterThan(0);
    expect(screen.getByRole('img', { name: /Puente/ })).toBeInTheDocument();
  });

  it('WaterfallChart vacío muestra mensaje', () => {
    render(<WaterfallChart steps={[]} />);
    expect(screen.getByText('Sin datos en el periodo')).toBeInTheDocument();
  });

  it('Heatmap sin ventas muestra mensaje; con ventas pinta celdas y deja caption', () => {
    const { rerender } = render(<Heatmap rows={[{ label: 'Lun', values: [0, 0] }]} columns={['11', '12']} format={fmt} />);
    expect(screen.getByText('Sin datos en el periodo')).toBeInTheDocument();
    rerender(<Heatmap rows={[{ label: 'Lun', values: [5, 10] }]} columns={['11', '12']} format={fmt} caption="Pico: lunes 12" />);
    expect(screen.getByText('Pico: lunes 12')).toBeInTheDocument();
    expect(screen.getByTitle('Lun 12: C$ 10')).toBeInTheDocument();
  });

  it('ParetoBars lista platos con acumulado y vacío con mensaje', () => {
    const { rerender } = render(<ParetoBars items={[]} format={fmt} />);
    expect(screen.getByText('Sin datos en el periodo')).toBeInTheDocument();
    rerender(<ParetoBars items={[{ name: 'Pizza', value: 100, cumulativePct: 40 }]} format={fmt} />);
    expect(screen.getByText('Pizza')).toBeInTheDocument();
    expect(screen.getByText(/40.00.%.acum/)).toBeInTheDocument();
  });

  it('DonutChart pinta leyenda normalizada y vacío con mensaje', () => {
    const { rerender } = render(<DonutChart segments={[]} ariaLabel="Mezcla" />);
    expect(screen.getByText('Sin datos en el periodo')).toBeInTheDocument();
    rerender(<DonutChart segments={[{ label: 'Salón', share: 60, tone: 'var(--ui-primary)' }, { label: 'Delivery', share: 40, tone: 'var(--ui-warning)' }]} ariaLabel="Mezcla" />);
    expect(screen.getByRole('img', { name: 'Mezcla' })).toBeInTheDocument();
    expect(screen.getByText('Salón')).toBeInTheDocument();
  });

  it('InsightList muestra impacto y acción; vacío con mensaje', () => {
    const { rerender } = render(<MemoryRouter><InsightList items={[]} /></MemoryRouter>);
    expect(screen.getByText('Sin hallazgos en el periodo')).toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <InsightList items={[{ id: 'a', kind: 'cost', severity: 'danger', impactAmount: 1500, message: 'Costo alto', action: { label: 'Ver recetas', route: '/cost-report' } }]} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Costo alto')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver recetas' })).toHaveAttribute('href', '/cost-report');
  });

  it('Sparkline sin valores no renderiza y con valores es decorativo', () => {
    const { container, rerender } = render(<Sparkline values={[]} />);
    expect(container.querySelector('svg')).toBeNull();
    rerender(<Sparkline values={[1, 2, 3]} />);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});
