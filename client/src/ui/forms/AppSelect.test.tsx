// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppSelect } from './AppSelect';

const options = [
  { value: 1, label: 'Uno' },
  { value: 2, label: 'Dos' },
];

describe('AppSelect', () => {
  it('renderiza el menú en document.body', async () => {
    const { container } = render(<AppSelect aria-label="Num" options={options} value={null} onChange={() => {}} />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Num' }));
    const opt = await screen.findByText('Uno');
    expect(container.contains(opt)).toBe(false);
    expect(document.body.contains(opt)).toBe(true);
  });

  it('onChange recibe el value, no el objeto', async () => {
    const onChange = vi.fn();
    render(<AppSelect aria-label="Num" options={options} value={null} onChange={onChange} />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Num' }));
    await userEvent.click(await screen.findByText('Dos'));
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it('multi entrega un arreglo de valores', async () => {
    const onChange = vi.fn();
    render(<AppSelect kind="multi" aria-label="Num" options={options} value={[1]} onChange={onChange} />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Num' }));
    await userEvent.click(await screen.findByText('Dos'));
    expect(onChange).toHaveBeenCalledWith([1, 2]);
  });

  it('sin coincidencias muestra Sin resultados', async () => {
    render(<AppSelect aria-label="Num" options={options} value={null} onChange={() => {}} />);
    const box = screen.getByRole('combobox', { name: 'Num' });
    await userEvent.click(box);
    await userEvent.type(box, 'zzz');
    expect(await screen.findByText('Sin resultados')).toBeInTheDocument();
  });

  it('invalid marca aria-invalid', () => {
    render(<AppSelect aria-label="Num" invalid options={options} value={null} onChange={() => {}} />);
    expect(screen.getByRole('combobox', { name: 'Num' })).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('AppSelect dentro de Field', () => {
  it('anuncia el error y no muestra la descripción en el valor', async () => {
    const { Field } = await import('./Field');
    render(
      <Field label="Cat" htmlFor="c" error="Req">
        <AppSelect inputId="c" options={[{ value: 1, label: 'Uno', description: 'desc' }]} value={1} onChange={() => {}} />
      </Field>,
    );
    const cb = screen.getByRole('combobox');
    expect(cb.getAttribute('aria-invalid')).toBe('true');
    expect(cb.getAttribute('aria-errormessage')).toBe('c-error');
    expect(screen.queryByText('desc')).toBeNull();
  });
});
