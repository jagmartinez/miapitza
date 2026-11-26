// @vitest-environment jsdom
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NumberInput } from './NumberInput';
import { Field } from './Field';
import { Input } from './Input';
import { Switch } from './Switch';
import { SegmentedControl } from './SegmentedControl';

describe('controles de formulario', () => {
  it('NumberInput formatea al salir y entrega el número', async () => {
    const onChange = vi.fn();
    render(<NumberInput id="n" aria-label="Monto" value={null} onChange={onChange} />);
    const el = screen.getByLabelText('Monto');
    await userEvent.click(el);
    await userEvent.type(el, '1234.5');
    expect(onChange).toHaveBeenLastCalledWith(1234.5);
    await userEvent.tab();
  });

  it('NumberInput muestra 1,234.50 al salir y sin agrupar al enfocar', async () => {
    function Host() {
      const [v, setV] = useState<number | null>(null);
      return <NumberInput aria-label="Monto" value={v} onChange={setV} />;
    }
    render(<Host />);
    const el = screen.getByLabelText('Monto') as HTMLInputElement;
    await userEvent.click(el);
    await userEvent.type(el, '1234.5');
    await userEvent.tab();
    expect(el.value).toBe('1,234.50');
    await userEvent.click(el);
    expect(el.value).toBe('1234.5');
  });

  it('NumberInput con texto inválido entrega null', async () => {
    const onChange = vi.fn();
    render(<NumberInput aria-label="Monto" value={5} onChange={onChange} />);
    const el = screen.getByLabelText('Monto');
    await userEvent.clear(el);
    await userEvent.type(el, 'abc');
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('Field con error marca aria-invalid y role=alert', () => {
    render(
      <Field label="Nombre" htmlFor="nom" error="Requerido">
        <Input id="nom" />
      </Field>,
    );
    expect(screen.getByLabelText('Nombre')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Requerido');
    expect(screen.getByLabelText('Nombre')).toHaveAttribute('aria-describedby', 'nom-error');
  });

  it('Switch alterna y expone aria-checked', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<Switch checked={false} onChange={onChange} label="Activo" />);
    const sw = screen.getByRole('switch', { name: 'Activo' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
    rerender(<Switch checked onChange={onChange} label="Activo" />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('SegmentedControl marca la opción activa', () => {
    render(
      <SegmentedControl
        ariaLabel="Vista"
        value="b"
        onChange={() => {}}
        options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]}
      />,
    );
    expect(screen.getByRole('button', { name: 'B' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'A' })).toHaveAttribute('aria-pressed', 'false');
  });
});
