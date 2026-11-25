// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { Plus } from 'lucide-react';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { StatusBadge } from './StatusBadge';
import { toneFor } from './statusTone';

describe('primitivas', () => {
  it('Button loading deshabilita y expone aria-busy', () => {
    render(<Button loading>Guardar</Button>);
    const b = screen.getByRole('button', { name: 'Guardar' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('aria-busy', 'true');
  });
  it('Button sin type es type=button', () => {
    render(<Button>Ok</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });
  it('IconButton tiene nombre accesible', () => {
    render(<IconButton icon={Plus} label="Agregar" />);
    expect(screen.getByRole('button', { name: 'Agregar' })).toBeInTheDocument();
  });
  it('toneFor', () => {
    expect(toneFor('PAID')).toBe('success');
    expect(toneFor('X')).toBe('neutral');
  });
  it('StatusBadge usa tono de estado', () => {
    render(<StatusBadge status="PENDING" label="Pendiente" />);
    expect(screen.getByText('Pendiente').closest('.ui-badge')).toHaveClass('ui-badge--warning');
  });
});
