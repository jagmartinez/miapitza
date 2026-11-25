// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PayrollRunStepper from './PayrollRunStepper';

describe('PayrollRunStepper', () => {
  it('marca la etapa actual y deja las siguientes pendientes', () => {
    render(<PayrollRunStepper status="REVIEW" />);
    const current = screen.getByText('En revisión').closest('li');
    expect(current).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('Pagada').closest('li')).not.toHaveAttribute('aria-current');
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
  });

  it('una corrida anulada muestra solo el estado Anulada', () => {
    render(<PayrollRunStepper status="VOID" />);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('Anulada')).toBeInTheDocument();
  });
});
