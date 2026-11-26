// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsRow, UnsavedChangesBar } from '@/ui';
import type { SettingDef } from '../../services/settingsScope';

const numDef: SettingDef = {
  key: 'goal.avgTicket', type: 'number', default: '550', group: 'metas', section: 'metas',
  label: 'Ticket promedio', description: 'Venta por cuenta.', prefix: 'C$', min: 0, branchable: true,
};
const base = { value: '550', source: 'company' as const, companyValue: '550', dirty: false, onChange: () => {}, onReset: () => {} };

describe('settings components', () => {
  it('number con prefijo renderiza NumberInput alineado a la derecha', () => {
    render(<SettingsRow {...base} def={numDef} scope="company" />);
    const input = screen.getByLabelText('Ticket promedio');
    expect(input.closest('.ui-input')).toHaveClass('ui-input--number');
    expect(screen.getByText('C$')).toBeInTheDocument();
  });

  it('en sucursal y no branchable no hay control editable', () => {
    render(<SettingsRow {...base} def={{ ...numDef, branchable: false }} scope={{ branchName: 'Centro' }} />);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('Solo se define a nivel empresa')).toBeInTheDocument();
  });

  it('Restablecer solo aparece cuando source es branch', async () => {
    const onReset = vi.fn();
    const { rerender } = render(<SettingsRow {...base} def={numDef} scope={{ branchName: 'Centro' }} onReset={onReset} />);
    expect(screen.getByText('Heredado de empresa')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restablecer' })).toBeNull();
    rerender(<SettingsRow {...base} def={numDef} source="branch" scope={{ branchName: 'Centro' }} onReset={onReset} />);
    await userEvent.click(screen.getByRole('button', { name: 'Restablecer' }));
    expect(onReset).toHaveBeenCalled();
  });

  it('la barra deshabilita Guardar con errores', () => {
    render(<UnsavedChangesBar count={2} hasErrors saving={false} onDiscard={() => {}} onSave={() => {}} />);
    expect(screen.getByRole('region', { name: 'Cambios sin guardar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
    expect(screen.getByText(/2 cambios sin guardar/)).toBeInTheDocument();
  });
});
